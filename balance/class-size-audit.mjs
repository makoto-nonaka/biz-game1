import {writeFileSync,mkdirSync} from 'node:fs';
import {createModel} from '../lib/model-v5.js';
import {randomGame} from './v5-simulate.mjs';
import {scenario,play,policies} from './max-strategy-audit.mjs';
const model=createModel(),results=[];
for(const n of [15,20]){
 const groups=randomGame(model,n,1000,202610280+n);
 const extremes=[];
 for(const id of ['max-free-50','max-freemium-50','max-paid-75','moderate-freemium-500','moderate-paid-500']){
  const p=policies.find(p=>p.id===id);let wins=0,profit=0;
  for(let trial=0;trial<200;trial++){const r=play(scenario(n,'random',20261028+n*10000+trial),p).rounds[2];wins+=r.win;profit+=r.profit;}
  extremes.push({policy:id,trials:200,winRate:wins/200,meanProfit:Math.round(profit/200)});
 }
 results.push({n,groups,extremes});console.log(JSON.stringify(results.at(-1)));
}
mkdirSync('balance/results/class-size',{recursive:true});writeFileSync('balance/results/class-size/results.json',JSON.stringify({date:'2026-10-27',modelVersion:5,results},null,2));
