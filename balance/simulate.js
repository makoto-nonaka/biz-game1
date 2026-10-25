import {writeFileSync,mkdirSync} from 'node:fs';
import {CANDIDATES,MODELS,strategies,settle,rng,bestResponse,RECOMMENDED} from './model.js';
const requested=process.argv.find(arg=>arg.startsWith('--candidate='))?.split('=')[1];
if(requested&&!CANDIDATES.some(c=>c.id===requested))throw new Error('Unknown candidate');
const dir=new URL(requested?`./results/${requested}/`:'./results/',import.meta.url);mkdirSync(dir,{recursive:true});
function tournament(config,n,rooms,seed,composition=[1/3,1/3,1/3]){
 const random=rng(seed),grid=strategies(config),byModel=MODELS.map(m=>grid.filter(s=>s.model===m));
 const stats=MODELS.map(model=>({model,count:0,loss:0,profit:0,firstCredit:0}));
 let allLoss=0,loss=0;
 for(let t=0;t<rooms;t++){
  const rows=Array.from({length:n},()=>{const x=random();const m=x<composition[0]?0:x<composition[0]+composition[1]?1:2;
   return byModel[m][Math.floor(random()*byModel[m].length)];});
  const result=settle(rows,config),max=Math.max(...result.map(r=>r.profit)),winners=result.filter(r=>r.profit===max).length;
  allLoss+=Number(max<0);
  for(const r of result){const s=stats[MODELS.indexOf(r.model)];s.count++;s.loss+=Number(r.profit<0);loss+=Number(r.profit<0);s.profit+=r.profit;if(r.profit===max)s.firstCredit+=1/winners;}
 }
 return {n,rooms,seed,composition,lossRate:loss/(n*rooms),allLossRate:allLoss/rooms,models:stats.map(s=>({model:s.model,count:s.count,lossRate:s.loss/s.count,meanProfit:Math.round(s.profit/s.count),firstCredit:s.firstCredit/rooms}))};
}
const calibration=CANDIDATES.map(c=>({config:c,result:tournament(c,20,1000,20261025)}));
writeFileSync(new URL('calibration.json',dir),JSON.stringify(calibration,null,2));
console.log('CALIBRATION');
for(const {config:c,result:r} of calibration)console.log(c.id,'loss',r.lossRate.toFixed(3),'all-loss',r.allLossRate.toFixed(3),r.models.map(m=>`${m.model}: win=${m.firstCredit.toFixed(3)},loss=${m.lossRate.toFixed(3)},profit=${m.meanProfit}`).join(' | '));

// 選定：共通費用・400円広告・課金率40%、配分効果の逓減で集中を緩和したW1。
// 下記は候補の選定にも用いたスクリーニング（最終検証とは区別）。
const selected=requested?CANDIDATES.find(c=>c.id===requested):RECOMMENDED;
const holdout=[];
for(const n of [2,20,30])holdout.push(tournament(selected,n,5000,938517+n));
for(const composition of [[.7,.15,.15],[.15,.7,.15],[.15,.15,.7],[1,0,0],[0,1,0],[0,0,1]])
 holdout.push(tournament(selected,30,1000,814903,composition));
writeFileSync(new URL('screening.json',dir),JSON.stringify({selected,scenarios:holdout},null,2));
console.log('\nSCREENING');
for(const r of holdout)console.log(r.n,r.composition,'loss',r.lossRate.toFixed(3),'all-loss',r.allLossRate.toFixed(3),r.models.filter(m=>m.count).map(m=>`${m.model}: win=${m.firstCredit.toFixed(3)},loss=${m.lossRate.toFixed(3)}`).join(' | '));
const grid=strategies(selected),random=rng(384109),responseStats=[];
for(const n of [2,20,30]){
 const models=Object.fromEntries(MODELS.map(m=>[m,0])),prices={},dev={},ads={},allocations={};const examples=[];
 for(let trial=0;trial<500;trial++){
  const composition=trial%4;
  const others=Array.from({length:n-1},()=>{
   const model=composition===0?MODELS[Math.floor(random()*3)]:random()<.7?MODELS[composition-1]:MODELS[Math.floor(random()*3)];
   const subset=grid.filter(g=>g.model===model);return subset[Math.floor(random()*subset.length)];
  });
  const best=bestResponse(others,grid,selected),c=best.choice;models[c.model]++;prices[c.price]=(prices[c.price]||0)+1;
  dev[c.development]=(dev[c.development]||0)+1;ads[c.advertising]=(ads[c.advertising]||0)+1;allocations[c.iosPercent]=(allocations[c.iosPercent]||0)+1;
  if(examples.length<20&&!examples.some(x=>x.model===c.model&&x.price===c.price&&x.development===c.development&&x.advertising===c.advertising))examples.push({model:c.model,price:c.price,iosPercent:c.iosPercent,development:c.development,advertising:c.advertising,profit:Math.round(best.estimatedProfit)});
 }
 responseStats.push({n,scenarios:500,models,prices,development:dev,advertising:ads,allocations,examples});
}
writeFileSync(new URL('best-response.json',dir),JSON.stringify(responseStats,null,2));
console.log('\nBEST RESPONSES');for(const r of responseStats)console.log(JSON.stringify(r));

