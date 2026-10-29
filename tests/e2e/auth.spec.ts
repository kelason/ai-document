import {test,expect,enterGuest} from '../helpers/browser';
import {waitForAuthEmail} from '../helpers/auth';
import {integrationClients} from '../helpers/supabase';
test('signup verifies in another tab, explicitly saves guest work, then supports email login',async({page,context})=>{
 const clients=integrationClients();const email=`browser-${crypto.randomUUID()}@example.test`;const password=`Browser-${crypto.randomUUID()}`;let userId:string|undefined;
 try{
  await enterGuest(page);await page.getByText('Blank Document',{exact:true}).click();await expect(page).toHaveURL(/documents\/[a-f0-9-]+/);
  await page.getByLabel('Document title').fill('Keep this guest draft');await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.goto('/signup?next=%2F%3Ffrom%3Demail');await page.getByLabel('Display name').fill('Browser account');await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByText('Check your inbox to verify your email before opening your permanent workspace.')).toBeVisible();
  const emailLink=await waitForAuthEmail(email);const second=await context.newPage();await second.goto(emailLink.url);await expect(second).toHaveURL('/?from=email');
  const identity=await second.evaluate(async()=> (await fetch('/api/session')).json());userId=identity.session.userId;expect(identity.session.kind).toBe('user');
  // Login/confirmation has not silently claimed the guest source.
  await expect(second.getByText('Keep this guest draft',{exact:true})).toHaveCount(0);
  await second.getByRole('button',{name:'Save guest work',exact:true}).click();await expect(second.getByText('Keep this guest draft',{exact:true})).toBeVisible();
  await second.getByRole('button',{name:'Sign out',exact:true}).click();await expect(second.getByRole('button',{name:'Continue as guest'})).toBeVisible();
  await second.goto('/login');await second.getByLabel('Email address').fill(email);await second.getByLabel('Password',{exact:true}).fill(password);await second.getByRole('button',{name:'Log in',exact:true}).click();await expect(second.getByText('Keep this guest draft',{exact:true})).toBeVisible();
  await page.goto(emailLink.url);await expect(page).toHaveURL(/confirmation_invalid/);
 }finally{
  if(!userId){const users=await clients.admin.auth.admin.listUsers();userId=users.data.users.find(u=>u.email===email)?.id;}
  if(userId)await clients.admin.auth.admin.deleteUser(userId);
 }
});
test('spent and invalid email links offer a safe recovery path',async({page})=>{
 await page.goto('/auth/confirm?token_hash=invalid&type=email&next=https://evil.test');await expect(page).toHaveURL(/\/auth\?error=confirmation_invalid/);await expect(page.getByRole('heading',{name:'Log in to AI Docs'})).toBeVisible();
});
