import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage();page.setDefaultTimeout(90000);
const base=process.env.BASE_URL||'http://127.0.0.1:5622/';
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  for(const route of ['/','/buyer/discover','/buyer/orders','/seller/listings','/seller/listings/new','/manager/overview','/manager/policies','/agreement']){
   await page.goto(base+'#'+route);
   await page.waitForTimeout(150);
   await page.getByText('正在加载…',{exact:true}).waitFor({state:'hidden'});
   assert.equal(await page.getByText('服务暂时不可用，请稍后重试。',{exact:true}).count(),0,route);
   assert.equal(await page.getByText('页面暂时无法显示',{exact:true}).count(),0,route);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'overflow '+route+' '+width);
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: 16 loaded desktop/mobile route checks; no render errors or horizontal overflow');
} finally {await browser.close();}
