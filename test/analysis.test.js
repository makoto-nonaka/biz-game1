import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../lib/model-v5.js';
import * as old from '../lib/model-v2.js';
import {analyzeGame,exportRows,exportCsv,exportText} from '../lib/analysis.js';
function fixture(){
 const companies=['無料社','課金社','有料社'].map((name,i)=>({id:String(i),name,token:`PRIVATE-${i}`}));
 const decisions=Object.fromEntries(companies.map((c,i)=>[c.id,{iosPercent:[25,65,75][i],businessModel:['free','freemium','paid'][i],price:[0,700,500][i],development:[0,500000,1000000][i],advertising:[500000,0,500000][i]}]));
 const history=[];
 for(let round=1;round<=3;round++){const out=model.settle(companies,decisions,history);history.push({round,...out});}
 return{title:'検証用',code:'123',createdAt:'2026-10-26T01:00:00Z',modelVersion:5,round:3,phase:'finished',companies,decisions,history,teacherToken:'PRIVATE-ADMIN'};
}
// CSVを独立した状態機械で読み戻し、改行・二重引用符も確認する。
function parseCsv(csv){
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0,s=csv.replace(/^\uFEFF/,'');i<s.length;i++){
  const c=s[i];
  if(c==='"'){if(quoted&&s[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(value);value='';}
  else if(c==='\r'&&s[i+1]==='\n'&&!quoted){row.push(value);rows.push(row);row=[];value='';i++;}
  else value+=c;
 }
 assert.equal(quoted,false);return rows;
}
test('ラウンド別の当回利益上位を比較し、比較計算を本体で再現できる',()=>{
 const game=fixture(),before=JSON.stringify(game),analysis=analyzeGame(game);
 assert.equal(analysis.length,3);
 for(const [index,a]of analysis.entries()){
  const rows=game.history[index].results,leader=rows.find(r=>r.companyId===a.leaderIds[0]);
  assert.ok(Math.abs(a.comparison.profitGapParts.reduce((s,p)=>s+p.amount,0)-a.comparison.gap)<.00001);
  assert.equal(a.bestProfit,Math.max(...rows.map(r=>r.profit)));assert.ok(a.notes[0].includes(leader.name));
  for(const c of a.counterfactuals){
   const decisions=Object.fromEntries(rows.map(r=>[r.companyId,model.normalizeDecision(r)]));
   decisions[leader.companyId]={...decisions[leader.companyId],...c.alternative};
   const expected=model.settle(game.companies,decisions,game.history.slice(0,index)).results.find(r=>r.companyId===leader.companyId).profit;
   assert.equal(c.alternativeProfit,expected);assert.equal(c.effect,leader.profit-expected);
  }
 }
 assert.equal(JSON.stringify(game),before);
});
test('同率全社・単独参加・全社赤字を誤って勝因と断定しない',()=>{
 const game=fixture();game.history=[];game.companies=game.companies.slice(0,2);
 const d={iosPercent:50,businessModel:'free',price:0,development:1000000,advertising:1000000};
 game.decisions=Object.fromEntries(game.companies.map(c=>[c.id,d]));game.history.push({round:1,...model.settle(game.companies,game.decisions)});
 const a=analyzeGame(game)[0];assert.equal(a.leaderIds.length,2);assert.equal(a.counterfactuals.length,0);assert.ok(a.notes.some(s=>s.includes('差はありません')));assert.ok(a.notes[0].includes('赤字'));
 game.companies=game.companies.slice(0,1);game.history=[{round:1,...model.settle(game.companies,game.decisions)}];
 assert.ok(analyzeGame(game)[0].notes.some(s=>s.includes('1社')));
});
test('CSVは全社×全ラウンド、累計・当回順位・開発資源・ルールを保持し秘密情報を出さない',()=>{
 const game=fixture(),rows=exportRows(game,'2026-10-26T01:02:03Z'),parsed=parseCsv(exportCsv(game,'2026-10-26T01:02:03Z'));
 assert.equal(rows.length,9);assert.equal(parsed.length,10);assert.ok(parsed.every(r=>r.length===parsed[0].length));
 for(const r of rows){const actual=game.history[r.round-1].results.find(x=>x.companyId===r.companyId);assert.equal(r.profit,actual.profit);assert.equal(r.cumulativeProfit,game.history.slice(0,r.round).reduce((s,h)=>s+h.results.find(x=>x.companyId===r.companyId).profit,0));assert.ok(r.rank>=1);assert.ok(r.cumulativeRank>=1);assert.equal(r.androidResourceAfter,actual.resourcesAfter.android);assert.equal(JSON.parse(r.rules).conversionRate,.3);}
 const csv=exportCsv(game);assert.ok(csv.startsWith('\uFEFF'));assert.ok(!csv.includes('PRIVATE-'));assert.ok(!exportText(game).includes('PRIVATE-'));
 assert.ok(exportText(game).includes('【ラウンド3】'));assert.ok(exportText(game).includes('当回利益_円'));
});
test('集計前の確定状況を出力し、未確定の選択・結果は空欄とする',()=>{
 const game=fixture();game.phase='deciding';game.round=2;game.history=game.history.slice(0,1);delete game.decisions['1'];
 const rows=exportRows(game),pending=rows.filter(r=>r.round===2);assert.equal(rows.length,6);assert.equal(pending.length,3);
 assert.equal(pending.find(r=>r.companyId==='1').status,'未確定');assert.equal(pending.find(r=>r.companyId==='1').development,undefined);assert.equal(pending[0].profit,undefined);assert.equal(pending[0].status,'確定済み・集計待ち');
});
test('日本語・引用符・カンマ・数式会社名を安全にCSVへ出し、赤字の負数を壊さない',()=>{
 const game=fixture();game.title='=HYPERLINK("bad")';game.history[0].results[0].name='株式会社"未来",アプリ';game.history[1].results[0].name='  =1+1';game.history[1].results[0].profit=-123;
 const csv=exportCsv(game),parsed=parseCsv(csv),header=parsed[0];
 assert.equal(parsed[1][header.indexOf('会社名')],'株式会社"未来",アプリ');assert.equal(parsed[4][header.indexOf('会社名')],"'  =1+1");assert.equal(parsed[4][header.indexOf('当回利益_円')],'-123');assert.ok(parsed[1][0].startsWith("'="));
});
test('旧版v0.2の履歴も元の計算で解説・出力し、未記録の資源を捏造しない',()=>{
 const game=fixture();game.modelVersion=2;game.history=[{round:1,...old.settle(game.companies,game.decisions)}];
 assert.equal(analyzeGame(game).length,1);const r=exportRows(game)[0];assert.equal(r.androidResourceBefore,undefined);assert.equal(JSON.parse(r.rules).freeRevenue,180);
});
