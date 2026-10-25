// v0.3：シミュレーションで選定したW1。計算用係数は独自の授業用仮定。
import {validDecision,normalizeDecision,ranking} from './model-v2.js';
export {validDecision,normalizeDecision,ranking};
export const SEGMENTS = [
  {id:'value',name:'無料・低価格重視',android:.5,ios:.25,affinity:[3,1.2,.3],quality:.25,prices:[1.8,.7,.12]},
  {id:'balance',name:'機能と価格のバランス',android:.35,ios:.35,affinity:[.85,2,1],quality:.65,prices:[1.25,1,.4]},
  {id:'quality',name:'品質重視',android:.15,ios:.4,affinity:[.3,1,2.4],quality:1.2,prices:[1.05,1,.7]},
];
export const RULES = Object.freeze({
  version:3,rounds:3,maxCompanies:30,customersPerCompany:6000,
  baseCost:500000,variableCost:100,freeRevenue:400,conversionRate:.4,
  prices:[300,500,700],investments:[0,500000,1000000],investmentLevels:[0,1,1.35],
  effortExponent:.7,advertisingCoefficient:.5,segments:SEGMENTS,
});
const models=['free','freemium','paid'];
const level=x=>RULES.investmentLevels[RULES.investments.indexOf(x)];
export function incomeRates(d){
  const paid=d.businessModel==='paid',free=d.businessModel==='free';
  const payment=free?0:paid?d.price:RULES.conversionRate*d.price;
  const advertising=paid?0:free?RULES.freeRevenue:(1-RULES.conversionRate)*RULES.freeRevenue;
  return {payment,advertising,total:payment+advertising};
}
export const unitRevenue=d=>incomeRates(d).total;
export function score(d,market,segmentIndex){
  const segment=SEGMENTS[segmentIndex],effort=(market==='ios'?d.iosPercent:100-d.iosPercent)/100;
  const priceFactor=d.businessModel==='free'?1:segment.prices[RULES.prices.indexOf(d.price)];
  return effort**RULES.effortExponent*segment.affinity[models.indexOf(d.businessModel)]*priceFactor
    *(1+segment.quality*level(d.development))*(1+RULES.advertisingCoefficient*level(d.advertising));
}
export function economics(d,customers){
  const rates=incomeRates(d),fixedCost=RULES.baseCost+d.development+d.advertising;
  const paymentRevenue=customers*rates.payment,adRevenue=customers*rates.advertising;
  const revenue=paymentRevenue+adRevenue,variableCost=customers*RULES.variableCost;
  return {customers,revenue,paymentRevenue,adRevenue,revenuePerCustomer:rates.total,
    fixedCost,variableCost,cost:fixedCost+variableCost,profit:revenue-fixedCost-variableCost,
    breakEven:Math.ceil(fixedCost/(rates.total-RULES.variableCost))};
}
export function settle(companies,rawDecisions){
  if(!companies.length||companies.some(c=>!rawDecisions[c.id]))throw new Error('全社の意思決定が必要です。');
  const decisions=Object.fromEntries(companies.map(c=>[c.id,normalizeDecision(rawDecisions[c.id])]));
  if(companies.some(c=>!validDecision(decisions[c.id])))throw new Error('全社の有効な意思決定が必要です。');
  const pool=companies.length*RULES.customersPerCompany/2;
  const allocations=companies.map(()=>Object.fromEntries(['android','ios'].map(m=>[m,{customers:0,competitors:0,segments:[]}])));
  for(const market of ['android','ios'])for(const [si,segment]of SEGMENTS.entries()){
    const demand=pool*segment[market],weights=companies.map(c=>score(decisions[c.id],market,si));
    const sum=weights.reduce((a,b)=>a+b,0),competitors=weights.filter(w=>w>0).length;
    const shares=weights.map((w,i)=>{const raw=sum?demand*w/sum:0;return {i,raw,count:Math.floor(raw)};});
    if(sum){
      const remaining=Math.round(demand)-shares.reduce((s,r)=>s+r.count,0);
      const order=shares.filter(s=>weights[s.i]>0).sort((a,b)=>(b.raw-b.count)-(a.raw-a.count)||a.i-b.i);
      for(let k=0;k<remaining;k++)order[k].count++;
    }
    shares.forEach(r=>{const a=allocations[r.i][market];a.customers+=r.count;a.competitors=competitors;
      a.segments.push({id:segment.id,name:segment.name,customers:r.count,marketCustomers:demand});});
  }
  const results=companies.map((c,i)=>({companyId:c.id,name:c.name,modelVersion:3,...decisions[c.id],markets:allocations[i],
    ...economics(decisions[c.id],allocations[i].android.customers+allocations[i].ios.customers)}));
  return {modelVersion:3,results,marketPool:pool,unserved:pool*2-results.reduce((s,r)=>s+r.customers,0)};
}
