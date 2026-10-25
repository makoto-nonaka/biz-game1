import test from 'node:test';
import assert from 'node:assert/strict';
import {RULES,score,unitRevenue,settle} from '../lib/model-v3.js';
import {RECOMMENDED,strategies,rng,settle as reference} from '../balance/model.js';
const decision=s=>({businessModel:s.model,price:s.price,development:s.development,advertising:s.advertising,iosPercent:s.iosPercent});
test('本体の6363選択すべてで、検証済みW1と魅力度・収入が一致',()=>{
 assert.equal(RULES.version,3);
 for(const s of strategies(RECOMMENDED,Array.from({length:101},(_,i)=>i))){
  const d=decision(s),weights=['android','ios'].flatMap(m=>[0,1,2].map(si=>score(d,m,si)));
  assert.deepEqual(weights,s.weights);assert.equal(unitRevenue(d),s.unitRevenue);
 }
});
test('2/20/30社×各100試行で本体の整数配分・損益がシミュレーションと一致',()=>{
 const grid=strategies(RECOMMENDED),random=rng(101492);
 for(const n of [2,20,30])for(let trial=0;trial<100;trial++){
  const rows=Array.from({length:n},()=>grid[Math.floor(random()*grid.length)]);
  const companies=rows.map((_,i)=>({id:String(i),name:String(i)}));
  const actual=settle(companies,Object.fromEntries(rows.map((s,i)=>[String(i),decision(s)]))).results;
  const expected=reference(rows,RECOMMENDED);
  for(let i=0;i<n;i++)for(const key of ['customers','revenue','cost','profit','breakEven'])assert.equal(actual[i][key],expected[i][key]);
 }
});
