import {expect,it} from 'vitest';
import {checkDeploymentEnvironment} from '../../scripts/check-deployment';
import {validateMigrationPreflight} from '../../scripts/check-migration';
it('blocks unacknowledged backup restoration and unknown database schemas',()=>{
 expect(validateMigrationPreflight(undefined,'legacy')).toContain('A tested backup/restore rehearsal reference is required');
 expect(validateMigrationPreflight('staging-rehearsal-20261029','unknown')).toContain('Unknown database schema; administrator review required');
 expect(validateMigrationPreflight('staging-rehearsal-20261029','legacy')).toEqual([]);
});
it('rejects insecure deployment origins and publicly named server secrets without printing values',()=>{
 const secret='do-not-print-private-fixture-value';const errors=checkDeploymentEnvironment({APP_ORIGIN:'http://public.example.test',NEXT_PUBLIC_CSRF_SECRET:secret});
 expect(errors).toContain('APP_ORIGIN must be a canonical HTTPS origin');expect(errors).toContain('A server secret has a public environment name');expect(errors.join('\n')).not.toContain(secret);
});
