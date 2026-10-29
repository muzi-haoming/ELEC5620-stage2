import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage(),base='http://127.0.0.1:5623';
 const state=await(await page.request.get(base+'/api/state',{headers:{'X-Demo-Role':'seller'}})).json();
 let good=false,calls=0;
 await page.route('**/api/actions',r=>{calls++;return r.fulfill({json:{state,result:good?{status:'ready',suggested:200,retrievedAt:'2026-10-29',sampleLimited:true,range:[200,200],query:'gaming chair',diagnostics:{fetched:5,matched:1,excluded:{subtype:4},failedSources:0},evidence:[{id:'x',title:'Used gaming chair',url:'https://www.cashconverters.com.au/',price:200,matchScore:65,unknowns:['年限'],adjustmentFactor:1}],calculation:{sourceId:'x',marketPrice:200,conditionFactor:1,ageFactor:1,factor:1,result:200}}:{status:'input_invalid',suggested:null,errors:{material:'无法识别该材质，请填写具体材质，例如布艺、皮革、木材、金属或混合材质；若指亚麻，请填写 linen。'}}}})});
 await page.goto(base+'/#/seller/listings/new');await page.getByTestId('get-suggested-price').waitFor();assert.equal(calls,0);
 await page.getByTestId('get-suggested-price').click();await page.getByRole('alert').filter({hasText:'无法识别该材质'}).waitFor();
 good=true;await page.getByTestId('get-suggested-price').click();await page.getByText('为什么是这个价格',{exact:true}).waitFor();await page.getByText('参考样本较少',{exact:false}).waitFor();
 assert.match(await page.getByTestId('pricing-explanation').innerText(),/200/);
 await page.getByRole('button',{name:'EN',exact:true}).click();await page.getByText('Why this price',{exact:true}).waitFor();await page.getByText('Limited sample',{exact:false}).waitFor();
 await page.getByText('View comparison evidence',{exact:true}).click();
 await page.getByText('Match score 65%',{exact:false}).waitFor();
 assert.equal(await page.getByText('匹配度',{exact:false}).count(),0);
 await page.getByRole('button',{name:'中文',exact:true}).click();
 await page.getByText('匹配度 65%',{exact:false}).waitFor();
 console.log('PASS: explicit query, material field feedback, low sample, calculation and English explanation.');
}finally{await browser.close();}
