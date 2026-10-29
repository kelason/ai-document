import { createServerClient } from '@supabase/ssr';
import { integrationClients } from './supabase';

/** Real Auth/PKCE cookie jar; no forged session fixture and no production credentials. */
export function authHarness() {
  const clients = integrationClients();
  const url = process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_TEST_ANON_KEY!;
  const cookieJar = new Map<string, string>();
  const newTab = (jar = cookieJar) => createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) { if (value) jar.set(name, value); else jar.delete(name); } },
    },
  });
  return { ...clients, newTab, cookieJar };
}

/** Mailpit (current CLI) or Inbucket (legacy CLI), only on the isolated local stack. */
export async function waitForAuthEmail(email: string, timeoutMs = 10_000): Promise<{ tokenHash: string; type: string; url:string }> {
  const origin = process.env.SUPABASE_TEST_INBOX_URL ?? 'http://127.0.0.1:54324';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Auth test inbox must be local.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await readInbox(origin, email);
    for (const text of messages) {
      const candidates = text.replaceAll('&amp;', '&').match(/https?:\/\/[^\s<>"']+/g) ?? [];
      for (const candidate of candidates) {
        const link = new URL(candidate);
        const tokenHash = link.searchParams.get('token_hash') ?? link.searchParams.get('token');
        const type = link.searchParams.get('type');
        if (tokenHash && type) return { tokenHash, type, url:link.toString() };
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('No confirmation/recovery email arrived in the local Auth inbox.');
}

async function readInbox(origin: string, email: string): Promise<string[]> {
  const mailpit = await fetch(`${origin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (mailpit.ok && mailpit.headers.get('content-type')?.includes('application/json')) {
    const result = await mailpit.json() as { messages: Array<{ ID: string }> };
    const messages: string[] = [];
    for (const { ID } of result.messages) {
      const read = await fetch(`${origin}/api/v1/message/${encodeURIComponent(ID)}`);
      if (!read.ok) continue;
      const body = await read.json() as { HTML?: string; Text?: string };
      messages.push(`${body.HTML ?? ''}\n${body.Text ?? ''}`);
    }
    return messages;
  }
  const mailbox = encodeURIComponent(email.split('@')[0]);
  const inbucket = await fetch(`${origin}/api/v1/mailbox/${mailbox}`);
  if (!inbucket.ok || !inbucket.headers.get('content-type')?.includes('application/json')) throw new Error('Local Auth test inbox is unavailable.');
  const result = await inbucket.json() as Array<{ id: string }>;
  const messages: string[] = [];
  for (const { id } of [...result].reverse()) {
    const read = await fetch(`${origin}/api/v1/mailbox/${mailbox}/${encodeURIComponent(id)}`);
    if (!read.ok) continue;
    const body = await read.json() as { body?: { html?: string; text?: string } };
    messages.push(`${body.body?.html ?? ''}\n${body.body?.text ?? ''}`);
  }
  return messages;
}
