import {writeFileSync} from 'node:fs';
import {settle as v4} from '../lib/model.js';
import {settle as v3} from '../lib/model-v3.js';
import {rng} from './model.js';
const simulations=[];
for(const n of [2,20,30]){
 const random=rng(20261025+n),games=1000;
 const totals=[3,4].map(version=>({version,rounds:Array.from({length:3},()=>({losses:0,profit:0,overhead:0})),cumulativeLosses:0}));
 let maximumCustomerShift=0,leaderChanges=0;
 const companies=Array.from({length:n},(_,i)=>({id:String(i),name:`会社${i+1}`}));
 for(let trial=0;trial<games;trial++){
  const histories=[[],[]],cumulative=[Array(n).fill(0),Array(n).fill(0)];
  for(let round=0;round<3;round++){
   const decisions=Object.fromEntries(companies.map(c=>{
    const businessModel=['free','freemium','paid'][Math.floor(random()*3)];
    return[c.id,{iosPercent:[0,25,50,75,100][Math.floor(random()*5)],businessModel,price:businessModel==='free'?0:[300,500,700][Math.floor(random()*3)],development:[0,500000,1000000][Math.floor(random()*3)],advertising:[0,500000,1000000][Math.floor(random()*3)]}];
   }));
   const outcomes=[v3(companies,decisions),v4(companies,decisions,histories[1])];
   for(let version=0;version<2;version++){
    const out=outcomes[version];histories[version].push({round:round+1,...out});
    out.results.forEach((r,i)=>{const t=totals[version].rounds[round];t.losses+=Number(r.profit<0);t.profit+=r.profit;t.overhead+=r.switchingCost||0;cumulative[version][i]+=r.profit;});
   }
   outcomes[0].results.forEach((r,i)=>{if(r.customers)maximumCustomerShift=Math.max(maximumCustomerShift,Math.abs(outcomes[1].results[i].customers-r.customers)/r.customers);});
  }
  cumulative.forEach((profits,v)=>totals[v].cumulativeLosses+=profits.filter(p=>p<0).length);
  const leaders=cumulative.map(profits=>profits.indexOf(Math.max(...profits)));leaderChanges+=Number(leaders[0]!==leaders[1]);
 }
 simulations.push({n,games,seed:20261025+n,maximumCustomerShift,leaderChangesRate:leaderChanges/games,
 versions:totals.map(t=>({version:t.version,rounds:t.rounds.map((r,i)=>({round:i+1,lossRate:r.losses/(n*games),meanProfit:Math.round(r.profit/(n*games)),meanSwitchingCost:Math.round(r.overhead/(n*games))})),cumulativeLossRate:t.cumulativeLosses/(n*games)}))});
}
const exampleCompanies=[{id:'a',name:'経験あり'},{id:'b',name:'経験なし'}];
const d={iosPercent:50,businessModel:'paid',price:500,development:500000,advertising:500000};
const past=[{round:1,results:[{companyId:'a',...d,development:1000000},{companyId:'b',...d,development:0}]}];
const example=v4(exampleCompanies,{a:d,b:d},past).results.map(r=>({name:r.name,customers:r.customers,profit:r.profit,resourcesBefore:r.resourcesBefore}));
const result={note:'同じランダム意思決定を両版に与えた3ラウンド比較。実際の生徒の行動予測ではない。',simulations,example};
writeFileSync(new URL('./results/resources-v4.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
