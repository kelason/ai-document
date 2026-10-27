import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_RATE_LIMIT_DB_TESTS === '1';
const target = process.env.RATE_LIMIT_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
function assertLocalTarget() {
  const url = new URL(target);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '54322' || url.pathname !== '/postgres' || url.search || url.hash || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Rate limiter tests require an isolated local Supabase database on port 54322.');
  }
}
function sql(input: string): Promise<string> {
  assertLocalTarget();
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-XAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-d', target]);
    let output = ''; let error = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { error += data; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(input);
  });
}
const key = () => randomBytes(32).toString('hex');
const consume = (id: string, bucket = 'auth') => sql(`SELECT allowed, retry_after FROM public.consume_request_limit('${id}', '${bucket}');`);

describe.skipIf(!enabled)('durable PostgreSQL request limits (isolated local Supabase)', () => {
  beforeAll(async () => {
    assertLocalTarget();
    const migration = readFileSync('supabase/migrations/202610270004_request_limits.sql', 'utf8');
    await sql(migration);
  });

  it('allows exactly ten of eleven concurrent auth requests across independent connections', async () => {
    const id = key();
    const results = await Promise.all(Array.from({ length: 11 }, () => consume(id)));
    expect(results.filter((result) => result === 't|0')).toHaveLength(10);
    expect(results.filter((result) => /^f\|[1-9]\d*$/.test(result))).toHaveLength(1);
  });
  it('recovers expired buckets without extending them on denied calls', async () => {
    const id = key();
    await Promise.all(Array.from({ length: 10 }, () => consume(id)));
    expect(await consume(id)).toMatch(/^f\|[1-9]\d*$/);
    await sql(`UPDATE request_security.rate_limits SET window_ends_at = clock_timestamp() - interval '1 second' WHERE key_hash = '${id}';`);
    expect(await consume(id)).toBe('t|0');
  });
  it('purges records more than 24 hours past expiry while retaining current buckets', async () => {
    const old = key(); const current = key();
    await consume(old); await consume(current);
    await sql(`UPDATE request_security.rate_limits SET window_ends_at = clock_timestamp() - interval '25 hours' WHERE key_hash = '${old}';`);
    await consume(key());
    expect(await sql(`SELECT count(*) FROM request_security.rate_limits WHERE key_hash = '${old}';`)).toBe('0');
    expect(await sql(`SELECT count(*) FROM request_security.rate_limits WHERE key_hash = '${current}';`)).toBe('1');
  });
  it('enforces separate upload, session, mutation, and presence budgets', async () => {
    for (const [bucket, count] of [['session', 20], ['upload', 10], ['mutation', 120], ['presence', 120]] as const) {
      const id = key();
      const results: string[] = [];
      // Bound connections below local PostgreSQL's max_connections, while still
      // contending from independent processes rather than an in-memory double.
      for (let remaining = count + 1; remaining > 0; remaining -= 16) {
        results.push(...await Promise.all(Array.from({ length: Math.min(16, remaining) }, () => consume(id, bucket))));
      }
      expect(results.filter((result) => result === 't|0')).toHaveLength(count);
    }
  }, 30_000);
  it('exposes only the service RPC and never direct table access to browser roles or service_role', async () => {
    expect(await sql(`SELECT has_function_privilege('anon','public.consume_request_limit(text,text)','EXECUTE'), has_function_privilege('authenticated','public.consume_request_limit(text,text)','EXECUTE'), has_function_privilege('service_role','public.consume_request_limit(text,text)','EXECUTE');`)).toBe('f|f|t');
    expect(await sql(`SELECT has_table_privilege('service_role','request_security.rate_limits','INSERT'), has_table_privilege('anon','request_security.rate_limits','SELECT'), has_table_privilege('authenticated','request_security.rate_limits','SELECT');`)).toBe('f|f|f');
    expect(await sql(`SET ROLE service_role; SELECT allowed FROM public.consume_request_limit('${key()}', 'auth');`)).toBe('SET\nt');
  });
  it('refuses arbitrary buckets and plaintext keys', async () => {
    await expect(sql(`SELECT * FROM public.consume_request_limit('email@example.test', 'auth');`)).rejects.toThrow();
    await expect(sql(`SELECT * FROM public.consume_request_limit('${key()}', 'unlimited');`)).rejects.toThrow();
  });
});

// An explicit opt-in with no local database is an error, never a silent skip.
if (enabled) {
  assertLocalTarget();
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  if (probe.error) throw probe.error;
}
