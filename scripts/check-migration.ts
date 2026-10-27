/** Read-only release guard. Run with Node 24: node scripts/check-migration.ts.
 * Database upgrade checks: RUN_MIGRATION_DB_TESTS=1 npm run test:integration -- tests/integration/migration.test.ts
 * This script never applies SQL or accepts production database credentials.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkMigrationSafety(root = process.cwd()): string[] {
  const failures: string[] = [];
  if (existsSync(resolve(root, 'app/api/migrate/route.ts'))) failures.push('Public migration route still exists');
  for (const file of ['supabase_schema.sql', 'fix_rls.sql']) {
    const source = readFileSync(resolve(root, file), 'utf8');
    if (/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(source)) failures.push(`${file} disables RLS`);
    if (!source.includes('supabase/migrations')) failures.push(`${file} must direct operators to versioned migrations`);
  }
  const directory = resolve(root, 'supabase/migrations');
  const files = existsSync(directory) ? readdirSync(directory).filter((file) => file.endsWith('.sql')).sort() : [];
  for (const name of ['202610270001_archive_legacy.sql', '202610270002_persistent_schema.sql']) {
    if (!files.includes(name)) failures.push(`Missing migration ${name}`);
  }
  for (const file of files) {
    const source = readFileSync(resolve(directory, file), 'utf8');
    if (/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(source)) failures.push(`${file} disables RLS`);
    // Conservative lint only; role-switched database tests remain authoritative.
    if (/GRANT\s+[^;]*\bON\b[^;]*\blegacy_archive\b[^;]*\bTO\s+[^;]*\b(?:PUBLIC|anon|authenticated|service_role)\b/i.test(source)) failures.push(`${file} exposes the archive`);
  }
  const config = resolve(root, 'supabase/config.toml');
  if (!existsSync(config)) failures.push('Missing local Supabase configuration');
  else if (/schemas\s*=\s*\[[^\]]*legacy_archive/.test(readFileSync(config, 'utf8'))) failures.push('Archive exposed in API schema list');
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = checkMigrationSafety();
  for (const failure of failures) console.error(failure);
  if (failures.length) process.exitCode = 1;
  else console.log('Migration release guard passed (read-only; database execution is a separate check).');
}
