import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5623',browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const state=await(await page.request.get(base+'/api/state',{headers:{'X-Demo-Role':'manager'}})).json(),order=state.orders[0];
 const execution={requestId:'evidence-ui-request',operation:'advance',action:'confirm',steps:[
  {agent:'LogisticsAgent',modelCall:'not_called',summary:'DO NOT PRESENT THIS AS EVIDENCE',durationMs:0},
  {agent:'PaymentAgent',modelCall:'not_called',durationMs:0},
  {agent:'SupervisionAgent',mode:'policy'}]};
 order.events=[
  {agent:'LogisticsAgent',text:'Historical delivery',time:state.now},
  {agent:'Buyer',text:'Acceptance recorded',time:state.now,facts:{action:'confirm',checks:[{label:'订单已收货且有送达记录',result:'passed'}],changes:[{field:'buyerAccepted',before:false,after:true}]},execution},
  {agent:'PaymentAgent',text:'Settlement recorded',time:state.now,facts:{action:'settle',checks:[{label:'同一请求中的买家验收条件已通过',result:'passed'}],changes:[{field:'status',before:'received',after:'settled'},{field:'held',before:true,after:false}]},execution}];
 state.audit=[...execution.steps.map((step,i)=>({id:'ui-'+i,agent:step.agent,time:state.now,object:order.id,text:'Node recorded',execution})),
 {id:'ui-model',agent:'ListingAgent',object:order.id,time:state.now,execution:{requestId:'model-ui-request',operation:'listing',steps:[{agent:'ListingAgent',modelCall:'succeeded',model:'mock-test-model',endpoint:'/v1/chat/completions',modelDurationMs:123,durationMs:999,selection:'inspect_request',selectionReason:'Read order status',tools:[{name:'inspect_request',status:'succeeded',durationMs:2,result:{status:'transit',committed:false}}]},{agent:'MatchingAgent',modelCall:'failed',model:'mock-test-model',endpoint:'/v1/chat/completions',modelDurationMs:456}]}}];
 await page.route('**/api/state',r=>r.fulfill({json:state}));
 await page.goto(base+'/#/manager/records/'+order.id);await page.locator('.event-facts').first().waitFor();await page.getByRole('button',{name:'EN',exact:true}).click();
 assert.equal(await page.locator('#workflow-evidence-ui-request').count(),1);
 await page.getByRole('button',{name:'View this request workflow ↗',exact:true}).first().click();
 const workflow=page.locator('#workflow-evidence-ui-request');assert.ok(await workflow.evaluate(el=>el.open));
 assert.equal(await workflow.getByText('Rule processing · No AI call',{exact:true}).count(),3);
 assert.doesNotMatch(await workflow.innerText(),/0 ms|API call duration|DO NOT PRESENT/);
 assert.match(await workflow.innerText(),/Responsibility.*Delivery coordination/);
 assert.match(await page.locator('.event-facts').first().innerText(),/Delivered → Settled/);
 await page.getByText('This historical event has no saved per-check results or state changes.',{exact:false}).waitFor();
 const model=page.locator('#workflow-model-ui-request');await model.locator(':scope > summary').click();assert.match(await model.innerText(),/123 ms/);assert.match(await model.innerText(),/456 ms/);assert.doesNotMatch(await model.innerText(),/999 ms/);assert.match(await model.innerText(),/Selected tool: inspect_request/);await model.getByText('inspect_request · Passed',{exact:true}).click();assert.match(await model.innerText(),/committed/);
 assert.doesNotMatch(await page.locator('.event-facts').first().innerText(),/[\u3400-\u9fff]/);
 await page.screenshot({path:'.runtime/event-evidence-ui.png',fullPage:true});
 await page.getByRole('button',{name:'中文',exact:true}).click();assert.match(await workflow.innerText(),/职责说明：配送流程协调/);
 await page.goto(base+'/#/buyer/orders/'+order.id);await page.locator('.theme-buyer').waitFor();assert.equal(await page.locator('.event-facts,.execution-details').count(),0);
 console.log('PASS: request deduplication, event-specific facts, historical honesty, short duties, model-only call metadata, bilingual display, buyer isolation.');
}finally{await browser.close();}
