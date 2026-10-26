// 外部AIを使わない対戦相手。現在のプレイヤーの意思決定を入力に取らない。
import {createHash} from 'node:crypto';
const profiles=[
 {model:'free',ios:20,development:0,advertising:500000,price:0},
 {model:'freemium',ios:50,development:500000,advertising:500000,price:500},
 {model:'paid',ios:80,development:1000000,advertising:0,price:700},
 {model:'free',ios:50,development:500000,advertising:0,price:0},
 {model:'paid',ios:30,development:0,advertising:500000,price:300},
 {model:'freemium',ios:70,development:500000,advertising:0,price:700},
];
const draw=(seed,key,max)=>createHash('sha256').update(`${seed}:${key}`).digest().readUInt32BE(0)%max;
export function computerDecisions(companies,history=[],seed='practice') {
 const round=history.length+1;
 return Object.fromEntries(companies.filter(c=>c.computer).map(c=>{
  const profile=profiles[c.strategy%profiles.length];
  const past=history.at(-1)?.results.find(r=>r.companyId===c.id);
  let d=past?{iosPercent:past.iosPercent,businessModel:past.businessModel,price:past.price,development:past.development,advertising:past.advertising}
   :{iosPercent:Math.max(0,Math.min(100,profile.ios+(draw(seed,c.id,3)-1)*10)),businessModel:profile.model,price:profile.price,development:profile.development,advertising:profile.advertising};
  if(past){
   // 赤字なら費用を抑える。販売型で利用者が少なければ価格も1段階見直す。
   if(past.profit<0){
    if(d.development>0)d.development-=500000;
    else if(d.advertising>0)d.advertising-=500000;
    if(d.businessModel!=='free'&&past.customers<4000)d.price=Math.max(300,d.price-200);
   }else if(past.customers<5000&&d.advertising<500000){d.advertising=500000;}
   // 少数の企業が、前回までの公開情報から競争の少ない市場へ小さく配分を変える。
   if(draw(seed,`${c.id}:${round}:move`,3)===0){
    const results=history.at(-1).results;
    const a=results.filter(r=>(r.markets?.android?.customers??0)>(r.markets?.ios?.customers??0)).length;
    const i=results.length-a;
    if(a!==i)d.iosPercent=Math.max(0,Math.min(100,d.iosPercent+(a>i?10:-10)));
   }
  }
  return [c.id,d];
 }));
}
