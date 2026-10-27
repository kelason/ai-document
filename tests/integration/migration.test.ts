import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkMigrationSafety } from '../../scripts/check-migration';

const root = process.cwd();
const migrations = ['202610270001_archive_legacy.sql', '202610270002_persistent_schema.sql'];
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

// These tests do not substitute text matching for database verification. The
// guard runs everywhere; actual SQL checks require an explicitly opted-in local DB.
describe('migration release guard', () => {
  function fixture(run: (directory: string) => void) {
    const directory = mkdtempSync(resolve(tmpdir(), 'ai-docs-migration-guard-'));
    try {
      for (const path of ['supabase', 'supabase_schema.sql', 'fix_rls.sql']) {
        cpSync(resolve(root, path), resolve(directory, path), { recursive: true });
      }
      run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it('accepts the coordinated migration files', () => {
    expect(checkMigrationSafety(root)).toEqual([]);
  });

  it('rejects a restored public migration route', () => fixture((directory) => {
    mkdirSync(resolve(directory, 'app/api/migrate'), { recursive: true });
    writeFileSync(resolve(directory, 'app/api/migrate/route.ts'), 'export function GET() {}');
    expect(checkMigrationSafety(directory)).toContain('Public migration route still exists');
  }));

  it('rejects a routine setup script that disables RLS', () => fixture((directory) => {
    writeFileSync(resolve(directory, 'fix_rls.sql'), '-- supabase/migrations\nALTER TABLE documents DISABLE ROW LEVEL SECURITY;');
    expect(checkMigrationSafety(directory)).toContain('fix_rls.sql disables RLS');
  }));

  it.each([
    'GRANT USAGE ON SCHEMA legacy_archive TO anon;',
    'GRANT SELECT ON TABLE legacy_archive.documents TO authenticated;',
    'GRANT SELECT ON legacy_archive.documents TO postgres, service_role;',
  ])('rejects archive exposure: %s', (grant) => fixture((directory) => {
    writeFileSync(resolve(directory, 'supabase/migrations/202610279999_unsafe.sql'), grant);
    expect(checkMigrationSafety(directory)).toContain('202610279999_unsafe.sql exposes the archive');
  }));

  it('rejects exposing the archive through the data API', () => fixture((directory) => {
    writeFileSync(resolve(directory, 'supabase/config.toml'), '[api]\nschemas = ["public", "legacy_archive"]');
    expect(checkMigrationSafety(directory)).toContain('Archive exposed in API schema list');
  }));

  it.each([
    'postgresql://postgres:postgres@db.example.com:54322/postgres',
    'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
    'postgresql://postgres:postgres@127.0.0.1:54322/production',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=db.example.com',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres?hostaddr=203.0.113.1',
  ])('refuses an unsafe database test target: %s', (target) => {
    expect(() => assertLocalDatabaseTarget(target)).toThrow();
  });
});

const runDatabase = process.env.RUN_MIGRATION_DB_TESTS === '1';
const dbUrl = process.env.MIGRATION_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const cleanSchema = `
DROP TABLE IF EXISTS public.document_presence, public.document_attachments,
  public.document_shares, public.document_history, public.documents, public.profiles CASCADE;
DROP SCHEMA IF EXISTS legacy_archive CASCADE;
`;
const sql = (name: string) => read(`supabase/migrations/${name}`);
function assertLocalDatabaseTarget(target: string) {
  const url = new URL(target);
  // Deliberately refuse remote databases, even if a developer sets an env var.
  expect(['localhost', '127.0.0.1', '::1', '[::1]']).toContain(url.hostname);
  expect(url.port).toBe('54322');
  expect(url.pathname).toBe('/postgres');
  // libpq URI query parameters can override a safe-looking authority host.
  expect(url.search).toBe('');
  expect(url.hash).toBe('');
  expect(['postgres:', 'postgresql:']).toContain(url.protocol);
}
function checkDatabase(input: string) {
  assertLocalDatabaseTarget(dbUrl);
  const result = spawnSync('psql', ['-X', '--no-password', '--set', 'ON_ERROR_STOP=1', '--dbname', dbUrl], {
    input: `BEGIN;\n${cleanSchema}\n${input}\nROLLBACK;`, encoding: 'utf8', timeout: 30_000,
  });
  if (result.error) throw result.error;
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe.skipIf(!runDatabase)('isolated local database migrations (transaction rolled back)', () => {
  it('initializes an empty database without assigning legacy ownership', () => {
    checkDatabase(`${sql(migrations[0])}\n${sql(migrations[1])}\n${read('tests/integration/fixtures/assert-fresh.sql')}`);
  });
  it('preserves legacy IDs, content, history, shares and attachments and survives replay', () => {
    checkDatabase(`${read('tests/integration/fixtures/legacy-schema.sql')}\n${sql(migrations[0])}\n${sql(migrations[1])}\n${read('tests/integration/fixtures/assert-upgrade.sql')}\n${sql(migrations[0])}\n${sql(migrations[1])}\n${read('tests/integration/fixtures/assert-upgrade.sql')}`);
  });
});
