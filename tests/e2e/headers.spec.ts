import {test,expect} from '../helpers/browser';
test('production CSP uses a per-request nonce and the application hydrates',async({page})=>{
 await page.route('**/api/session',route=>route.fulfill({json:{session:null,csrfToken:'test',serverNow:new Date().toISOString()}}));
 const response=await page.goto('/');const headers=response!.headers();
 expect(headers['x-content-type-options']).toBe('nosniff');expect(headers['x-frame-options']).toBe('DENY');expect(headers['referrer-policy']).toBe('no-referrer');
 const nonce=/'nonce-([^']+)'/.exec(headers['content-security-policy'])?.[1];expect(nonce).toBeTruthy();
 expect(headers['content-security-policy'].split(';').find(s=>s.trim().startsWith('script-src'))).not.toMatch(/unsafe-eval|unsafe-inline/);
 expect(await page.locator('script[nonce]').first().evaluate((el:HTMLScriptElement)=>el.nonce)).toBe(nonce);
 await expect(page.getByRole('button',{name:'Continue as guest'})).toBeVisible();
 // Parser-inserted untrusted HTML must be blocked. CDP page.evaluate itself
 // is a trusted automation context and is not an XSS/CSP simulation.
 await page.route('https://localhost:3000/',async route=>{const original=await route.fetch();const html=await original.text();await route.fulfill({response:original,body:html.replace('<head>','<head><script>window.__blocked=true</script>')});});
 const second=await page.reload();expect(second!.headers()['content-security-policy']).not.toBe(headers['content-security-policy']);expect(await page.evaluate(()=>window.__blocked===true)).toBe(false);
});
declare global {interface Window{__blocked:boolean}}
