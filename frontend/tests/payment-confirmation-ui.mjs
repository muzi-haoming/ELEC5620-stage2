// Payment confirmation waits for the final server result. Uses isolated fixture APIs only.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createQuote,purchase} from '../src/domain-v2.mjs';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
  for(const method of ['BPAY','Visa / Mastercard']) {
    const page=await browser.newPage({viewport:{width:1280,height:1000}});
    const state=JSON.parse(await readFile(new URL('../../backend/app/seed.json',import.meta.url),'utf8'));
    const quote=createQuote(state,'F-101',{address:'25 Demo Road, Glebe NSW',door:100,doorHeight:210,floor:0,access:'ground',movers:2,loading:true,pickupAccess:true,pickupProperty:false,deliveryProperty:false,provider:'economy'});
    await page.route('**/api/state',r=>r.fulfill({json:state}));
    let release,signal,failed=true,calls=0;
    let ready=new Promise(resolve=>{signal=resolve;});
    await page.route('**/api/actions',async route=>{
      calls++;
      await new Promise(resolve=>{release=resolve;signal();});
      if(failed)return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'error',status:503,detail:'测试付款未完成，请重试。'})+'\n'});
      const order=purchase(state,quote.id,method);
      return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:order,state})+'\n'});
    });
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5625/#/buyer/checkout/'+quote.id);
    await page.locator('input[type=checkbox]').check();
    await page.locator('select').selectOption(method);
    await page.getByRole('button',{name:/前往付款/}).click();
    if(method!=='BPAY'){
      await page.getByLabel('持卡人姓名（测试）',{exact:true}).fill('Demo User');
      await page.getByLabel('卡号（测试）',{exact:true}).fill('4242424242424242');
      await page.getByLabel('有效期（测试）',{exact:true}).fill('12/30');
      await page.getByLabel('安全码（测试）',{exact:true}).fill('123');
    }
    const submit=page.getByRole('button',{name:/完成演示付款/});
    await submit.click();await ready;
    assert.equal(await page.getByRole('button',{name:'付款agent已确认收到款',exact:true}).count(),0);
    release();await page.locator('.toast-error').waitFor();
    assert.equal(await page.getByRole('button',{name:'付款agent已确认收到款',exact:true}).count(),0);
    await page.locator('.modal button[aria-busy=true]').waitFor({state:'hidden'});
    assert.ok(await submit.isEnabled());
    await page.locator('.toast-error button').click();
    failed=false;ready=new Promise(resolve=>{signal=resolve;});
    await submit.click();await ready;release();
    const confirmed=page.getByRole('button',{name:'付款agent已确认收到款',exact:true});
    await confirmed.waitFor();
    assert.ok(await confirmed.isDisabled());
    assert.equal(await confirmed.getAttribute('aria-busy'),'false');
    assert.equal(await confirmed.locator('.loading-spinner').count(),0);
    assert.ok(page.url().includes('/buyer/checkout/'));
    await page.getByRole('button',{name:'EN',exact:true}).click();
    await page.getByRole('button',{name:'Payment Agent has confirmed receipt',exact:true}).waitFor();
    const link=page.locator('.modal a[href*="/buyer/orders/"]');
    await link.click();await page.waitForURL('**/buyer/orders/**');
    assert.equal(calls,2);assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS:',method,'waits for success, failure retries, stops spinning, blocks duplicates and opens order.');
  }
} finally {await browser.close();}
