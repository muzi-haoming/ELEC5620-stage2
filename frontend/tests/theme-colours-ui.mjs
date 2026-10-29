import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:5623',browser=await chromium.launch({headless:true,channel:'msedge'});
const output=new URL('../../.runtime/theme-review/',import.meta.url);await fs.mkdir(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const state=await(await page.request.get(base+'/api/state',{headers:{'X-Demo-Role':'manager'}})).json();
 await page.route('**/api/state',r=>r.fulfill({json:state}));
 const item=state.items.find(x=>x.status==='published')||state.items[0],order=state.orders.find(o=>o.status==='settled')||state.orders[0];
 const quote={id:'theme-review-only',itemId:item.id,delivery:{address:'Test address',movers:2,access:'ground'},provider:'Test carrier',expected:'2026-11-01',itemPrice:item.price,deliveryFee:75,total:item.price+75,expires:state.now+9999999,biller:'123456',reference:'123456789'};state.quotes.push(quote);
 const routes=['seller/listings','seller/listings/new','seller/listings/'+item.id,'buyer/discover','buyer/items/'+item.id,'buyer/items/'+item.id+'/delivery','buyer/checkout/'+quote.id,'buyer/orders','buyer/orders/'+order.id,'manager/overview','manager/records/'+order.id,'manager/exceptions','manager/policies'];
 const failures=[],report=[];
 async function check(label){
  const bad=await page.evaluate(()=>{
   const parse=v=>{const n=v.match(/[\d.]+/g)?.map(Number)||[0,0,0,0];return[n[0],n[1],n[2],n.length>3?n[3]:1];};
   const mix=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
   const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   function bg(el){const layers=[];for(let p=el;p;p=p.parentElement)layers.unshift(parse(getComputedStyle(p).backgroundColor));return layers.reduce((b,a)=>mix(a,b),[255,255,255]);}
   const results=[];
   for(const el of document.querySelectorAll('body *')){
    if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})||el.closest('script,style,option'))continue;
    const text=(['INPUT','SELECT','TEXTAREA'].includes(el.tagName)?el.value:[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('')).trim();
    if(!/[a-zA-Z\u3400-\u9fff\d]/.test(text))continue;
    const s=getComputedStyle(el),background=bg(el),foreground=mix(parse(s.color),background),a=lum(background),b=lum(foreground),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&parseInt(s.fontWeight)>=700),min=large?3:4.5;
    if(ratio<min)results.push({text:text.slice(0,70),selector:el.tagName+'.'+el.className,fg:s.color,bg:background,ratio:+ratio.toFixed(2),min});
   }return results;
  });
  failures.push(...bad.map(x=>({page:label,...x})));report.push({page:label,failures:bad.length});
 }
 for(const [i,route] of routes.entries()){
  await page.goto(base+'/#/'+route);await page.locator('.shell').waitFor();
  await page.getByRole('button',{name:'EN',exact:true}).click();
  const expected={seller:'#214f43',buyer:'#a84216',manager:'#e6ca85'}[route.split('/')[0]];
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent').trim()),expected);
  if(route==='buyer/orders/'+order.id){
   const success=page.locator('.notice.success');if(await success.count())assert.equal(await success.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 240, 226)');
  }
  if(route.startsWith('manager/')){assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(21, 22, 21)');for(const panel of await page.locator('.panel').all())assert.notEqual(await panel.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');}
  await check(route);
  await page.screenshot({path:new URL(i+'-'+route.split('/')[0]+'.png',output).pathname.replace(/^\/(?=[A-Z]:)/,'') ,fullPage:true});
  const button=page.locator('.button').first();if(await button.count()){const disabled=await button.evaluate(el=>el.disabled);if(!disabled){await button.evaluate(el=>el.disabled=true);await check(route+' disabled button');await button.evaluate(el=>el.disabled=false);}}
  for(const selector of ['.tabs .selected','.sidebar nav a.active','.button:not(:disabled)','.button.secondary:not(:disabled)','.language-switch button[aria-pressed=true]']){
   const el=page.locator(selector).first();if(await el.count()){await el.hover();await check(route+' hover '+selector);}
  }
 }
 await page.goto(base+'/#/manager/records/'+order.id);await page.getByRole('button',{name:/Demo controls/}).click();await check('manager demo modal');
 await page.screenshot({path:new URL('manager-modal.png',output).pathname.replace(/^\/(?=[A-Z]:)/,''),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/#/buyer/discover');await page.locator('.theme-buyer').waitFor();await check('buyer mobile');await page.screenshot({path:new URL('buyer-mobile.png',output).pathname.replace(/^\/(?=[A-Z]:)/,''),fullPage:true});
 await page.getByRole('button',{name:'中文',exact:true}).click();await check('buyer Chinese');
 await fs.writeFile(new URL('contrast.json',output),JSON.stringify({report,failures},null,2));
 console.log(JSON.stringify({screens:routes.length+2,checks:report.length,failures},null,2));assert.equal(failures.length,0,'Visible text must meet WCAG AA contrast against rendered solid backgrounds');
}finally{await browser.close();}
