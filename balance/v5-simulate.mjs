import {writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createModel} from '../lib/model-v5.js';
import * as previous from '../lib/model.js';
const MODELS=['free','freemium','paid'],sizes=[3,6,10,15];
export function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const pick=(r,a)=>a[Math.floor(r()*a.length)];
const allocations=[0,10,25,50,75,90,100];
export const grid=MODELS.flatMap(businessModel=>(businessModel==='free'?[0]:[300,500,700]).flatMap(price=>allocations.flatMap(iosPercent=>[0,500000,1000000].flatMap(development=>[0,500000,1000000].map(advertising=>({businessModel,price,iosPercent,development,advertising}))))));
const byModel=MODELS.map(m=>grid.filter(d=>d.businessModel===m));
export function randomGame(model,n,games,seed,composition='balanced'){
 const random=rng(seed),stats=MODELS.map(model=>({model,count:0,losses:0,profit:0,wins:0,users:0}));let retained=0,roundWinsRetained=0,allLoss=0;
 for(let trial=0;trial<games;trial++){
  const companies=Array.from({length:n},(_,i)=>({id:String(i),name:String(i)}));
  const assigned=companies.map((_,i)=>composition==='balanced'?(i+trial)%3:random()<.7?MODELS.indexOf(composition):Math.floor(random()*3));
  const history=[],sums=Array(n).fill(0);let decisions={},firstLeaders=[];
  for(let round=1;round<=3;round++){
   decisions=Object.fromEntries(companies.map((c,i)=>{
    let d={...pick(random,byModel[assigned[i]])};
    if(round>1&&random()<.65)d.iosPercent=decisions[c.id].iosPercent;
    return[c.id,d];
   }));
   const out=model.settle(companies,decisions,history);history.push({round,...out});out.results.forEach((r,i)=>sums[i]+=r.profit);
   const best=Math.max(...sums),leaders=sums.flatMap((p,i)=>p===best?[i]:[]);
   if(round===1)firstLeaders=leaders;
   if(round===3){
    allLoss+=Number(best<0);retained+=Number(leaders.some(i=>firstLeaders.includes(i)));
    const bestRound=Math.max(...out.results.map(r=>r.profit));roundWinsRetained+=Number(out.results.some((r,i)=>r.profit===bestRound&&firstLeaders.includes(i)));
    out.results.forEach((r,i)=>{const s=stats[assigned[i]];s.count++;s.losses+=Number(sums[i]<0);s.profit+=sums[i];s.users+=r.customers;if(sums[i]===best)s.wins+=1/leaders.length;});
   }
  }
 }
 return{n,games,seed,composition,allLossRate:allLoss/games,firstLeaderStillFirst:retained/games,firstLeaderWinsRound3:roundWinsRetained/games,models:stats.map(s=>({model:s.model,count:s.count,winShare:s.wins/games,lossRate:s.count?s.losses/s.count:null,meanCumulativeProfit:s.count?Math.round(s.profit/s.count):null,meanRound3Users:s.count?Math.round(s.users/s.count):null}))};
}
// 他社が前回の選択を継続するという仮定で、自社の当回利益を最大化。順位を保証する戦略ではない。
export function bestResponse(model,companies,decisions,history,index){
 const pools=companies.length*model.RULES.customersPerCompany/2;
 const context=companies.map(c=>model.developmentContext(c.id,history,decisions[c.id]));
 const sums=['android','ios'].map(m=>model.RULES.segments.map((s,si)=>companies.reduce((sum,c,i)=>sum+(i===index?0:model.score(decisions[c.id],m,si,context[i])),0)));
 let best=null,bestProfit=-Infinity;
 for(const d of grid){
  const own=model.developmentContext(companies[index].id,history,d);let customers=0;
  for(const [mi,m]of ['android','ios'].entries())for(const [si,s]of model.RULES.segments.entries()){
   const weight=model.score(d,m,si,own),denom=sums[mi][si]+weight;if(denom)customers+=pools*s[m]*weight/denom;
  }
  const profit=model.economics(d,customers,own.switchingCost).profit;
  if(profit>bestProfit){best=d;bestProfit=profit;}
 }
 return {choice:{...best},estimatedProfit:bestProfit};
}
export function adaptive(model,n,games,seed){
 const random=rng(seed),stats=Array.from({length:3},()=>({models:Object.fromEntries(MODELS.map(m=>[m,0])),losses:0,profit:0,winners:Object.fromEntries(MODELS.map(m=>[m,0]))}));let retained=0;
 for(let trial=0;trial<games;trial++){
  const companies=Array.from({length:n},(_,i)=>({id:String(i),name:String(i)})),history=[],sums=Array(n).fill(0);
  let decisions=Object.fromEntries(companies.map((c,i)=>[c.id,{...pick(random,byModel[(i+trial)%3])}])) ,firstLeaders=[];
  for(let round=1;round<=3;round++){
   const out=model.settle(companies,decisions,history),s=stats[round-1];out.results.forEach((r,i)=>{s.models[r.businessModel]++;s.losses+=Number(r.profit<0);s.profit+=r.profit;sums[i]+=r.profit;});
   const max=Math.max(...sums),leaders=sums.flatMap((p,i)=>p===max?[i]:[]);for(const i of leaders)s.winners[out.results[i].businessModel]+=1/leaders.length;
   if(round===1)firstLeaders=leaders;if(round===3)retained+=Number(leaders.some(i=>firstLeaders.includes(i)));
   history.push({round,...out});
   if(round<3)decisions=Object.fromEntries(companies.map((c,i)=>[c.id,bestResponse(model,companies,decisions,history,i).choice]));
  }
 }
 return{n,games,seed,firstLeaderStillFirst:retained/games,rounds:stats.map((s,i)=>({round:i+1,choiceShare:Object.fromEntries(MODELS.map(m=>[m,s.models[m]/(n*games)])),cumulativeWinnerShare:Object.fromEntries(MODELS.map(m=>[m,s.winners[m]/games])),lossRate:s.losses/(n*games),meanProfit:Math.round(s.profit/(n*games))}))};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
const mode=process.argv[2]||'screen';
mkdirSync(new URL('./results/v5/',import.meta.url),{recursive:true});
if(mode==='screen'){
 const results=[];
 for(const ad of [250,275,300])for(const conversion of [.1,.2,.3])for(const free of [1.2,1.5,1.8])for(const fm of [1,1.2,1.4])for(const exponent of [.5,.7]){
  const config={baseCost:500000,freeRevenue:ad,conversionRate:conversion,modelMultipliers:{free,freemium:fm,paid:1},freemiumPriceExponent:exponent},model=createModel(config);
  const runs=[3,6,15].map(n=>randomGame(model,n,100,260101+n));
  const win=MODELS.map((_,i)=>runs.reduce((s,r)=>s+r.models[i].winShare,0)/runs.length),loss=MODELS.map((_,i)=>runs.reduce((s,r)=>s+r.models[i].lossRate,0)/runs.length);
  const fairness=win.reduce((s,w)=>s+(w-1/3)**2,0),worstLoss=Math.max(...loss);
  results.push({config,win,loss,objective:fairness+.08*worstLoss,runs});
 }
 results.sort((a,b)=>a.objective-b.objective);writeFileSync(new URL('./results/v5/calibration.json',import.meta.url),JSON.stringify(results,null,2));
 for(const r of results.slice(0,12))console.log(JSON.stringify({config:r.config,win:r.win.map(x=>+x.toFixed(3)),loss:r.loss.map(x=>+x.toFixed(3)),objective:r.objective}));
}else if(mode==='validate'){
 const selected=createModel(),output={rules:selected.RULES,note:'独自の学習用モデル。ランダム行動と同時最適反応は人間の行動予測ではない。',random:[],adaptive:[],composition:[]};
 for(const n of sizes){output.random.push({n,old:randomGame(previous,n,1500,761101+n),proposed:randomGame(selected,n,1500,761101+n)});console.log('random',n);}
 for(const n of sizes){output.adaptive.push({n,old:adaptive(previous,n,75,761201+n),proposed:adaptive(selected,n,75,761201+n)});console.log('adaptive',n);}
 for(const n of [3,15])for(const composition of MODELS)output.composition.push(randomGame(selected,n,750,761301+n,composition));
 writeFileSync(new URL('./results/v5/validation.json',import.meta.url),JSON.stringify(output,null,2));console.log('Saved validation.json');
}else if(mode==='probe'){
 for(const config of [
 {freeRevenue:300,conversionRate:.2,modelMultipliers:{free:1.7,freemium:1.5,paid:1},freemiumPriceExponent:.5},
 {freeRevenue:300,conversionRate:.3,modelMultipliers:{free:1.8,freemium:1.4,paid:1},freemiumPriceExponent:.5},
 {freeRevenue:300,conversionRate:.2,modelMultipliers:{free:1.8,freemium:1.4,paid:1},freemiumPriceExponent:.5},
 {freeRevenue:300,conversionRate:.2,modelMultipliers:{free:1.7,freemium:1.5,paid:1},freemiumPriceExponent:.7},
 ]){console.log('CONFIG',JSON.stringify(config));for(const n of [3,15])console.log(JSON.stringify(adaptive(createModel(config),n,40,882100+n)));}
}

}
