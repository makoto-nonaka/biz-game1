// ゲーム本体と同じv0.5モデルによる「毎回最大」戦略の検証。アプリの設定は変更しない。
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createModel} from '../lib/model-v5.js';
import {computerDecisions} from '../lib/computers.js';
import {rng} from './v5-simulate.mjs';
const model=createModel();
const models=['free','freemium','paid'],allocations=[0,25,50,75,100];
export const policies=models.flatMap(businessModel=>allocations.flatMap(iosPercent=>['max','half'].map(kind=>({id:`${kind}-${businessModel}-${iosPercent}`,kind,choice:{businessModel,iosPercent,price:businessModel==='free'?0:700,development:kind==='max'?1000000:500000,advertising:kind==='max'?1000000:500000}}))));
for(const businessModel of models)for(const price of businessModel==='free'?[0]:[300,500])policies.push({id:`moderate-${businessModel}-${price}`,kind:'moderate',choice:{businessModel,iosPercent:50,price,development:500000,advertising:500000}});
const pick=(random,a)=>a[Math.floor(random()*a.length)];
const profiles=[
 ['free',0,20,0,500000],['freemium',500,50,500000,500000],['paid',700,80,1000000,0],
 ['free',0,50,500000,0],['paid',300,30,0,500000],['freemium',700,70,500000,0],
];
export function scenario(n,suite,seed){
 const random=rng(seed),companies=Array.from({length:n},(_,i)=>({id:String(i),name:i?`相手${i}`:'検証企業',computer:i>0,strategy:i-1}));
 const previous={},plans=[];
 for(let round=1;round<=4;round++){
  const decisions={};
  for(let i=1;i<n;i++){
   let d;
   if(suite==='mixed'||suite==='efficient'){
    const efficient=[['free',0,20,0,0],['freemium',500,50,0,0],['paid',500,80,500000,0],['free',0,50,0,500000],['paid',300,30,0,0],['freemium',700,70,0,500000]];
    const [businessModel,price,iosPercent,development,advertising]=(suite==='efficient'?efficient:profiles)[(i-1+seed%6)%6];
    d={businessModel,price,iosPercent,development,advertising};
   }else{
    const businessModel=models[(i-1+seed)%3];
    d={businessModel,price:businessModel==='free'?0:pick(random,[300,500,700]),iosPercent:round>1&&random()<.65?previous[i].iosPercent:pick(random,allocations),development:pick(random,[0,500000,1000000]),advertising:pick(random,[0,500000,1000000])};
   }
   decisions[i]=d;previous[i]=d;
  }
  plans.push(decisions);
 }
 return {companies,plans,seed,suite};
}
export function play(s,policy){
 const history=[],cumulative=Array(s.companies.length).fill(0),rounds=[];
 for(let round=1;round<=4;round++){
  const rivals=s.suite==='computers'?computerDecisions(s.companies,history,`audit-${s.seed}`):s.plans[round-1];
  const out=model.settle(s.companies,{...rivals,0:{...policy.choice}},history);
  history.push({round,...out});out.results.forEach((r,i)=>cumulative[i]+=r.profit);
  const top=Math.max(...cumulative),ties=cumulative.filter(p=>p===top).length;
  rounds.push({profit:cumulative[0],win:cumulative[0]===top?1/ties:0,rank:1+cumulative.filter(p=>p>cumulative[0]).length,loss:cumulative[0]<0,customers:out.results[0].customers});
 }
 return {rounds,history,cumulative};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const trials=Number(process.argv[2]||200),outDir=new URL(`../balance/results/max-audit${process.argv[3]?'-'+process.argv[3]:''}/`,import.meta.url);mkdirSync(outDir,{recursive:true});
 const rows=[],paired=[],examples=[];let games=0;
 for(const n of [3,6,10,15,30])for(const suite of (process.argv[3]?[process.argv[3]]:['random','mixed','computers'])){
  if(n===30&&suite==='computers')continue;
  const stats=Object.fromEntries(policies.map(p=>[p.id,Array.from({length:4},()=>({wins:0,profit:0,losses:0,rank:0}))]));
  const pairs=Object.fromEntries(policies.filter(p=>p.kind==='max').map(p=>[p.id,{lessBetter:0,maxBetter:0,equal:0,profitDifference:0}]));
  for(let trial=0;trial<trials;trial++){
   const seed=20261027+n*10000+trial,s=scenario(n,suite,seed),runs={};
   for(const policy of policies){
    const result=play(s,policy);runs[policy.id]=result;games++;
    result.rounds.forEach((r,i)=>{const stat=stats[policy.id][i];stat.wins+=r.win;stat.profit+=r.profit;stat.losses+=Number(r.loss);stat.rank+=r.rank;});
   }
   for(const policy of policies.filter(p=>p.kind==='max')){
    const max=runs[policy.id],half=runs[policy.id.replace('max-','half-')],delta=half.rounds[2].profit-max.rounds[2].profit,p=pairs[policy.id];
    p.lessBetter+=Number(delta>0);p.maxBetter+=Number(delta<0);p.equal+=Number(delta===0);p.profitDifference+=delta;
    if(n===10&&suite==='mixed'&&trial===0&&policy.choice.iosPercent===50){examples.push({n,suite,seed,policy,maximum:{rounds:max.rounds,history:max.history.slice(0,3),cumulative:max.history.slice(0,3).reduce((a,h)=>a.map((v,i)=>v+h.results[i].profit),Array(n).fill(0))},half:{rounds:half.rounds,history:half.history.slice(0,3)},sameRivalPlans:true});}
   }
  }
  for(const policy of policies)for(let i=0;i<4;i++){const s=stats[policy.id][i];rows.push({suite,n,rounds:i+1,trials,policy:policy.id,kind:policy.kind,...policy.choice,winRate:s.wins/trials,meanProfit:Math.round(s.profit/trials),lossRate:s.losses/trials,meanRank:s.rank/trials});}
  for(const [policy,p]of Object.entries(pairs))paired.push({suite,n,rounds:3,trials,policy,halfBeatsMaxRate:p.lessBetter/trials,maxBeatsHalfRate:p.maxBetter/trials,equalRate:p.equal/trials,meanHalfMinusMax:Math.round(p.profitDifference/trials)});
  console.log(JSON.stringify({n,suite,completedGames:games}));
 }
 const result={date:'2026-10-27',rules:model.RULES,seedRule:'20261027+n*10000+trial',trials,policies,rows,paired,examples,games,settlements:games*4,note:'勝率は同率1位で人数按分。各行は特定の相手行動を仮定した検証であり、人間相手の勝率予測ではない。mixedは6方針の繰り返しなので独立な対戦配置は6種類。random/mixedは候補戦略間で相手計画を固定。computersは同じ初期条件だが過去結果への反応で相手の選択も変化する。'};
 writeFileSync(new URL('results.json',outDir),JSON.stringify(result,null,2));
 const columns=Object.keys(rows[0]);writeFileSync(new URL('summary.csv',outDir),'\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(k=>r[k]).join(','))].join('\r\n'));
 console.log(`DONE ${games} games, ${games*4} settlements`);
}
