import test from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENTS, score, settle, economics, ranking, validDecision, normalizeDecision } from '../lib/model.js';
const d=(iosPercent=50,businessModel='paid',price=500,development=500000,advertising=500000)=>({iosPercent,businessModel,price,development,advertising});
const companies=Array.from({length:30},(_,i)=>({id:String(i),name:String(i)}));
test('Paidの手計算と損益分岐点',()=>{
 const r=economics(d(),6000);
 assert.equal(r.revenue,3000000);assert.equal(r.cost,2100000);assert.equal(r.profit,900000);assert.equal(r.breakEven,3750);
});
test('Freeの広告収入とFreemiumの課金率を計算',()=>{
 const free=economics(d(50,'free',0),6000),fm=economics(d(50,'freemium'),6000);
 assert.equal(free.revenue,2400000);assert.equal(free.profit,300000);assert.equal(free.breakEven,5000);
 assert.equal(fm.revenue,2640000);assert.equal(fm.profit,540000);assert.equal(fm.breakEven,4412);
});
test('全社50%配分なら両市場各3000人、総数180000人',()=>{
 const r=settle(companies,Object.fromEntries(companies.map(c=>[c.id,d()])));
 assert.ok(r.results.every(r=>r.customers===6000&&r.markets.ios.customers===3000&&r.markets.android.customers===3000));
 assert.equal(r.unserved,0);
});
test('全社iOS100%ならAndroidは未獲得',()=>{
 const r=settle(companies,Object.fromEntries(companies.map(c=>[c.id,d(100)])));
 assert.equal(r.unserved,90000);assert.ok(r.results.every(r=>r.markets.android.customers===0&&r.customers===3000));
});
test('端数を含む混合戦略でも各市場の人数を保存・一社一結果',()=>{
 const r=settle(companies,Object.fromEntries(companies.map((c,i)=>[c.id,d((i*17)%101,['free','freemium','paid'][i%3],i%3===0?0:[300,500,700][i%3])])));
 assert.equal(r.results.length,30);
 for(const market of ['ios','android']) assert.equal(r.results.reduce((s,r)=>s+r.markets[market].customers,0),90000);
 assert.ok(r.results.every(r=>Number.isInteger(r.customers)&&Number.isInteger(r.revenue)));
});
test('市場配分の変更が競合の利用者数を変える',()=>{
 const cs=companies.slice(0,2),ds={'0':d(50),'1':d(50)};
 const first=settle(cs,ds);const changed=settle(cs,{...ds,'1':d(100)});
 assert.equal(first.results[0].markets.android.customers,3000);
 assert.equal(changed.results[0].markets.android.customers,6000);
 assert.ok(changed.results[0].markets.ios.customers<3000);
});
test('無料モデルは同条件のPaidより多く獲得、売上は単価でも変わる',()=>{
 const r=settle(companies.slice(0,2),{'0':d(50,'free',0),'1':d()}).results;
 assert.ok(r[0].customers>r[1].customers);assert.equal(r[0].revenuePerCustomer,400);assert.equal(r[1].revenuePerCustomer,500);
});
test('顧客構成によってAndroidは低価格・iOSは品質の影響が相対的に大きい',()=>{
 const aggregate=(choice,m)=>SEGMENTS.reduce((sum,s,i)=>sum+s[m]*score(choice,m,i),0);
 assert.ok(aggregate(d(50,'paid',300),'android')/aggregate(d(50,'paid',700),'android')>aggregate(d(50,'paid',300),'ios')/aggregate(d(50,'paid',700),'ios'));
 assert.ok(aggregate(d(50,'paid',500,1000000),'ios')/aggregate(d(50,'paid',500,0),'ios')>aggregate(d(50,'paid',500,1000000),'android')/aggregate(d(50,'paid',500,0),'android'));
});
test('全モデル・全価格・全投資の損益分岐点が直前赤字・到達黒字',()=>{
 for(const model of ['free','freemium','paid']) for(const price of model==='free'?[0]:[300,500,700]) for(const dev of [0,500000,1000000]) for(const ads of [0,500000,1000000]){
  const choice=d(50,model,price,dev,ads),be=economics(choice,0).breakEven;
  assert.ok(economics(choice,be).profit>=0);assert.ok(economics(choice,be-1).profit<0);
 }
});
test('赤字・同順位・累計利益',()=>{
 const rows=ranking(companies.slice(0,3),[{results:[{companyId:'0',profit:100},{companyId:'1',profit:100},{companyId:'2',profit:-20}]}]);
 assert.deepEqual(rows.map(r=>r.rank),[1,1,3]);
});
test('不正な配分・モデル・価格と未提出を拒否',()=>{
 for(const choice of [d(-1),d(101),d(0.5),d('50'),d(50,'other'),d(50,'free',500),d(50,'paid',0),d(50,'freemium','500')]) assert.ok(!validDecision(choice));
 assert.throws(()=>settle(companies.slice(0,1),{}));
});
test('前版の単一市場データを有料販売として計算可能',()=>{
 const legacy={market:'android',price:500,development:500000,advertising:500000};
 assert.deepEqual(normalizeDecision(legacy),d(0));
 const r=settle(companies.slice(0,1),{'0':legacy}).results[0];
 assert.equal(r.businessModel,'paid');assert.equal(r.markets.android.customers,3000);assert.equal(r.markets.ios.customers,0);
});
