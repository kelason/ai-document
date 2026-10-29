import {test,expect,enterGuest,session} from '../helpers/browser';
import {readFileSync} from 'node:fs';
test('packaged production worker imports TXT, Markdown and DOCX and rejects unsafe archives',async({page})=>{
 await enterGuest(page);await page.getByText('Blank Document',{exact:true}).click();await expect(page).toHaveURL(/documents\/[a-f0-9-]+/);
 const id=new URL(page.url()).pathname.split('/').at(-1)!;const current=await session(page);
 async function upload(filename:string,mime:string,bytes:Uint8Array){return page.evaluate(async({id,filename,mime,bytes,csrf,generation})=>{const form=new FormData();form.append('file',new File([new Uint8Array(bytes)],filename,{type:mime}));const r=await fetch(`/api/documents/${id}/upload`,{method:'POST',headers:{'x-csrf-token':csrf,'x-workspace-generation':String(generation)},body:form});return {status:r.status,body:await r.json()};},{id,filename,mime,bytes:[...bytes],csrf:current.csrfToken,generation:current.session.generation});}
 const txt=await upload('notes.txt','text/plain',new TextEncoder().encode('<script>test</script>'));expect(txt.status).toBe(200);expect(txt.body.html).toContain('&lt;script&gt;');
 const md=await upload('notes.md','text/markdown',new TextEncoder().encode('**formatted**'));expect(md.status).toBe(200);expect(md.body.html).toContain('<strong>formatted</strong>');
 const docx=await upload('safe.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',readFileSync('tests/fixtures/imports/safe.docx'));expect(docx.status).toBe(200);expect(docx.body.html).toContain('<strong>safe</strong>');
 const unsafe=await upload('external.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',readFileSync('tests/fixtures/imports/external.docx'));expect(unsafe.status).toBe(400);
});