// 最終候補を固定後、調整に用いていない別seedで旧版と比較。
const {settle:oldSettle}=await import('../lib/model-v2.js');
function baseline(n,rooms,seed){
 const random=rng(seed),grid=strategies(selected),byModel=MODELS.map(m=>grid.filter(s=>s.model===m));
 const stats=MODELS.map(model=>({model,count:0,loss:0,profit:0,firstCredit:0}));let allLoss=0,loss=0;
 for(let t=0;t<rooms;t++){
  const choices=Array.from({length:n},()=>{const mi=Math.floor(random()*3);return byModel[mi][Math.floor(random()*byModel[mi].length)];});
  const companies=choices.map((_,i)=>({id:String(i),name:String(i)}));
  const decisions=Object.fromEntries(choices.map((c,i)=>[String(i),{iosPercent:c.iosPercent,businessModel:c.model,price:c.price,development:c.development,advertising:c.advertising}]));
  const result=oldSettle(companies,decisions).results,max=Math.max(...result.map(r=>r.profit)),winners=result.filter(r=>r.profit===max).length;
  allLoss+=Number(max<0);
  for(let i=0;i<n;i++){const r=result[i],s=stats[MODELS.indexOf(choices[i].model)];s.count++;s.loss+=Number(r.profit<0);loss+=Number(r.profit<0);s.profit+=r.profit;if(r.profit===max)s.firstCredit+=1/winners;}
 }
 return {n,rooms,seed,lossRate:loss/(n*rooms),allLossRate:allLoss/rooms,models:stats.map(s=>({model:s.model,count:s.count,lossRate:s.loss/s.count,meanProfit:Math.round(s.profit/s.count),firstCredit:s.firstCredit/rooms}))};
}
const finalValidation=[2,20,30].map(n=>({n,old:baseline(n,5000,845200+n),proposed:tournament(selected,n,5000,845200+n)}));
writeFileSync(new URL('final-validation.json',dir),JSON.stringify({selected,scenarios:finalValidation},null,2));
console.log('\nFINAL VALIDATION');for(const r of finalValidation)console.log(JSON.stringify(r));

const fineGrid=strategies(selected,Array.from({length:101},(_,i)=>i)),fineRandom=rng(173925),fine=[];
for(const n of [2,20,30]){
 const distribution={models:{},prices:{},development:{},advertising:{},allocations:{}};
 for(let t=0;t<100;t++){
  const preferred=MODELS[t%3];
  const others=Array.from({length:n-1},()=>{const model=fineRandom()<.7?preferred:MODELS[Math.floor(fineRandom()*3)];const subset=grid.filter(c=>c.model===model);return subset[Math.floor(fineRandom()*subset.length)];});
  const c=bestResponse(others,fineGrid,selected).choice;
  for(const [label,value] of Object.entries({models:c.model,prices:c.price,development:c.development,advertising:c.advertising,allocations:c.iosPercent}))distribution[label][value]=(distribution[label][value]||0)+1;
 }
 fine.push({n,scenarios:100,strategies:fineGrid.length,distribution});
}
writeFileSync(new URL('fine-response.json',dir),JSON.stringify(fine,null,2));
console.log('\nFINE GRID');for(const r of fine)console.log(JSON.stringify(r));

