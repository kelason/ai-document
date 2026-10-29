import {test as base,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
export const test=base.extend({context:async({browser},provide)=>{const context=await browser.newContext({baseURL:'https://localhost:3000',ignoreHTTPSErrors:true,extraHTTPHeaders:{'x-ai-docs-test-client':randomUUID()}});await provide(context);await context.close();}});
export {expect};
export async function enterGuest(page:Page){await page.goto('/');await page.getByRole('button',{name:'Continue as guest',exact:true}).click();await expect(page.getByText('Start a new document')).toBeVisible();}
export async function enterDemo(page:Page,persona='Alice'){await page.goto('/');await page.getByRole('button',{name:`Try ${persona} demo`,exact:true}).click();await expect(page.getByText('Start a new document')).toBeVisible();}
export async function session(page:Page){return page.evaluate(async()=>{const response=await fetch('/api/session');return response.json();});}
