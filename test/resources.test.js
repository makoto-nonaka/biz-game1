import test from 'node:test';
import assert from 'node:assert/strict';
import {settle,score,developmentContext,RULES,economics} from '../lib/model.js';
import {settle as settleV3} from '../lib/model-v3.js';
const companies=[{id:'a',name:'A'},{id:'b',name:'B'}];
const d=(iosPercent=50,development=500000,advertising=500000)=>({iosPercent,development,advertising,businessModel:'paid',price:500});
const history=(a,b)=>[{round:1,results:[{companyId:'a',...a},{companyId:'b',...b}]}];
test('初回はv0.3と人数・損益が同じで移行費用ゼロ',()=>{
 const decisions={a:d(33),b:d(78,1000000,0)};
 const actual=settle(companies,decisions),prior=settleV3(companies,decisions);
 assert.equal(actual.modelVersion,4);
 for(let i=0;i<2;i++)for(const k of ['customers','revenue','cost','profit','breakEven'])assert.equal(actual.results[i][k],prior.results[i][k]);
 assert.ok(actual.results.every(r=>r.switchingCost===0));
});
test('資源は市場配分で蓄積し、2回目以降に80%残存＋当回投資',()=>{
 const first=settle(companies,{a:d(0,1000000),b:d()});
 assert.deepEqual(first.results[0].resourcesAfter,{android:1000000,ios:0});
 const second=settle(companies,{a:d(100,500000),b:d()},[first]);
 assert.deepEqual(second.results[0].resourcesBefore,{android:1000000,ios:0});
 assert.deepEqual(second.results[0].resourcesAfter,{android:800000,ios:500000});
 assert.equal(second.results[0].switchingCost,200000);
 const third=settle(companies,{a:d(100,0),b:d()},[first,second]);
 assert.deepEqual(third.results[0].resourcesBefore,{android:800000,ios:500000});
 assert.equal(third.results[0].switchingCost,0);
 assert.equal(third.results[0].profit,third.results[0].revenue-third.results[0].cost);
});
test('同じ当回意思決定なら、開発経験のある会社が少し多く獲得する',()=>{
 const past=history(d(50,1000000),d(50,0));
 const actual=settle(companies,{a:d(),b:d()},past).results;
 assert.ok(actual[0].customers>actual[1].customers);
 assert.ok(actual[0].customers/actual[1].customers<1.1);
 assert.equal(actual[0].customers+actual[1].customers,12000);
});
test('生産性はその市場の経験に依存し、未経験市場に資源は自動移転しない',()=>{
 const ios=d(100),androidExperience=developmentContext('a',history(d(0,1000000),d()),ios);
 const iosExperience=developmentContext('a',history(d(100,1000000),d()),ios);
 assert.ok(score(ios,'ios',2,iosExperience)>score(ios,'ios',2,androidExperience));
 assert.equal(androidExperience.resources.ios,0);
 assert.equal(androidExperience.switchingCost,200000);
 assert.equal(iosExperience.switchingCost,0);
});
test('広告は当回のみで、過去の広告だけを変えても当回結果は変わらない',()=>{
 const one=settle(companies,{a:d(),b:d()},history(d(50,500000,0),d()));
 const two=settle(companies,{a:d(),b:d()},history(d(50,500000,1000000),d()));
 assert.deepEqual(one,two);
});
test('開発ゼロでも既存品質効果は穏やかに残り、上限がある',()=>{
 const decision=d(100,0,0),fresh={resources:{ios:0,android:0}},experienced={resources:{ios:1e12,android:0}};
 const gain=score(decision,'ios',2,experienced)/score(decision,'ios',2,fresh);
 assert.ok(gain>1&&gain<1.1);
 const productive=d(100,1000000,0);
 assert.ok(score(productive,'ios',2,experienced)/score(productive,'ios',2,fresh)<1.12);
});
test('市場移行費用を固定費・利益・分岐点に一度だけ含める',()=>{
 const context=developmentContext('a',history(d(0),d()),d(50));
 assert.equal(context.switchingCost,100000);
 const r=economics(d(50),6000,context.switchingCost);
 assert.equal(r.fixedCost,1600000);assert.equal(r.profit,800000);assert.equal(r.breakEven,4000);
 assert.equal(RULES.resourceRetention,.8);
});
