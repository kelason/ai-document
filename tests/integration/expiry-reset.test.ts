import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// Intentionally required in CI: no remote target and no skip/fallback database.
const target = process.env.EXPIRY_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const credentials: string[] = [];
function localTarget() {
  const url = new URL(target);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '54322' || url.pathname !== '/postgres' || url.search || url.hash || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Expiry tests require isolated local Supabase on port 54322.');
  }
}
function connection(input: string, onOutput?: (output: string) => void): Promise<string> {
  localTarget();
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-XAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-d', target], { timeout: 15_000 });
    let output = ''; let error = '';
    child.stdout.on('data', data => { output += data; onOutput?.(output); });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error || `psql exited ${code}`)));
    child.stdin.end(input);
  });
}
const sql = (input: string) => connection(input);
async function start(kind = 'demo') {
  const hash = randomBytes(32).toString('hex'); credentials.push(hash);
  const actor = JSON.parse(await sql(`SELECT public.temporary_start('${hash}','${kind}',${kind === 'demo' ? "'charlie'" : 'NULL'});`));
  return { hash, workspace: actor.workspaceId as string };
}

describe('expiry/reset with independent PostgreSQL connections', () => {
  beforeAll(async () => { expect(await sql('SELECT 1;')).toBe('1'); });
  afterEach(async () => {
    for (const hash of credentials.splice(0)) await sql(`SELECT public.temporary_end('${hash}');`);
  });
  it('rejects a save queued before midnight when its workspace lock is acquired after midnight', async () => {
    const { hash, workspace } = await start();
    const doc = JSON.parse(await sql(`SELECT temporary_create('${hash}',1,'{"title":"before midnight","content":"old"}');`));
    let signal!: () => void;
    const locked = new Promise<void>(resolve => { signal = resolve; });
    let deadline = ''; let beganBeforeDeadline = false;
    // Independent transaction owns workspace lock while the actual deadline passes.
    const holder = connection(`BEGIN;
      UPDATE temporary_private.workspaces SET reset_at=clock_timestamp()+interval '2 seconds' WHERE id='${workspace}';
      SELECT 'LOCKED:'||reset_at::text FROM temporary_private.workspaces WHERE id='${workspace}';
      SELECT pg_sleep(3);
      COMMIT;`, output => { const match = output.match(/LOCKED:([0-9 :.+-]+)/); if (match) { deadline = match[1]; signal(); } });
    await Promise.race([locked, holder.then(() => { throw new Error('Lock holder ended before signal'); })]);
    const writer = connection(`SELECT clock_timestamp()<'${deadline}'::timestamptz; SELECT temporary_update('${hash}',1,'${doc.id}','{"content":"must not survive"}');`, output => { beganBeforeDeadline = output.startsWith('t\n'); });
    await expect(writer).rejects.toThrow('DEMO_RESET');
    await holder;
    expect(beganBeforeDeadline).toBe(true);
    const actor = JSON.parse(await sql(`SELECT temporary_session('${hash}');`));
    expect(actor.generation).toBe(2); expect(actor.persona).toBe('charlie');
    expect(await sql(`SELECT count(*) FROM temporary_private.documents WHERE id='${doc.id}' OR content='must not survive';`)).toBe('0');
  }, 10_000);
  it('rejects a transaction that owns the workspace before midnight but commits its save after midnight', async () => {
    const { hash, workspace } = await start();
    const doc = JSON.parse(await sql(`SELECT temporary_create('${hash}',1,'{"title":"original","content":"original"}');`));
    await expect(sql(`BEGIN;
      UPDATE temporary_private.workspaces SET reset_at=clock_timestamp()+interval '200 milliseconds' WHERE id='${workspace}';
      SELECT temporary_update('${hash}',1,'${doc.id}','{"content":"late commit"}');
      SELECT pg_sleep(0.4);
      COMMIT;`)).rejects.toThrow('DEMO_RESET');
    expect(await sql(`SELECT content FROM temporary_private.documents WHERE id='${doc.id}';`)).toBe('original');
  });
  it('allows only one reset and one fixture set across concurrent refresh and cleanup calls', async () => {
    const { hash, workspace } = await start();
    await sql(`UPDATE temporary_private.workspaces SET reset_at=clock_timestamp() WHERE id='${workspace}';`);
    const actors = await Promise.all(Array.from({ length: 8 }, () => sql(`SELECT temporary_session('${hash}');`)));
    await Promise.all([sql('SELECT reset_due_demos();'), sql('SELECT purge_expired_workspaces();')]);
    expect(actors.map(value => JSON.parse(value).generation)).toEqual(Array(8).fill(2));
    expect(await sql(`SELECT count(*) FROM temporary_private.documents WHERE workspace_id='${workspace}';`)).toBe('3');
    expect(await sql(`SELECT count(*) FROM temporary_private.shares sh JOIN temporary_private.documents d ON d.id=sh.document_id WHERE d.workspace_id='${workspace}';`)).toBe('6');
  });
  it('keeps guests accessible before the fixed deadline and denies them at and after it', async () => {
    const { hash, workspace } = await start('guest');
    expect(await sql(`SELECT expires_at-created_at=interval '5 hours' FROM temporary_private.sessions WHERE token_hash='${hash}';`)).toBe('t');
    await sql(`UPDATE temporary_private.workspaces SET expires_at=clock_timestamp()+interval '1 minute' WHERE id='${workspace}';`);
    expect(await sql(`SELECT temporary_list('${hash}',1);`)).toBe('[]');
    await sql(`UPDATE temporary_private.workspaces SET expires_at=clock_timestamp() WHERE id='${workspace}';`);
    await expect(sql(`SELECT temporary_list('${hash}',1);`)).rejects.toThrow('SESSION_EXPIRED');
    await sql(`UPDATE temporary_private.workspaces SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${workspace}';`);
    await expect(sql(`SELECT temporary_create('${hash}',1,'{"title":"late","content":"denied"}');`)).rejects.toThrow('SESSION_EXPIRED');
    await sql('SELECT purge_expired_workspaces();');
    expect(await sql(`SELECT count(*) FROM temporary_private.workspaces WHERE id='${workspace}';`)).toBe('0');
  });
  it('runs registered cleanup and reset commands with observable success and safe replay', async () => {
    const cleanup = await sql("SELECT command FROM cron.job WHERE jobname='ai-docs-expiry-minute';");
    const reset = await sql("SELECT command FROM cron.job WHERE jobname='ai-docs-demo-midnight';");
    expect(cleanup).not.toBe(''); expect(reset).not.toBe('');
    await sql(cleanup); await sql(reset); await sql(reset);
    expect(await sql("SELECT count(*)>0 FROM temporary_private.maintenance_runs WHERE job_name='purge' AND finished_at>clock_timestamp()-interval '1 minute';")).toBe('t');
    expect(await sql("SELECT count(*)>0 FROM temporary_private.maintenance_runs WHERE job_name='reset' AND finished_at>clock_timestamp()-interval '1 minute';")).toBe('t');
    // The real extension, not a shim, owns durable error reports on this stack.
    expect(await sql("SELECT to_regclass('cron.job_run_details') IS NOT NULL;")).toBe('t');
  });
});
