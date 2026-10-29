import {afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {securityHeaders} from '../../lib/security/headers';
afterEach(()=>vi.unstubAllEnvs());
it('uses a fresh script nonce with no production eval or inline script exception',()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://db.example.test');
 const a=securityHeaders(),b=securityHeaders();expect(a.nonce).not.toBe(b.nonce);
 expect(a.csp).toContain(`'nonce-${a.nonce}'`);expect(a.csp).toContain("frame-ancestors 'none'");
 expect(a.csp).toContain('https://db.example.test wss://db.example.test');
 expect(a.csp.split(';').find(s=>s.trim().startsWith('script-src'))).not.toMatch(/unsafe-inline|unsafe-eval/);
 expect(a.headers['X-Content-Type-Options']).toBe('nosniff');
});
