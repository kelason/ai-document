import { expect, test } from '@playwright/test';
const initial={session:null,csrfToken:'test-csrf',serverNow:'2026-10-27T00:00:00Z'};
test('public entry exposes Google, account and isolated temporary choices',async ({page}) => {
 await page.route('**/api/session',route=>route.fulfill({json:initial}));
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Create account',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue as guest'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Try Alice demo'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Try Bob demo'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Try Charlie demo'})).toBeVisible();
});
test('guest expiry on focus removes editor content and pending autosaves',async ({page}) => {
 let expired=false; let writes=0;
 await page.route('**/api/session',route=>route.fulfill({status:expired?410:200,json:expired?{...initial,code:'SESSION_EXPIRED',error:'Expired'}:{...initial,session:{kind:'guest',workspaceId:'w',sessionId:'s',generation:1,expiresAt:'2099-01-01T00:00:00Z'}}}));
 await page.route('**/api/documents/doc',route=> { if(route.request().method()==='PATCH') writes++; return route.fulfill({json:{id:'doc',title:'Private guest draft',content:'<p>Guest secret content</p>',owner:'Guest',history:[],shares:[],attachments:[],permissions:{role:'owner',allowedOperations:['read','edit','upload','restore','delete']}}}); });
 await page.goto('/documents/doc'); await expect(page.getByText('Guest secret content',{exact:true})).toBeVisible();
 await page.locator('[contenteditable=true]').fill('Pending unsaved content'); expired=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText('Pending unsaved content',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Your guest session has expired.')).toBeVisible();
 await page.waitForTimeout(1500); expect(writes).toBe(0);
});
test('viewer permissions hide import, share and revision restore',async ({page})=>{
 await page.route('**/api/session',route=>route.fulfill({json:{...initial,session:{kind:'user',userId:'u',displayName:'Reader',email:'reader@example.test'}}}));
 await page.route('**/api/documents/doc',route=>route.fulfill({json:{id:'doc',title:'Read only',content:'<p>Shared text</p>',owner:'Same display name',history:[],shares:[],attachments:[],permissions:{role:'viewer',allowedOperations:['read','presence']}}}));
 await page.goto('/documents/doc'); await expect(page.getByText('Shared text',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Import',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Share',exact:true})).toHaveCount(0);
 await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
});
