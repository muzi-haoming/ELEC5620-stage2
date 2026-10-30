// UI contract test with isolated fixtures. No live orders, payments or database writes.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createQuote, purchase, advanceOrder} from '../src/domain-v2.mjs';

const browser = await chromium.launch({headless:true, channel:'msedge'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  const state = JSON.parse(await readFile(new URL('../../backend/app/seed.json', import.meta.url),'utf8'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/state',r=>r.fulfill({json:state}));
  await page.route('**/api/delivery-options',r=>r.fulfill({json:[{id:'economy',price:75},{id:'express',price:110}]}));
  let release, attempts=0;
  const event=(key,label,status)=>({type:'progress',key,label,status,ms:status==='done'?2:undefined});
  await page.route('**/api/actions',async route=>{
    const {operation,payload}=route.request().postDataJSON();
    if(operation==='discard_quotes')return route.fulfill({json:{result:true,state}});
    await new Promise(resolve=>{release=resolve;});
    let result, label;
    if(operation==='quote') {
      if(attempts++===0)return route.fulfill({contentType:'application/x-ndjson',body:[event('check','物流：检查配送资料、门尺寸与装卸条件','failed'),{type:'error',detail:'门宽或门高不足，请调整配送方案。'}].map(x=>JSON.stringify(x)).join('\n')+'\n'});
      result=createQuote(state,payload.itemId,payload.delivery);label='物流：检查配送资料、门尺寸与装卸条件';
    } else if(operation==='purchase') {
      result=purchase(state,payload.quoteId,payload.method);label='付款：核对付款方式、报价有效期与家具状态';
    } else {
      result=advanceOrder(state,payload.orderId,payload.action);label='结算：核对送达记录、交付问题与留置资金';
    }
    const events=[event('check',label,'running'),event('check',label,'done'),event('save','保存结果与账本（提交后生效）','done'),{type:'result',result,state}];
    await route.fulfill({contentType:'application/x-ndjson',body:events.map(x=>JSON.stringify(x)).join('\n')+'\n'});
  });
  await page.goto('http://127.0.0.1:5625/#/buyer/items/F-101/delivery');
  await page.getByLabel('送货地址 *',{exact:true}).fill('25 Demo Road, Glebe NSW');
  const quoteButton=page.getByRole('button',{name:'确认配送方案 →'});
  await quoteButton.click();
  await page.getByText('正在连接服务…',{exact:true}).waitFor();release();
  await page.locator('.activity-failed').waitFor();
  assert.equal(await page.getByLabel('送货地址 *',{exact:true}).inputValue(),'25 Demo Road, Glebe NSW');
  assert.equal(await page.locator('.activity-failed .loading-spinner').count(),0);
  await quoteButton.click();await page.getByText('正在连接服务…',{exact:true}).waitFor();release();
  await page.waitForURL('**/buyer/checkout/**');
  await page.locator('input[type=checkbox]').check();
  await page.locator('select').selectOption('BPAY');
  await page.getByRole('button',{name:/前往付款/}).click();
  await page.getByRole('button',{name:/完成演示付款/}).click();
  await page.getByText('正在处理付款…',{exact:true}).waitFor();
  assert.equal(await page.locator('.modal .agent-progress').count(),0);release();
  const paid=page.getByRole('button',{name:'付款agent已确认收到款',exact:true});
  await paid.waitFor();assert.ok(await paid.isDisabled());
  assert.equal(await paid.getAttribute('aria-busy'),'false');
  assert.equal(await paid.locator('.loading-spinner').count(),0);
  await page.getByRole('link',{name:'查看订单 →',exact:true}).click();
  await page.waitForURL('**/buyer/orders/**');
  await page.locator('.payment-held').getByText('已付款',{exact:true}).waitFor();
  assert.equal(await page.locator('.agent-progress').count(),0);
  assert.equal(await page.locator('.delivery-checks').count(),1);
  const order=state.orders[0];
  advanceOrder(state,order.id,'book');advanceOrder(state,order.id,'pickup');advanceOrder(state,order.id,'deliver');
  await page.reload();
  await page.getByRole('button',{name:'确认完好收货',exact:true}).click();
  await page.locator('.modal').getByRole('button',{name:'确认完好收货',exact:true}).click();
  await page.locator('.modal button[aria-busy=true]').waitFor();
  assert.equal(await page.locator('.modal .agent-progress').count(),0);release();
  await page.locator('.payment-held').getByText('交易完成',{exact:true}).waitFor();
  const settled=page.getByRole('button',{name:'付款agent已完成结算',exact:true});
  await settled.waitFor();assert.ok(await settled.isDisabled());
  assert.equal(await settled.getAttribute('aria-busy'),'false');
  await page.getByRole('button',{name:'返回订单',exact:true}).click();
  assert.equal(await page.locator('.agent-progress').count(),0);
  if(process.env.QA_OUTPUT)await page.screenshot({path:process.env.QA_OUTPUT+'/order-progress.png',fullPage:true});
  await page.getByRole('button',{name:'EN',exact:true}).click();
  assert.equal(await page.locator('.delivery-checks').evaluate(e=>/[\u3400-\u9fff]/.test(e.textContent)),false);

  let reportRelease,reportCalls=0,reportReady,failReport=false;
  let ready=new Promise(resolve=>{reportReady=resolve;});
  await page.route('**/api/reports?**',async route=>{
    reportCalls++;await new Promise(resolve=>{reportRelease=resolve;reportReady();});
    if(failReport)return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify(event('read','审计：读取数据库订单与结算记录','running'))+'\n'+JSON.stringify({type:'error',detail:'Unavailable'})+'\n'});
    await route.fulfill({contentType:'application/x-ndjson',body:[event('read','审计：读取数据库订单与结算记录','done'),event('audit-save','审计：保存报告查询记录','done'),{type:'result',result:{count:state.orders.length,sales:123,income:4,held:0}}].map(x=>JSON.stringify(x)).join('\n')+'\n'});
  });
  await page.goto('http://127.0.0.1:5625/#/manager/overview');
  await ready;await page.locator('.agent-progress-head .loading-spinner').waitFor();reportRelease();
  await page.locator('.activity-done').waitFor();
  const reportButton=page.getByRole('button',{name:'Generate business report',exact:true});
  ready=new Promise(resolve=>{reportReady=resolve;});
  await reportButton.click();await ready;await page.locator('.agent-progress-head .loading-spinner').waitFor();reportRelease();
  await page.locator('.activity-done').waitFor();
  assert.equal(reportCalls,2);
  if(process.env.QA_OUTPUT)await page.screenshot({path:process.env.QA_OUTPUT+'/report-progress.png',fullPage:true});
  failReport=true;ready=new Promise(resolve=>{reportReady=resolve;});
  await reportButton.click();await ready;reportRelease();
  await page.locator('.activity-failed').waitFor();
  assert.equal(await page.locator('.activity-failed .loading-spinner').count(),0);
  failReport=false;ready=new Promise(resolve=>{reportReady=resolve;});
  await reportButton.click();await ready;reportRelease();
  await page.locator('.activity-done').waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:5625/#/buyer/orders/'+order.id);
  await page.locator('.delivery-checks').waitFor();
  assert.ok(await page.locator('.delivery-checks').evaluate(e=>e.getBoundingClientRect().right<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS: quote failure/retry, payment and settlement dialogs, retained actual steps, delivery checks, EN labels, report generation and same-date regeneration.');
} finally {await browser.close();}

