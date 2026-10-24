import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',timeout:30000,workers:1,use:{baseURL:process.env.TEST_BASE_URL||'http://localhost:3000',browserName:'chromium',channel:'msedge',headless:true,screenshot:'only-on-failure'},reporter:[['list'],['json',{outputFile:'artifacts/browser-results.json'}]]});
