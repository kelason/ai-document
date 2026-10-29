import {test,expect,enterGuest,session} from '../helpers/browser';
test('anonymous API access and cross-origin or tokenless writes are denied',async({page})=>{
 await page.goto('/');const anonymous=await page.evaluate(async()=> (await fetch('/api/documents')).status);expect(anonymous).toBe(401);
 await enterGuest(page);const snapshot=await session(page);
 const missing=await page.evaluate(async()=> (await fetch('/api/documents',{method:'POST',headers:{'content-type':'application/json','x-workspace-generation':'1'},body:JSON.stringify({title:'No CSRF',content:''})})).status);expect(missing).toBe(403);
 const extra=await page.evaluate(async(csrf)=>(await fetch('/api/documents',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'x-workspace-generation':'1'},body:JSON.stringify({title:'Forged owner',content:'',owner:'Alice Cooper'})})).status,snapshot.csrfToken);expect(extra).toBe(400);
});
test('guest can end a session and cannot return to its old document',async({page})=>{
 await enterGuest(page);await page.getByText('Blank Document',{exact:true}).click();await expect(page).toHaveURL(/documents\/[a-f0-9-]+/);const path=new URL(page.url()).pathname;
 await page.getByRole('button',{name:'End session',exact:true}).click();await expect(page.getByRole('button',{name:'Continue as guest'})).toBeVisible();await page.goto(path);await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
});
