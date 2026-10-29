import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {localSql} from '../helpers/sql';
it('passes the administrator read-only deployment guard against the isolated database',async()=>{
 expect(await localSql(readFileSync('scripts/check-deployment.sql','utf8'))).toContain('Database deployment checks passed.');
});

it('rejects disabled RLS without retaining the test schema mutation',async()=>{
 const guard=readFileSync('scripts/check-deployment.sql','utf8').replace('BEGIN READ ONLY;','').replace('ROLLBACK;','');
 await expect(localSql('BEGIN;ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;'+guard+'ROLLBACK;')).rejects.toThrow('Persistent RLS is missing');
 expect(await localSql("SELECT relrowsecurity FROM pg_class WHERE oid='public.documents'::regclass;")).toBe('t');
});
it('rejects a missing reset job without retaining the test scheduler mutation',async()=>{
 const guard=readFileSync('scripts/check-deployment.sql','utf8').replace('BEGIN READ ONLY;','').replace('ROLLBACK;','');
 await expect(localSql("BEGIN;DELETE FROM cron.job WHERE jobname='ai-docs-demo-midnight';"+guard+'ROLLBACK;')).rejects.toThrow('Temporary lifecycle schedules');
});
