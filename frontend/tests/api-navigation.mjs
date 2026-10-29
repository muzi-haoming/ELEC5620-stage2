import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:5622/';
const errors=[];
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
page.on('request',r=>{if(r.url().includes('/api/state'))console.log('request',r.headers()['x-demo-role'])});
page.on('response',r=>{if(r.url().includes('/api/state'))console.log('response',r.status())});
page.on('pageerror',e=>errors.push(e.message));
try{
const response=await page.request.get(new URL('api/state',base).href);assert.equal(response.status(),200);
const s=await response.json();const o=s.orders.find(o=>o.requests.length);assert.ok(o,'A property-confirmation order is required');
for(const route of ['#/property-confirm/'+o.requests[0].token,'#/buyer/orders/'+o.id,'#/manager/overview','#/buyer/orders/'+o.id]){
 console.log('NAV',route);await page.goto(base+route);await page.waitForTimeout(3000);await page.getByText('正在加载…',{exact:true}).waitFor({state:'hidden',timeout:20000});const body=await page.locator('body').innerText();assert.ok(body.length>100,'Page must render content');assert.doesNotMatch(body,/加载失败|Failed to fetch/);console.log('BODY',body.slice(0,160));
}
assert.deepEqual(errors,[],'No browser runtime errors');
}finally{await browser.close()}
console.log('Cross-role navigation passed');
