import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Run with Node 24: node scripts/build-demo-seed.ts [--check].
// Fixtures are reviewed source, never production user content.
const persona = z.enum(['alice', 'bob', 'charlie']);
const fixture = z.object({ documents: z.array(z.object({
  key: z.string().regex(/^[a-z-]+$/), owner: persona,
  title: z.string().min(1).max(200), content: z.string().max(1048576),
  history: z.array(z.object({ title: z.string().min(1).max(200), content: z.string().max(1048576), updatedBy: z.string() })).max(50),
  shares: z.array(z.object({ persona, permission: z.enum(['view', 'edit']) })),
})).length(3) }).parse(JSON.parse(readFileSync(resolve('supabase/fixtures/demo.json'), 'utf8')));
if (new Set(fixture.documents.map(d => d.key)).size !== 3) throw new Error('Duplicate fixture key');
const path = resolve('supabase/migrations/202610270006_expiry_and_demo_reset.sql');
const source = readFileSync(path, 'utf8');
const generated = `-- BEGIN GENERATED DEMO FIXTURE\nCREATE OR REPLACE FUNCTION temporary_private.demo_fixture() RETURNS jsonb\nLANGUAGE sql IMMUTABLE SET search_path='' AS $fixture$\n SELECT '${JSON.stringify(fixture).replaceAll("'", "''")}'::jsonb;\n$fixture$;\n-- END GENERATED DEMO FIXTURE`;
const result = source.replace(/-- BEGIN GENERATED DEMO FIXTURE[\s\S]*?-- END GENERATED DEMO FIXTURE/, generated);
if (!source.includes('-- BEGIN GENERATED DEMO FIXTURE')) throw new Error('Missing generated fixture marker');
if (process.argv.includes('--check')) {
  if (result !== source) throw new Error('Demo SQL fixture is stale; run node scripts/build-demo-seed.ts');
} else writeFileSync(path, result);
