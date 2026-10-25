import test from 'node:test';
import assert from 'node:assert/strict';
import {RECOMMENDED as c,SEGMENTS,strategies,settle,pools,bestResponse} from './model.js';
const grid=strategies(c), get=(model,price=500,dev=500000,ads=500000,ios=50)=>grid.find(s=>s.model===model&&s.price===(model==='free'?0:price)&&s.development===dev&&s.advertising===ads&&s.iosPercent===ios);
test('v0.3顧客構成と315戦略の整合',()=>{
 for(const m of ['android','ios'])assert.equal(SEGMENTS.reduce((s,r)=>s+r[m],0),1);
 assert.equal(grid.length,315);assert.equal(strategies(c,Array.from({length:101},(_,i)=>i)).length,6363);
});
test('全モデルの標準選択は同条件で6000人・黒字、2/20/30社で成立',()=>{
 for(const n of [2,20,30])for(const m of ['free','freemium','paid']){
  const rows=settle(Array(n).fill(get(m)),c);
  assert.ok(rows.every(r=>r.customers===6000&&r.profit>0));
 }
});
test('400円広告、無料60%広告＋40%課金、Paidの手計算',()=>{
 const expected={free:[2400000,300000,5000],freemium:[2640000,540000,4412],paid:[3000000,900000,3750]};
 for(const [m,[revenue,profit,be]]of Object.entries(expected)){
  const r=settle([get(m),get(m)],c)[0];assert.equal(r.revenue,revenue);assert.equal(r.profit,profit);assert.equal(r.breakEven,be);
 }
});
test('画像の6094人・固定費200万円なら新Freemiumで71960円、分岐点5883人',()=>{
 const choice=get('freemium',500,1000000,500000);
 assert.equal(Math.round(6094*choice.contribution)-choice.fixedCost,71960);assert.equal(choice.breakEven,5883);
});
test('異なる戦略でも人数・費用・利益を保存',()=>{
 for(const n of [2,20,30]){
  const rows=settle(Array.from({length:n},(_,i)=>grid[(i*37)%grid.length]),c);
  assert.equal(rows.reduce((s,r)=>s+r.customers,0),n*6000);
  for(const r of rows){assert.ok(Number.isInteger(r.customers));assert.equal(r.profit,r.revenue-r.cost);}
 }
});
test('全社集中なら反対の市場は売れず、過剰投資が自動で報われない',()=>{
 const d=get('paid',500,0,0,100);assert.equal(settle([d,d],c)[0].customers,3000);
 const low=settle(Array(20).fill(get('paid',500,0,0)),c)[0];
 const max=settle(Array(20).fill(get('paid',500,1000000,1000000)),c)[0];
 assert.equal(low.profit-max.profit,2000000);assert.equal(max.profit,-100000);
});
test('損益分岐点は全選択で直前赤字・到達で非赤字',()=>{
 for(const r of grid){assert.ok(r.breakEven*r.contribution-r.fixedCost>=0);assert.ok((r.breakEven-1)*r.contribution-r.fixedCost<0);}
});
test('単独変更の近似最適反応と整数配分での利益は小さい丸め差のみ',()=>{
 const others=grid.filter((_,i)=>i%19===0),best=bestResponse(others,grid,c);
 const actual=settle([...others,best.choice],c).at(-1).profit;
 assert.ok(Math.abs(actual-best.estimatedProfit)<6*600);
 assert.equal(pools(others.length+1,c).reduce((s,x)=>s+x,0),(others.length+1)*6000);
});
