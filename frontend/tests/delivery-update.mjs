import {chromium} from 'playwright';import assert from 'node:assert/strict';
const b=await chromium.launch({channel:'msedge',headless:true});const ctx=await b.newContext({permissions:['clipboard-read','clipboard-write']});const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
try{
 await p.goto('http://127.0.0.1:5621/#/buyer/items/F-101/delivery');
 assert.equal(await p.locator('form input:not([type=radio]),form select').evaluateAll(nodes=>nodes.every(n=>n.required)),true);
 await p.getByLabel('送货地址 *',{exact:true}).fill('123 Test Street');await p.getByLabel('通行方式').selectOption('stairs');await p.getByLabel('楼层').fill('3');
 await p.getByLabel('送货门高 cm').fill('');await p.getByRole('button',{name:'确认配送方案'}).click();assert.ok(p.url().endsWith('/delivery'));
 await p.getByLabel('送货门高 cm').fill('210');
 for(const end of ['取货','送货']){await p.getByLabel(end+'端需要物业确认').selectOption('true');await p.getByLabel(end+'端物业邮箱').fill(end==='取货'?'pickup@example.test':'delivery@example.test');}
 await p.getByRole('button',{name:'确认配送方案'}).click();await p.getByLabel('我接受固定总价和').check();await p.getByLabel('付款方式').selectOption('BPAY');await p.getByRole('button',{name:'前往付款'}).click();assert.equal(await p.getByLabel('付款账户（测试）').count(),0);await p.getByRole('button',{name:'完成演示付款'}).click();await p.getByRole('heading',{name:'配送与当前进度'}).waitFor();
 const orderURL=p.url();const links=[];
 for(const end of ['pickup','delivery']){const card=p.locator('.property-progress[data-end='+end+']');await card.getByRole('button',{name:'复制链接跟催'}).click();const copied=await p.evaluate(()=>navigator.clipboard.readText());assert.equal(copied,await card.locator('input').inputValue());links.push(copied);}
 assert.notEqual(links[0],links[1]);
 const prop=await ctx.newPage();await prop.goto(links[0]);await prop.getByLabel('回复人姓名').fill('Building manager');await prop.getByRole('button',{name:'提交物业回复'}).click();await p.locator('[data-end=pickup]').getByText('允许通行',{exact:true}).waitFor();await p.locator('[data-end=delivery]').getByText('待回复',{exact:true}).waitFor();await prop.getByRole('link',{name:'返回订单查看进度'}).click();assert.equal(prop.url(),orderURL);
 await prop.goto(links[1]);await prop.getByLabel('回复人姓名').fill('Delivery manager');await prop.getByLabel('通行意见').selectOption('conditional');await prop.getByLabel('条件 / 拒绝原因').fill('Book lift before arrival');await prop.getByRole('button',{name:'提交物业回复'}).click();await p.locator('[data-end=delivery]').getByText('附条件允许',{exact:true}).waitFor();await p.reload();await p.locator('[data-end=pickup]').getByText('允许通行',{exact:true}).waitFor();await p.getByRole('button',{name:'EN',exact:true}).click();await p.getByRole('button',{name:'Copy follow-up link',exact:true}).first().waitFor();await p.screenshot({path:'test-results/delivery-followup.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: stairs, required height, BPAY without account, two real clipboard URLs, cross-tab property status and persistence');
}finally{await b.close();}