// 同時に全社が前回を見て最適反応する強い仮定。学習効果の実証ではない。
const adaptive=[];
for(const n of [2,20,30]){
 const random=rng(492750+n),stats=Array.from({length:3},()=>({loss:0,profit:0,model:{free:0,freemium:0,paid:0},development:{},advertising:{},price:{}}));
 const rooms=500;
 for(let trial=0;trial<rooms;trial++){
  let rows=Array.from({length:n},()=>{const mi=Math.floor(random()*3),subset=grid.filter(c=>c.model===MODELS[mi]);return subset[Math.floor(random()*subset.length)];});
  for(let round=0;round<3;round++){
   const results=settle(rows,selected);
   for(let i=0;i<n;i++){
    const s=stats[round],r=results[i],c=rows[i];s.loss+=Number(r.profit<0);s.profit+=r.profit;s.model[c.model]++;
    for(const [label,value] of Object.entries({development:c.development,advertising:c.advertising,price:c.price}))s[label][value]=(s[label][value]||0)+1;
   }
   if(round<2) rows=rows.map((_,i)=>bestResponse(rows.filter((_,j)=>i!==j),grid,selected).choice);
  }
 }
 adaptive.push({n,rooms,rounds:stats.map((s,i)=>({round:i+1,lossRate:s.loss/(n*rooms),meanProfit:Math.round(s.profit/(n*rooms)),model:s.model,development:s.development,advertising:s.advertising,price:s.price}))});
}
writeFileSync(new URL('adaptive.json',dir),JSON.stringify(adaptive,null,2));
console.log('\nADAPTIVE');for(const r of adaptive)console.log(JSON.stringify(r));

const examples=[];
for(const n of [2,20,30])for(const model of MODELS)for(const investment of [0,500000,1000000]){
 const c=grid.find(c=>c.model===model&&c.price===(model==='free'?0:500)&&c.iosPercent===50&&c.development===investment&&c.advertising===investment);
 const r=settle(Array(n).fill(c),selected)[0];examples.push({n,model,investment,...r});
}
const acceptance={
 finalSeeds:[845202,845220,845230],
 simultaneousAdaptiveMaxLossUnder50for20and30:adaptive.filter(r=>r.n>=20).every(r=>r.rounds.every(s=>s.lossRate<.5)),
 allModelsBestResponse20and30:fine.filter(r=>r.n>=20).every(r=>MODELS.every(m=>r.distribution.models[m]>0)),
 random30LossUnder50:finalValidation[2].proposed.lossRate<.5,
 eachModelCanLead20and30:finalValidation.slice(1).every(r=>r.proposed.models.every(m=>m.firstCredit>.1)),
 noModelOver70Lead20and30:finalValidation.slice(1).every(r=>r.proposed.models.every(m=>m.firstCredit<.7)),
 eachModelMajorityProfitable20and30:finalValidation.slice(1).every(r=>r.proposed.models.every(m=>m.lossRate<.5)),
 defaultSymmetricAllModelsProfitable:examples.filter(r=>r.investment===500000).every(r=>r.profit>0),
 allPriceLevelsBestSomewhere:fine.slice(1).every(r=>[300,500,700].every(p=>r.distribution.prices[p]>0)),
};
writeFileSync(new URL('examples-and-acceptance.json',dir),JSON.stringify({examples,acceptance},null,2));
console.log('\nACCEPTANCE',JSON.stringify(acceptance));

// 授業では「仮説を一つだけ変える」ことも比較する。ゲームの入力制限にはしない。
const localAdaptive=[];
for(const n of [20,30]){
 const random=rng(725901+n),rooms=500,rounds=Array.from({length:3},()=>({loss:0,profit:0}));let cumulativeLoss=0;
 for(let trial=0;trial<rooms;trial++){
  let rows=Array.from({length:n},()=>{const model=MODELS[Math.floor(random()*3)],subset=grid.filter(c=>c.model===model);return subset[Math.floor(random()*subset.length)];});
  const cumulative=Array(n).fill(0);
  for(let round=0;round<3;round++){
   const result=settle(rows,selected);result.forEach((r,i)=>{rounds[round].loss+=Number(r.profit<0);rounds[round].profit+=r.profit;cumulative[i]+=r.profit;});
   if(round<2)rows=rows.map((current,i)=>{
    const neighborhood=grid.filter(next=>{
     let changes=Number(next.model!==current.model)+Number(next.iosPercent!==current.iosPercent)+Number(next.development!==current.development)+Number(next.advertising!==current.advertising);
     if(next.model===current.model&&next.price!==current.price)changes++;
     return changes<=1;
    });
    return bestResponse(rows.filter((_,j)=>j!==i),neighborhood,selected).choice;
   });
  }
  cumulativeLoss+=cumulative.filter(p=>p<0).length;
 }
 localAdaptive.push({n,rooms,rounds:rounds.map((r,i)=>({round:i+1,lossRate:r.loss/(n*rooms),meanProfit:Math.round(r.profit/(n*rooms))})),cumulativeLossRate:cumulativeLoss/(n*rooms)});
}
writeFileSync(new URL('one-change-adaptive.json',dir),JSON.stringify(localAdaptive,null,2));
console.log('\nONE CHANGE',JSON.stringify(localAdaptive));
if(Object.values(acceptance).some(value=>typeof value==='boolean'&&!value))process.exitCode=1;
