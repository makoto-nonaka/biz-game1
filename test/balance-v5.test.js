import test from 'node:test';
import assert from 'node:assert/strict';
import * as v5 from '../lib/model-v5.js';
import * as v4 from '../lib/model.js';
import {grid,bestResponse} from '../balance/v5-simulate.mjs';
const standard=(businessModel='paid',price=500)=>({iosPercent:50,businessModel,price:businessModel==='free'?0:price,development:500000,advertising:500000});
test('v0.5収入・費用・損益分岐点は手計算と一致。旧版の定数を変更しない',()=>{
 assert.equal(v5.RULES.version,5);assert.equal(v5.RULES.conversionRate,.3);assert.equal(v5.RULES.freeRevenue,300);assert.equal(v5.RULES.baseCost,300000);
 for(const [model,revenue,profit,breakEven]of [['free',1800000,-100000,6500],['freemium',2160000,260000,5000],['paid',3000000,1100000,3250]]){
  const d=standard(model),r=v5.economics(d,6000);
  assert.equal(r.revenue,revenue);assert.equal(r.profit,profit);assert.equal(r.breakEven,breakEven);assert.equal(r.fixedCost,1300000);assert.equal(r.variableCost,600000);
 }
 assert.equal(v4.RULES.version,4);assert.equal(v4.RULES.freeRevenue,400);assert.equal(v4.RULES.baseCost,500000);assert.equal(v4.RULES.conversionRate,.4);
});
test('3社で各モデル1社の標準選択では全モデル黒字。人数は保証値ではない',()=>{
 const companies=['free','freemium','paid'].map((m,i)=>({id:String(i),name:m}));
 const d=Object.fromEntries(companies.map(c=>[c.id,standard(c.name)]));const r=v5.settle(companies,d).results;
 assert.deepEqual(r.map(x=>x.customers),[7620,6258,4122]);assert.deepEqual(r.map(x=>x.profit),[224000,327080,348800]);
 assert.ok(r.every(x=>x.profit>0));
});
test('全441戦略の分岐点は直前赤字・到達非赤字、広告は課金者と二重計上しない',()=>{
 for(const d of grid){const r=v5.economics(d,1,100000),be=r.breakEven;assert.ok(v5.economics(d,be-1,100000).profit<0);assert.ok(v5.economics(d,be,100000).profit>=0);}
 const r=v5.economics(standard('freemium',700),10);assert.equal(r.paymentRevenue,2100);assert.equal(r.adRevenue,2100);assert.equal(r.revenue,4200);
});
test('3/6/10/15社の3ラウンドで人数・費用・資源・移行費用の整合を保つ',()=>{
 for(const n of [3,6,10,15]){
  const companies=Array.from({length:n},(_,i)=>({id:String(i),name:String(i)})),history=[];
  for(let round=1;round<=3;round++){
   const decisions=Object.fromEntries(companies.map((c,i)=>[c.id,{...grid[(i*43+round*29)%grid.length],iosPercent:round===1?0:round===2?100:50}]));
   const out=v5.settle(companies,decisions,history);assert.equal(out.modelVersion,5);assert.equal(out.results.reduce((s,r)=>s+r.customers,0)+out.unserved,n*6000);
   for(const r of out.results){assert.equal(r.cost,r.fixedCost+r.variableCost);assert.equal(r.revenue,r.paymentRevenue+r.adRevenue);assert.equal(r.profit,r.revenue-r.cost);assert.equal(r.customers,r.markets.android.customers+r.markets.ios.customers);assert.equal(r.switchingCost,round===1?0:round===2?200000:100000);}
   history.push({round,...out});
  }
 }
});
test('検証用の最適反応の評価値は本体の人数丸めとの差だけに収まる',()=>{
 const companies=Array.from({length:3},(_,i)=>({id:String(i),name:String(i)})),decisions=Object.fromEntries(companies.map((c,i)=>[c.id,standard(['free','freemium','paid'][i])]));
 const history=[{round:1,...v5.settle(companies,decisions)}];
 const best=bestResponse(v5,companies,decisions,history,0),d={...decisions,0:best.choice};const actual=v5.settle(companies,d,history).results[0];
 assert.ok(Math.abs(actual.profit-best.estimatedProfit)<3600);
});
