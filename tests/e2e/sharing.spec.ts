import {test,expect,enterDemo} from '../helpers/browser';
test('demo owner can grant view access and the recipient cannot edit',async({page})=>{
 await enterDemo(page);await page.getByText('Blank Document',{exact:true}).click();await expect(page).toHaveURL(/documents\/[a-f0-9-]+/);
 const path=new URL(page.url()).pathname;
 await page.getByRole('button',{name:'Share',exact:true}).click();await page.getByLabel('Demo recipient').selectOption('bob');await page.getByLabel('Permission',{exact:true}).selectOption('view');await page.getByRole('button',{name:'Grant access',exact:true}).click();await expect(page.getByText('Bob Miller',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByLabel('Demo persona').selectOption('bob');await expect(page).toHaveURL('/');await page.goto(path);await expect(page.getByText('View only',{exact:true})).toBeVisible();await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
});
