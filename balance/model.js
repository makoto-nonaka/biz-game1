// v0.3設計検証専用。公開中のゲームは変更しない。
export const SEGMENTS = [
  { name: '無料・低価格を重視', android: .50, ios: .25, affinity: [3, 1.2, .3], alpha: 2.0, quality: .25 },
  { name: '機能と価格のバランス', android: .35, ios: .35, affinity: [.85, 2, 1], alpha: 1.2, quality: .65 },
  { name: '品質・有料サービスを重視', android: .15, ios: .40, affinity: [.3, 1, 2.4], alpha: .7, quality: 1.2 },
];
export const MODELS = ['free', 'freemium', 'paid'];
export const CANDIDATES = [
 ...[.5,.7,.85].map((effortExponent,i)=>({id:`W${i}`,demand:6000,baseCost:500000,freeRevenue:400,conversion:.4,variable:[100,100,100],freemiumAds:true,priceTable:true,levelMax:1.35,premiumPrice:.7,effortExponent})),
 ...[.65,.7,.75].flatMap((premiumPrice,i)=>[1.25,1.35].map((levelMax,j)=>({id:`V${i}${j}`,demand:6000,baseCost:500000,freeRevenue:400,conversion:.4,variable:[100,100,100],freemiumAds:true,priceTable:true,levelMax,premiumPrice}))),
 ...[360,400,440].flatMap((freeRevenue,i)=>[1.15,1.25].map((levelMax,j)=>({id:`U${i}${j}`,demand:6000,baseCost:500000,freeRevenue,conversion:.4,variable:[100,100,100],freemiumAds:true,priceTable:true,levelMax}))),
 {id:'A',demand:6000,baseCost:300000,freeRevenue:180,conversion:.6,variable:[30,60,100]},
 {id:'B',demand:8000,baseCost:300000,freeRevenue:180,conversion:.6,variable:[30,60,100]},
 {id:'C',demand:8000,baseCost:500000,freeRevenue:220,conversion:.6,variable:[30,60,100]},
 {id:'D',demand:10000,baseCost:500000,freeRevenue:180,conversion:.6,variable:[30,60,100]},
 {id:'E',demand:8000,baseCost:300000,freeRevenue:220,conversion:.6,variable:[30,60,100]},
 {id:'F',demand:8000,baseCost:300000,freeRevenue:180,conversion:.5,variable:[30,60,100]},
 {id:'G',demand:10000,baseCost:500000,freeRevenue:220,conversion:.5,variable:[30,60,100]},
 {id:'H',demand:10000,baseCost:500000,freeRevenue:220,conversion:.6,variable:[30,60,100]},
 ...[380,400,420,440].flatMap((freeRevenue,i)=>[.3,.4,.5].map((conversion,j)=>({id:`T${i}${j}`,demand:6000,baseCost:500000,freeRevenue,conversion,variable:[100,100,100],freemiumAds:true}))),
 ...[320,360,400].flatMap((freeRevenue,i)=>[.7,.8,.9].map((conversion,j)=>({id:`S${i}${j}`,demand:6000,baseCost:500000,freeRevenue,conversion,variable:[30,60,100]}))),
];
export const RECOMMENDED = CANDIDATES.find(c => c.id === 'W1');
export function strategies(config, allocations=[0,25,50,75,100]) {
 const result=[];
 for(const model of MODELS) for(const price of model==='free'?[0]:[300,500,700])
 for(const development of [0,500000,1000000]) for(const advertising of [0,500000,1000000])
 for(const iosPercent of allocations) {
  const mi=MODELS.indexOf(model), level=x=>x===0?0:x===500000?1:(config.levelMax??1.5);
  const unitRevenue=model==='free'?config.freeRevenue:model==='freemium'?config.conversion*price+(config.freemiumAds?(1-config.conversion)*config.freeRevenue:0):price;
  const contribution=unitRevenue-config.variable[mi];
  const weights=[];
  for(const market of ['android','ios']) for(const [si,segment] of SEGMENTS.entries()){
   const effort=(market==='ios'?iosPercent:100-iosPercent)/100;
   const priceFactor=model==='free'?1:config.priceTable?[[1.8,.7,.12],[1.25,1,.4],[1.05,1,config.premiumPrice??.85]][si][[300,500,700].indexOf(price)]:(500/price)**(segment.alpha*(model==='freemium'?.5:1));
   weights.push(effort**(config.effortExponent??1)*segment.affinity[mi]*priceFactor
    *(1+segment.quality*level(development))*(1+.5*level(advertising)));
  }
  result.push({model,price,development,advertising,iosPercent,weights,unitRevenue,contribution,
   fixedCost:config.baseCost+development+advertising,
   breakEven:Math.ceil((config.baseCost+development+advertising)/contribution)});
 }
 return result;
}
export function pools(n,config){return ['android','ios'].flatMap(m=>SEGMENTS.map(s=>n*config.demand/2*s[m]));}
export function settle(rows,config,integer=true){
 const demand=pools(rows.length,config), totals=Array(6).fill(0),counts=rows.map(()=>0);
 for(const r of rows) r.weights.forEach((w,j)=>totals[j]+=w);
 for(let j=0;j<6;j++){
  if(!totals[j]) continue;
  const shares=rows.map((r,i)=>{const raw=demand[j]*r.weights[j]/totals[j];return {i,raw,count:integer?Math.floor(raw):raw};});
  if(integer){let remainder=Math.round(demand[j])-shares.reduce((s,r)=>s+r.count,0);
   const order=shares.filter(s=>rows[s.i].weights[j]>0).sort((a,b)=>(b.raw-b.count)-(a.raw-a.count)||a.i-b.i);
   for(let k=0;k<remainder;k++)order[k].count++;
  }
  shares.forEach(s=>counts[s.i]+=s.count);
 }
 return rows.map((r,i)=>({model:r.model,customers:counts[i],revenue:Math.round(counts[i]*r.unitRevenue),
  cost:r.fixedCost+counts[i]*config.variable[MODELS.indexOf(r.model)],profit:Math.round(counts[i]*r.contribution)-r.fixedCost,breakEven:r.breakEven}));
}
export function rng(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function bestResponse(others,grid,config){
 const totals=Array(6).fill(0);for(const r of others)r.weights.forEach((w,j)=>totals[j]+=w);
 const demand=pools(others.length+1,config);let best,profit=-Infinity;
 for(const choice of grid){const users=choice.weights.reduce((s,w,j)=>s+(w?demand[j]*w/(totals[j]+w):0),0);
  const p=users*choice.contribution-choice.fixedCost;
  if(p>profit){best=choice;profit=p;}
 }
 return {choice:best,estimatedProfit:profit};
}
