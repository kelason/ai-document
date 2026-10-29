/** Read-only release guard. Run with Node 24: node scripts/check-migration.ts.
 * Database upgrade checks: RUN_MIGRATION_DB_TESTS=1 npm run test:integration -- tests/integration/migration.test.ts
 * This script never applies SQL or accepts production database credentials.
 */
import {spawnSync} from 'node:child_process';
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

export function validateMigrationPreflight(backupReference:string|undefined,schema:string):string[]{
 const errors:string[]=[];
 if(!backupReference?.trim())errors.push('A tested backup/restore rehearsal reference is required');
 if(!['fresh','legacy','migrated'].includes(schema))errors.push('Unknown database schema; administrator review required');
 return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = checkMigrationSafety();
  if(process.argv.includes('--preflight')){
   const backup=process.env.BACKUP_RESTORE_REHEARSAL_ID;
   if(!backup?.trim())failures.push('A tested backup/restore rehearsal reference is required');
   if(!process.env.DATABASE_URL)failures.push('Missing DATABASE_URL');
   if(!failures.length){
    const query="BEGIN READ ONLY;SELECT CASE WHEN to_regclass('public.documents') IS NULL THEN 'fresh' WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='owner' AND data_type='text') THEN 'legacy' WHEN to_regclass('legacy_archive.migration_log') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='owner_id' AND data_type='uuid') THEN 'migrated' ELSE 'unknown' END;ROLLBACK;";
    const result=spawnSync('psql',['-XAtq','--no-password','--set','ON_ERROR_STOP=1','--dbname',process.env.DATABASE_URL!],{input:query,encoding:'utf8',env:{...process.env,PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c default_transaction_read_only=on'},timeout:30000});
    if(result.error||result.status!==0)failures.push('Read-only database preflight failed; inspect the target privately');
    else failures.push(...validateMigrationPreflight(backup,result.stdout.trim()));
   }
  }
  for (const failure of failures) console.error(failure);
  if (failures.length) process.exitCode = 1;
  else console.log('Migration release guard passed (read-only; database execution is a separate check).');
}
