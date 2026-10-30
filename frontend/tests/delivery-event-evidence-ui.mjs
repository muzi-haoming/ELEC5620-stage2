// Isolated UI fixtures; never calls live business endpoints or creates a real order.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const state=JSON.parse(await readFile(new URL('../../backend/app/seed.json',import.meta.url),'utf8'));
  const order=state.orders.find(o=>o.status==='pending');
  order.status='transit';order.providerAccepted=true;
  const execution={requestId:'UI-DIRECT-PICKUP',operation:'advance',action:'pickup',steps:[
    {agent:'System',mode:'delivery_event',modelCall:'not_called',summary:'校验并记录取货模拟事件。'},
    {agent:'BusinessRules',mode:'outcome_check',modelCall:'not_called',summary:'结果检查通过。'}
  ]};
  order.events.push({agent:'System',time:state.now,text:'承运方已取货，配送中。',execution,
    facts:{action:'pickup',checks:[{label:'承运方已接受',result:'passed'}],changes:[{field:'status',before:'pending',after:'transit'}]}});
  state.audit.push({id:'UI-EVENT',time:state.now,agent:'System',text:'已记录取货',object:order.id,execution});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/state',route=>{
    const visible=structuredClone(state);
    if(route.request().headers()['x-demo-role']!=='manager'){
      visible.audit=[];visible.policies=[];visible.exceptions=[];
      for(const o of visible.orders)for(const e of o.events){e.agent='系统消息';delete e.execution;delete e.facts;}
    }
    return route.fulfill({json:visible});
  });
  await page.goto('http://127.0.0.1:5625/#/manager/records/'+order.id);
  await page.getByRole('button',{name:'查看本次请求工作流 ↗'}).click();
  const workflow=page.locator('#workflow-UI-DIRECT-PICKUP');
  await workflow.waitFor({state:'visible'});
  assert.equal(await workflow.getByText('系统事件更新 · 未调用 AI',{exact:true}).count(),1);
  assert.equal(await workflow.getByText('LogisticsAgent',{exact:true}).count(),0);
  await page.goto('http://127.0.0.1:5625/#/buyer/orders/'+order.id);
  await page.locator('.delivery-checks').waitFor();
  assert.equal(await page.locator('.execution-details').count(),0);
  assert.equal(await page.locator('.agent-progress').count(),0);
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.goto('http://127.0.0.1:5625/#/manager/records/'+order.id);
  await page.getByRole('button',{name:'View this request workflow ↗'}).click();
  await page.locator('#workflow-UI-DIRECT-PICKUP').getByText('System event update · no AI call',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: creator sees truthful system-event/no-AI evidence; buyer sees no internal workflow; EN label works.');
} finally {await browser.close();}
