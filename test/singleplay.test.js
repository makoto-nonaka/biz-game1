import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {computerDecisions} from '../lib/computers.js';
import {validDecision,settle} from '../lib/model-v5.js';
test('コンピュータは過去の情報で有効な意思決定を行い、入力を書き換えない',()=>{
 const companies=Array.from({length:14},(_,i)=>({id:`cpu-${i}`,name:`CPU ${i}`,computer:true,strategy:i}));
 const history=[];
 for(let r=1;r<=4;r++){
  const before=JSON.stringify(history),d=computerDecisions(companies,history,'fixed-seed');
  assert.equal(JSON.stringify(history),before);assert.deepEqual(d,computerDecisions(companies,history,'fixed-seed'));
  assert.ok(Object.values(d).every(validDecision));assert.equal(Object.keys(d).length,14);
  if(r===1)assert.equal(new Set(Object.values(d).map(v=>v.businessModel)).size,3);
  history.push({round:r,...settle(companies,d,history)});
 }
});
test('1人用は2〜14相手・1〜4回、即時集計、本人の次へ操作、再開、非公開情報を保護',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-single-'));let server,base;
 async function start(){server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 await start();t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const request=(path,data,token)=>fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
 for(const extra of [{computers:1},{computers:15},{computers:2.5},{computers:'5'},{rounds:0},{rounds:5},{name:' '}])assert.equal((await request('/api/singleplay',{name:'A',...extra})).status,400);
 assert.match(await (await request('/singleplay.html')).text(),/data-entry="single"/);
 const owner=await (await request('/api/singleplay',{name:'自社',computers:14,rounds:4})).json();
 const path=`/api/games/${owner.code}`;assert.match(owner.code,/^s[a-f0-9]{24}$/);assert.equal(owner.mode,'single');
 const other=await (await request('/api/singleplay',{name:'別の自社',computers:2,rounds:1})).json();
 assert.equal((await request(path,undefined,other.token)).status,401);assert.equal((await request(path)).status,401);
 assert.equal((await request(path+'/join',{name:'乱入'})).status,403);
 assert.equal((await request(path+'/export',undefined,owner.token)).status,403);
 let state=await (await request(path,undefined,owner.token)).json();assert.equal(state.companies.length,15);assert.equal(state.submitted,14);assert.equal(state.me.decision,null);
 assert.ok(!JSON.stringify(state).includes('computerSeed'));assert.ok(!('analysis' in state));
 for(let round=1;round<=4;round++){
  const data={round,iosPercent:round%2?0:100,businessModel:'freemium',price:500,development:500000,advertising:0};
  assert.equal((await request(path+'/next',{round},owner.token)).status,409);
  const saved=JSON.parse(readFileSync(join(dir,'games.json'),'utf8')).games[owner.code];
  const botsBefore=JSON.stringify(saved.decisions);
  const response=await request(path+'/decision',data,owner.token);assert.equal(response.status,200);state=await response.json();
  assert.equal(state.history.length,round);assert.equal(state.phase,round===4?'finished':'results');
  assert.equal(state.history.at(-1).results.length,15);assert.equal(state.ranking.length,15);
  const after=JSON.parse(readFileSync(join(dir,'games.json'),'utf8')).games[owner.code];
  const botDecisions={...after.decisions};delete botDecisions[owner.companyId];assert.equal(JSON.stringify(botDecisions),botsBefore);
  for(const rival of state.history.at(-1).results.filter(r=>r.companyId!==owner.companyId))for(const key of ['development','advertising','profit','iosPercent','fixedCost','resourcesBefore'])assert.ok(!(key in rival));
  assert.equal((await request(path+'/decision',data,owner.token)).status,409);
  assert.equal((await request(path+'/settle',{round},owner.token)).status,403);
  if(round<4){const next=await request(path+'/next',{round},owner.token);assert.equal(next.status,200);const value=await next.json();assert.equal(value.submitted,14);assert.equal(value.round,round+1);assert.equal(value.me.decision,null);}
  else assert.equal((await request(path+'/next',{round},owner.token)).status,409);
 }
 await new Promise(r=>server.close(r));await start();
 const restored=await (await request(path,undefined,owner.token)).json();assert.equal(restored.history.length,4);assert.equal(restored.phase,'finished');assert.equal(restored.rules.rounds,4);
 const secondPath=`/api/games/${other.code}`;
 const result=await (await request(secondPath+'/decision',{round:1,iosPercent:50,businessModel:'free',price:0,development:0,advertising:0},other.token)).json();assert.equal(result.phase,'finished');assert.equal(result.companies.length,3);
});
