import {test,expect,enterGuest,enterDemo,session} from '../helpers/browser';
import {localSql} from '../helpers/sql';
test('a second visitor cannot load another guest document by guessing its id',async({page,browser})=>{
 await enterGuest(page);await page.getByText('Blank Document',{exact:true}).click();await expect(page).toHaveURL(/documents\/[a-f0-9-]+/);const path=new URL(page.url()).pathname;
 const other=await browser.newContext({baseURL:'https://localhost:3000',ignoreHTTPSErrors:true,extraHTTPHeaders:{'x-ai-docs-test-client':crypto.randomUUID()}});
 try{const tab=await other.newPage();await enterGuest(tab);await tab.goto(path);await expect(tab.getByRole('heading',{name:'Document not found'})).toBeVisible();}finally{await other.close();}
});
test('absolute guest expiry clears private content after focus even before cleanup',async({page})=>{
 await enterGuest(page);await page.getByText('Blank Document',{exact:true}).click();await expect(page).toHaveURL(/documents\/[a-f0-9-]+/);
 const current=await session(page);const workspace=current.session.workspaceId;expect(workspace).toMatch(/^[a-f0-9-]{36}$/);
 await localSql(`UPDATE temporary_private.workspaces SET expires_at=clock_timestamp() WHERE id='${workspace}';`);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('button',{name:'Continue as guest'})).toBeVisible();await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
});
test('midnight reset restores fixtures and rejects an old generation save',async({page})=>{
 await enterDemo(page);const old=await session(page);const workspace=old.session.workspaceId;expect(workspace).toMatch(/^[a-f0-9-]{36}$/);
 const docs=await page.evaluate(async()=> (await fetch('/api/documents')).json());
 await localSql(`UPDATE temporary_private.workspaces SET reset_at=clock_timestamp() WHERE id='${workspace}';`);
 const status=await page.evaluate(async({doc,csrf,generation})=>(await fetch(`/api/documents/${doc}`,{method:'PATCH',headers:{'content-type':'application/json','x-csrf-token':csrf,'x-workspace-generation':String(generation)},body:JSON.stringify({content:'must not survive'})})).status,{doc:docs[0].id,csrf:old.csrfToken,generation:old.session.generation});
 expect(status).toBe(409);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(async()=> (await session(page)).session.generation).toBe(old.session.generation+1);
 const fresh=await page.evaluate(async()=> (await fetch('/api/documents')).json());expect(fresh.some((d:{id:string})=>d.id===docs[0].id)).toBe(false);
});
