// Isolated UI checks: settlement uses final server evidence; delivery colours follow real fields.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {advanceOrder} from '../src/domain-v2.mjs';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const state=JSON.parse(await readFile(new URL('../../backend/app/seed.json',import.meta.url),'utf8'));
  const order=state.orders.find(o=>o.status==='pending');
  order.requests=[];order.providerAccepted=false;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/state',r=>r.fulfill({json:state}));
  let release,signal,failed=true,calls=0;
  let ready=new Promise(resolve=>{signal=resolve;});
  await page.route('**/api/actions',async route=>{
    calls++;await new Promise(resolve=>{release=resolve;signal();});
    if(failed)return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'error',detail:'测试结算未完成，请重试。'})+'\n'});
    advanceOrder(state,order.id,'confirm');
    return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:order,state})+'\n'});
  });
  const base='http://127.0.0.1:5625/#/buyer/orders/'+order.id;
  await page.goto(base);
  const results=page.locator('.delivery-result');await results.first().waitFor();
  async function checkColours(completed){
    assert.equal(await results.count(),4);
    const colours=await results.evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).color));
    assert.deepEqual(colours,Array.from({length:4},(_,i)=>i<completed?'rgb(30, 120, 60)':'rgb(159, 69, 69)'));
  }
  await checkColours(1); // No property reply required: the first condition is already met.
  advanceOrder(state,order.id,'book');await page.reload();await results.first().waitFor();await checkColours(2);
  advanceOrder(state,order.id,'pickup');await page.reload();await results.first().waitFor();await checkColours(3);
  advanceOrder(state,order.id,'deliver');await page.reload();await results.first().waitFor();await checkColours(4);
  await page.getByRole('button',{name:'确认完好收货',exact:true}).click();
  const submit=page.locator('.modal').getByRole('button',{name:'确认完好收货',exact:true});
  await submit.click();await ready;
  assert.equal(await page.getByRole('button',{name:'付款agent已完成结算',exact:true}).count(),0);
  release();await page.locator('.toast-error').waitFor();
  await page.locator('.modal button[aria-busy=true]').waitFor({state:'hidden'});
  assert.ok(await submit.isEnabled());
  assert.equal(await page.getByRole('button',{name:'付款agent已完成结算',exact:true}).count(),0);
  await page.locator('.toast-error button').click();
  failed=false;ready=new Promise(resolve=>{signal=resolve;});
  await submit.click();await ready;release();
  const success=page.getByRole('button',{name:'付款agent已完成结算',exact:true});
  await success.waitFor();assert.ok(await success.isDisabled());
  assert.equal(await success.getAttribute('aria-busy'),'false');
  assert.equal(await success.locator('.loading-spinner').count(),0);
  assert.equal(await page.locator('.modal').count(),1);
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.getByRole('button',{name:'Payment Agent has completed settlement',exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to order',exact:true}).click();
  assert.equal(await page.locator('.modal').count(),0);
  assert.equal(calls,2);assert.deepEqual(errors,[]);
  console.log('PASS: four delivery status colours, no premature settlement success, failure/retry, completed button without spinner, EN and return to order.');
} finally {await browser.close();}
