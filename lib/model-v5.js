// v0.5試行版：収入単価を引き下げ、無料モデルの獲得力と共通運営費を調整。
import {validDecision,normalizeDecision,ranking} from './model-v2.js';
export {validDecision,normalizeDecision,ranking};
export const SEGMENTS = [
  {id:'value',name:'無料・低価格重視',android:.5,ios:.25,affinity:[3,1.2,.3],quality:.25,prices:[1.8,.7,.12]},
  {id:'balance',name:'機能と価格のバランス',android:.35,ios:.35,affinity:[.85,2,1],quality:.65,prices:[1.25,1,.4]},
  {id:'quality',name:'品質重視',android:.15,ios:.4,affinity:[.3,1,2.4],quality:1.2,prices:[1.05,1,.7]},
];

export function createModel(overrides={}) {
const RULES = Object.freeze({
  version:5,rounds:3,maxCompanies:30,customersPerCompany:6000,
  baseCost:300000,variableCost:100,freeRevenue:300,conversionRate:.3,
  prices:[300,500,700],investments:[0,500000,1000000],investmentLevels:[0,1,1.35],
  effortExponent:.7,advertisingCoefficient:.5,segments:SEGMENTS,
  resourceRetention:.8,productivityGain:.12,residualQualityGain:.08,resourceScale:500000,switchingCostPerFullShift:200000,modelMultipliers:{free:1.8,freemium:1.4,paid:1},freemiumPriceExponent:.5,
  ...overrides,
});
const models=['free','freemium','paid'];
const level=x=>RULES.investmentLevels[RULES.investments.indexOf(x)];
function incomeRates(d){
  const paid=d.businessModel==='paid',free=d.businessModel==='free';
  const payment=free?0:paid?d.price:RULES.conversionRate*d.price;
  const advertising=paid?0:free?RULES.freeRevenue:(1-RULES.conversionRate)*RULES.freeRevenue;
  return {payment,advertising,total:payment+advertising};
}
const unitRevenue=d=>incomeRates(d).total;
function developmentContext(companyId,history=[],decision=null){
  let resources={android:0,ios:0},previous=null;
  for(const h of history){
    const past=h.results.find(r=>r.companyId===companyId);
    if(!past)continue;
    const d=normalizeDecision(past);
    resources={android:resources.android*RULES.resourceRetention+d.development*(100-d.iosPercent)/100,
      ios:resources.ios*RULES.resourceRetention+d.development*d.iosPercent/100};
    previous=d;
  }
  const switchingCost=previous&&decision?Math.round(RULES.switchingCostPerFullShift*Math.abs(decision.iosPercent-previous.iosPercent)/100):0;
  return {resources,previousIosPercent:previous?.iosPercent??null,switchingCost};
}
function score(d,market,segmentIndex,context=null){
  const segment=SEGMENTS[segmentIndex],effort=(market==='ios'?d.iosPercent:100-d.iosPercent)/100;
  const rawPriceFactor=d.businessModel==='free'?1:segment.prices[RULES.prices.indexOf(d.price)];
  const priceFactor=d.businessModel==='freemium'?rawPriceFactor**RULES.freemiumPriceExponent:rawPriceFactor;
  const stock=context?.resources[market]||0,learning=stock/(RULES.resourceScale+stock);
  const effectiveDevelopment=level(d.development)*(1+RULES.productivityGain*learning)+RULES.residualQualityGain*learning;
  return (RULES.modelMultipliers[d.businessModel]??1)*effort**RULES.effortExponent*segment.affinity[models.indexOf(d.businessModel)]*priceFactor
    *(1+segment.quality*effectiveDevelopment)*(1+RULES.advertisingCoefficient*level(d.advertising));
}
function economics(d,customers,switchingCost=0){
  const rates=incomeRates(d),fixedCost=RULES.baseCost+d.development+d.advertising+switchingCost;
  const paymentRevenue=customers*rates.payment,adRevenue=customers*rates.advertising;
  const revenue=paymentRevenue+adRevenue,variableCost=customers*RULES.variableCost;
  return {customers,switchingCost,revenue,paymentRevenue,adRevenue,revenuePerCustomer:rates.total,
    fixedCost,variableCost,cost:fixedCost+variableCost,profit:revenue-fixedCost-variableCost,
    breakEven:Math.ceil(fixedCost/(rates.total-RULES.variableCost))};
}
function settle(companies,rawDecisions,history=[]){
  if(!companies.length||companies.some(c=>!rawDecisions[c.id]))throw new Error('全社の意思決定が必要です。');
  const decisions=Object.fromEntries(companies.map(c=>[c.id,normalizeDecision(rawDecisions[c.id])]));
  if(companies.some(c=>!validDecision(decisions[c.id])))throw new Error('全社の有効な意思決定が必要です。');
  const contexts=companies.map(c=>developmentContext(c.id,history,decisions[c.id]));
  const pool=companies.length*RULES.customersPerCompany/2;
  const allocations=companies.map(()=>Object.fromEntries(['android','ios'].map(m=>[m,{customers:0,competitors:0,segments:[]}])));
  for(const market of ['android','ios'])for(const [si,segment]of SEGMENTS.entries()){
    const demand=pool*segment[market],weights=companies.map((c,i)=>score(decisions[c.id],market,si,contexts[i]));
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
  const results=companies.map((c,i)=>({companyId:c.id,name:c.name,modelVersion:5,...decisions[c.id],markets:allocations[i],
    resourcesBefore:contexts[i].resources,
    resourcesAfter:{android:contexts[i].resources.android*RULES.resourceRetention+decisions[c.id].development*(100-decisions[c.id].iosPercent)/100,
      ios:contexts[i].resources.ios*RULES.resourceRetention+decisions[c.id].development*decisions[c.id].iosPercent/100},
    ...economics(decisions[c.id],allocations[i].android.customers+allocations[i].ios.customers,contexts[i].switchingCost)}));
  return {modelVersion:5,results,marketPool:pool,unserved:pool*2-results.reduce((s,r)=>s+r.customers,0)};
}

return {RULES,incomeRates,unitRevenue,developmentContext,score,economics,settle};
}
export const {RULES,incomeRates,unitRevenue,developmentContext,score,economics,settle}=createModel();
