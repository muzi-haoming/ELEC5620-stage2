import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage(),base='http://127.0.0.1:5623';
 const state=await(await page.request.get(base+'/api/state',{headers:{'X-Demo-Role':'seller'}})).json();
 await page.route('**/api/state',r=>r.fulfill({json:state}));
 let calls=0;
 await page.route('**/api/actions',r=>{calls++;return r.fulfill({status:503,json:{detail:'AI 暂时无法完成本次操作，资料已保留，请稍后重试。',retryable:true}})});
 await page.goto(base+'/#/seller/listings/new');await page.getByRole('button',{name:'EN',exact:true}).click();
 const name=page.locator('input[maxlength="80"]').first();await name.fill('Retained chair');
 const price=page.getByTestId('get-suggested-price');await price.click();
 await page.getByText('This request was not completed. Your entries are retained; please retry.',{exact:true}).waitFor();
 assert.equal(await name.inputValue(),'Retained chair');assert.ok(await price.isEnabled());
 await price.click();await page.locator('.request-progress').waitFor({state:'hidden'});assert.equal(calls,2);
 assert.equal(await name.inputValue(),'Retained chair');
 console.log('PASS: AI 503 preserves form, accurate incomplete message, and retry re-enabled.');
} finally { await browser.close(); }
