import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:5622/';
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const buyer=await browser.newContext(),property=await browser.newContext();
const page=await buyer.newPage(),other=await property.newPage();
page.setDefaultTimeout(90000);other.setDefaultTimeout(90000);
async function command(operation,payload={},role='buyer'){
 const response=await buyer.request.post(base+'api/actions',{timeout:120000,headers:{'X-Demo-Role':role},data:{operation,payload,requestId:crypto.randomUUID()}});
 assert.equal(response.status(),200,await response.text());return (await response.json()).result;
}
try{
 const state=await buyer.request.get(base+'api/state').then(r=>r.json());
 const template=state.items.find(i=>i.status==='published');assert.ok(template);
 const item=await command('listing',{form:{...template,name:'Cross-browser QA '+Date.now(),contact:'qa@example.test'}},'seller');assert.equal(item.status,'published');
 const quote=await command('quote',{itemId:item.id,delivery:{address:'Cross browser test address',door:1000,doorHeight:1000,floor:2,movers:2,access:'stairs',loading:true,pickupAccess:true,provider:'economy',pickupProperty:true,pickupEmail:'pickup@example.test',deliveryProperty:true,deliveryEmail:'delivery@example.test'}});
 const order=await command('purchase',{quoteId:quote.id,method:'BPAY'});
 await page.goto(base+'#/buyer/orders/'+order.id);await page.getByRole('heading',{name:'处理时间线'}).waitFor();
 await page.getByRole('button',{name:'EN',exact:true}).click();
 const request=order.requests[0];
 await other.goto(base+'#/property-confirm/'+request.token);await other.getByLabel('回复人姓名').fill('Independent manager');
 await other.getByLabel('允许搬运时段（可选）').fill('10:00–12:00');await other.getByLabel('电梯预约要求（可选）').fill('Reserved');await other.getByLabel('装卸限制（可选）').fill('Bay 2');
 await other.getByRole('button',{name:'提交物业回复'}).click();await other.getByRole('heading',{name:'回复已记录'}).waitFor();
 await page.getByText('10:00–12:00',{exact:false}).waitFor({timeout:10000});
 const body=await page.locator('main').innerText();assert.ok(body.includes('Time window:'));assert.ok(!body.includes('时段：'));assert.ok(!body.includes('LogisticsAgent'));
 assert.ok((await page.locator('.audit-item b').allTextContents()).every(x=>x==='System message'));
 const publicData=await property.request.get(base+'api/state',{headers:{'X-Demo-Role':'property','X-Property-Token':request.token}}).then(r=>r.json());
 assert.equal(publicData.orders.length,1);assert.equal(publicData.orders[0].requests.length,1);assert.equal(publicData.orders[0].paymentKey,undefined);
 await page.goto(base+'#/manager/records/'+order.id);await page.getByRole('heading',{name:'Internal settlement breakdown'}).waitFor();
 assert.ok((await page.locator('.audit-item b').allTextContents()).includes('LogisticsAgent'));
 await page.goto(base+'#/manager/overview');await page.getByRole('heading',{name:'Orders by stage'}).waitFor();
 assert.equal(await page.getByText('Awaiting settlement',{exact:true}).count(),0);
 console.log('PASS: independent-browser property update, bilingual returned fields, buyer masking, admin identities, four admin stages');
}finally{await browser.close();}
