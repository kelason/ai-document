import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e',fullyParallel:false,forbidOnly:!!process.env.CI,retries:0,workers:1,
 reporter:'./tests/helpers/redacted-reporter.ts',timeout:30000,
 use:{baseURL:'https://localhost:3000',ignoreHTTPSErrors:true,trace:'off',screenshot:'off',video:'off'},
 // No auth cookies, confirmation tokens, or document content in CI artifacts.
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:{command:'node scripts/test-env.mjs',url:'https://localhost:3000',ignoreHTTPSErrors:true,reuseExistingServer:false,timeout:60000},
});
