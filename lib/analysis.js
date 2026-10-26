import * as v2 from './model-v2.js';
import * as v3 from './model-v3.js';
import * as v4 from './model.js';
import * as v5 from './model-v5.js';
const modelFor=version=>version===5?v5:version===4?v4:version===3?v3:v2;
const models={free:'Free',freemium:'Freemium',paid:'Paid'};
const yen=value=>new Intl.NumberFormat('ja-JP',{maximumFractionDigits:0}).format(value)+'円';
const people=value=>new Intl.NumberFormat('ja-JP').format(value)+'人';
export const iosPercent=r=>r.iosPercent??(r.market==='android'?0:100);
export const marketUsers=(r,m)=>r.markets?.[m]?.customers??(r.market===m?r.customers:0);
export function ranks(rows,value){
 const sorted=[...rows].sort((a,b)=>value(b)-value(a));let rank=0;
 return new Map(sorted.map((r,i)=>{if(i===0||value(r)!==value(sorted[i-1]))rank=i+1;return[r.companyId,rank];}));
}
// 実際の履歴は再計算・変更せず、解説用の別計算だけを行う。
export function analyzeGame(game){
 const model=modelFor(game.modelVersion),history=game.history||[];
 return history.map((h,index)=>{
  const rows=[...h.results].sort((a,b)=>b.profit-a.profit);
  if(!rows.length)return{round:h.round,notes:['集計された会社がありません。'],counterfactuals:[]};
  const leader=rows[0],leaders=rows.filter(r=>r.profit===leader.profit),runner=rows.find(r=>r.profit<leader.profit);
  const totalUsers=rows.reduce((s,r)=>s+r.customers,0),losses=rows.filter(r=>r.profit<0).length;
  const notes=[`当回利益の1位は${leaders.map(r=>r.name).join('・')}（${yen(leader.profit)}）です。${leader.profit<0?'1位も赤字でした。':''}`,
   `黒字・収支均衡${rows.length-losses}社、赤字${losses}社。全社の獲得利用者は${people(totalUsers)}です。`];
  const counters=[];let comparison=null;
  if(runner){
   const marginA=leader.revenuePerCustomer??leader.revenue/leader.customers;
   const marginB=runner.revenuePerCustomer??runner.revenue/runner.customers;
   // 固定費差は記録済みの費用から分解。因果を推定する文章は生成しない。
   comparison={leaderId:leader.companyId,leaderName:leader.name,runnerId:runner.companyId,runnerName:runner.name,gap:leader.profit-runner.profit,
    customerDifference:leader.customers-runner.customers,unitRevenueDifference:Number.isFinite(marginA-marginB)?marginA-marginB:null,fixedCostDifference:runner.fixedCost-leader.fixedCost};
   notes.push(`${leader.name}と次順位の${runner.name}の利益差は${yen(comparison.gap)}。利用者数は${leader.customers===runner.customers?'同数':leader.customers>runner.customers?people(leader.customers-runner.customers)+'多く':people(runner.customers-leader.customers)+'少なく'}、固定費は${leader.fixedCost===runner.fixedCost?'同額':leader.fixedCost<runner.fixedCost?yen(runner.fixedCost-leader.fixedCost)+'少ない':yen(leader.fixedCost-runner.fixedCost)+'多い'}結果でした。`);
   const netA=(leader.revenuePerCustomer??model.unitRevenue(model.normalizeDecision(leader)))-model.RULES.variableCost;
   const netB=(runner.revenuePerCustomer??model.unitRevenue(model.normalizeDecision(runner)))-model.RULES.variableCost;
   comparison.profitGapParts=[
    {label:'利用者数の差',amount:(leader.customers-runner.customers)*(netA+netB)/2},
    {label:'1人あたりの利益への貢献の差',amount:(netA-netB)*(leader.customers+runner.customers)/2},
    {label:'固定費の差',amount:runner.fixedCost-leader.fixedCost},
   ];
   const main=comparison.profitGapParts.filter(p=>p.amount>0).sort((a,b)=>b.amount-a.amount)[0];
   if(main)notes.push(`利益差を金額で分けると、最も大きいプラスの内訳は${main.label}（＋${yen(main.amount)}）です。`);

   const companies=h.results.map(r=>({id:r.companyId,name:r.name}));
   const decisions=Object.fromEntries(h.results.map(r=>[r.companyId,model.normalizeDecision(r)]));
   const target=decisions[leader.companyId],other=decisions[runner.companyId];
   const groups=[['市場配分',['iosPercent']],['ビジネスモデルと価格',['businessModel','price']],['開発投資',['development']],['広告投資',['advertising']]];
   for(const [label,keys]of groups){
    if(keys.every(k=>target[k]===other[k]))continue;
    const changed={...target,...Object.fromEntries(keys.map(k=>[k,other[k]]))};
    if(!model.validDecision(changed))continue;
    const simulated=model.settle(companies,{...decisions,[leader.companyId]:changed},history.slice(0,index)).results.find(r=>r.companyId===leader.companyId);
    counters.push({label,actual:Object.fromEntries(keys.map(k=>[k,target[k]])),alternative:Object.fromEntries(keys.map(k=>[k,other[k]])),effect:leader.profit-simulated.profit,alternativeProfit:simulated.profit});
   }
   const plus=counters.filter(c=>c.effect>0).sort((a,b)=>b.effect-a.effect);
   if(plus.length)notes.push(`比較相手に合わせて1項目ずつ変える計算では、${plus.slice(0,2).map(c=>`${c.label}の選択が利益を${yen(c.effect)}押し上げる`).join('、')}結果でした。`);
   const minus=counters.filter(c=>c.effect<0).sort((a,b)=>a.effect-b.effect)[0];
   if(minus)notes.push(`一方、${leader.name}の${minus.label}を比較相手に合わせると、利益がさらに${yen(-minus.effect)}増える計算です。${minus.label==='開発投資'&&model.RULES.version>=4?'これは当回利益の比較で、開発投資の次回以降の効果は含めていません。':'1位の選択がすべて最善とは限りません。'}`);
  }else if(rows.length===1)notes.push('参加が1社のため、他社との勝敗の比較はできません。');
  else notes.push('全社が同じ当回利益のため、勝敗を分けた差はありません。');
  if(leaders.length>1&&runner)notes.push(`同率1位の比較例として${leader.name}を取り上げています。`);
  const cumulative=new Map();for(const prior of history.slice(0,index+1))for(const r of prior.results)cumulative.set(r.companyId,(cumulative.get(r.companyId)||0)+r.profit);
  const best=Math.max(...cumulative.values()),cumulativeLeaders=h.results.filter(r=>cumulative.get(r.companyId)===best).map(r=>r.name);
  if(index>0)notes.push(`この回までの累計利益1位は${cumulativeLeaders.join('・')}（${yen(best)}）。当回利益の順位と累計順位は別です。`);
  return{round:h.round,leaderIds:leaders.map(r=>r.companyId),leaderNames:leaders.map(r=>r.name),bestProfit:leader.profit,notes,comparison,counterfactuals:counters};
 });
}
const columns=[
 ['ゲーム名','title'],['参加コード','code'],['出力日時UTC','exportedAt'],['ゲーム作成日時UTC','createdAt'],['設定ラウンド数','totalRounds'],['進行中ラウンド','currentRound'],['進行状況','phase'],['モデル版','version'],['ラウンド','round'],['会社ID','companyId'],['会社名','name'],['意思決定状況','status'],
 ['当回利益順位','rank'],['累計利益順位','cumulativeRank'],['累計利益_円','cumulativeProfit'],['ビジネスモデル','businessModel'],['販売課金価格_円','price'],['Android配分_パーセント','androidPercent'],['iOS配分_パーセント','iosPercent'],['開発投資_円','development'],['支払広告投資_円','advertising'],
 ['Android利用者_人','androidUsers'],['iOS利用者_人','iosUsers'],['合計利用者_人','customers'],['販売課金収入_円','paymentRevenue'],['受取広告収入_円','adRevenue'],['売上_円','revenue'],['基本運営費_円','baseCost'],['市場移行費用_円','switchingCost'],['固定費_円','fixedCost'],['変動費_円','variableCost'],['費用_円','cost'],['当回利益_円','profit'],['利用者1人あたり売上_円','revenuePerCustomer'],['損益分岐点_人','breakEven'],
 ['Android開発資源_期首','androidResourceBefore'],['iOS開発資源_期首','iosResourceBefore'],['Android開発資源_期末','androidResourceAfter'],['iOS開発資源_期末','iosResourceAfter'],['各市場の人数_人','marketPool'],['全市場の未獲得人数_人','unserved'],
 ['Android低価格重視_人','androidValue'],['Androidバランス重視_人','androidBalance'],['Android品質重視_人','androidQuality'],['iOS低価格重視_人','iosValue'],['iOSバランス重視_人','iosBalance'],['iOS品質重視_人','iosQuality'],['当回解説','commentary'],['比較計算JSON','comparisonDetails'],['計算ルールJSON','rules'],
];
export function exportRows(game,exportedAt=new Date().toISOString()){
 const model=modelFor(game.modelVersion),rules=model.RULES,analysis=analyzeGame(game),cumulative=new Map();
 const common={title:game.title,code:game.code,createdAt:game.createdAt,exportedAt,currentRound:game.round,phase:game.phase,totalRounds:game.totalRounds??rules.rounds,version:rules.version,rules:JSON.stringify({...rules,rounds:game.totalRounds??rules.rounds})};
 const rows=[];
 for(const h of game.history||[]){
  for(const r of h.results)cumulative.set(r.companyId,(cumulative.get(r.companyId)||0)+r.profit);
  const roundRanks=ranks(h.results,r=>r.profit),sumRanks=ranks(h.results,r=>cumulative.get(r.companyId));
  for(const r of h.results){
   const d=model.normalizeDecision(r),oldAds=d.businessModel==='free'?r.revenue:0;
   const a={...common,round:h.round,companyId:r.companyId,name:r.name,status:'集計済み',rank:roundRanks.get(r.companyId),cumulativeRank:sumRanks.get(r.companyId),cumulativeProfit:cumulative.get(r.companyId),...d,
    businessModel:models[d.businessModel],androidPercent:100-iosPercent(d),iosPercent:iosPercent(d),androidUsers:marketUsers(r,'android'),iosUsers:marketUsers(r,'ios'),customers:r.customers,
    paymentRevenue:r.paymentRevenue??r.revenue-(r.adRevenue??oldAds),adRevenue:r.adRevenue??oldAds,revenue:r.revenue,baseCost:rules.baseCost,switchingCost:r.switchingCost??0,fixedCost:r.fixedCost,variableCost:r.variableCost,cost:r.cost,profit:r.profit,revenuePerCustomer:r.revenuePerCustomer,breakEven:r.breakEven,
    androidResourceBefore:r.resourcesBefore?.android,iosResourceBefore:r.resourcesBefore?.ios,androidResourceAfter:r.resourcesAfter?.android,iosResourceAfter:r.resourcesAfter?.ios,marketPool:h.marketPool,unserved:h.unserved,commentary:analysis.find(a=>a.round===h.round)?.notes.join('\n'),comparisonDetails:JSON.stringify(analysis.find(a=>a.round===h.round))};
   for(const [market,prefix]of [['android','android'],['ios','ios']])for(const [id,suffix]of [['value','Value'],['balance','Balance'],['quality','Quality']])a[prefix+suffix]=r.markets?.[market]?.segments?.find(s=>s.id===id)?.customers;
   rows.push(a);
  }
 }
 if(game.phase==='deciding')for(const c of game.companies){
  const d=game.decisions[c.id];rows.push({...common,round:game.round,companyId:c.id,name:c.name,status:d?'確定済み・集計待ち':'未確定',cumulativeProfit:cumulative.get(c.id)??0,...(d?{...model.normalizeDecision(d),businessModel:models[d.businessModel||'paid'],androidPercent:100-iosPercent(d),iosPercent:iosPercent(d)}:{})});
 }
 return rows;
}
function csvCell(value){
 if(value===undefined||value===null)return '""';
 let text=String(value);
 // 会社名・ゲーム名などを表計算ソフトで数式として実行させない。負の数値は数値として残す。
 if(typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/u.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function exportCsv(game,exportedAt){
 return '\uFEFF'+[columns.map(([label])=>csvCell(label)).join(','),...exportRows(game,exportedAt).map(r=>columns.map(([,key])=>csvCell(r[key])).join(','))].join('\r\n')+'\r\n';
}
export function exportText(game,exportedAt=new Date().toISOString()){
 const rows=exportRows(game,exportedAt),analysis=analyzeGame(game),lines=['SmartApps Biz Game 分析用記録',`ゲーム名: ${game.title}`,`参加コード: ${game.code}`,`出力日時UTC: ${exportedAt}`,`進行: ラウンド${game.round} / 全${game.totalRounds??3}回 / ${game.phase}`,`計算ルール: ${JSON.stringify({...modelFor(game.modelVersion).RULES,rounds:game.totalRounds??3})}`,''];
 for(const round of [...new Set(rows.map(r=>r.round))]){
  const explanation=analysis.find(a=>a.round===round);
  lines.push(`【ラウンド${round}】`,...(explanation?.notes||['集計前の記録です。結果の金額・人数は未確定です。']),'');
  for(const c of explanation?.counterfactuals||[])lines.push(`比較計算 ${c.label}: ${JSON.stringify(c.actual)} → ${JSON.stringify(c.alternative)} / 置換後利益${yen(c.alternativeProfit)} / 実際の選択との差${yen(c.effect)}`);
  if(explanation?.counterfactuals.length)lines.push('');
  for(const row of rows.filter(r=>r.round===round)){
   lines.push(`■ ${row.name}`);
   for(const [label,key]of columns)if(!['title','code','createdAt','exportedAt','currentRound','phase','rules','commentary','comparisonDetails','name','round'].includes(key))lines.push(`${label}: ${row[key]??'未確定・記録なし'}`);
   lines.push('');
  }
 }
 lines.push('解説の比較計算は、他社と過去の開発経験を固定し、上位社の1項目だけを比較相手と同じ選択に置き換えています。項目間の相互作用があるため、効果の金額は足し合わせられません。');
 return lines.join('\r\n')+'\r\n';
}
