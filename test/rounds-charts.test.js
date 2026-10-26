import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.js';
import {breakEvenGeometry,breakEvenChart,cumulativeGeometry,cumulativeChart} from '../public/charts.js';
test('損益分岐点の交点、赤字条件、市場上限を超える交点',()=>{
 const values={fixedCost:1300000,unitRevenue:360,variableCost:100,reachable:12000};
 const g=breakEvenGeometry(values);assert.equal(g.threshold,5000);assert.equal(g.maxUsers,7500);
 assert.equal(values.unitRevenue*g.threshold,values.fixedCost+values.variableCost*g.threshold);
 const beyond=breakEvenGeometry({...values,reachable:3000});assert.ok(beyond.maxUsers>5000);
 assert.match(breakEvenChart({...values,reachable:3000}),/市場上限より先/);
 assert.equal(breakEvenGeometry({...values,unitRevenue:50}).threshold,null);
 assert.ok(!/NaN|Infinity/.test(breakEvenChart({...values,unitRevenue:50})));
});
test('累計グラフは降順・共通目盛り・正負左右・ゼロ・安全な会社名',()=>{
 const source=[{name:'赤字',profit:-200},{name:'<script>',profit:100},{name:'ゼロ',profit:0}];
 const g=cumulativeGeometry(source);assert.deepEqual(g.rows.map(r=>r.profit),[100,0,-200]);
 assert.equal(g.rows[0].start,150);assert.equal(g.rows[2].start,5);assert.equal(g.rows[0].width,g.rows[2].width/2);
 assert.equal(source[0].profit,-200);assert.match(cumulativeChart(source),/&lt;script&gt;/);
 for(const rows of [[],[{profit:0}],[{profit:-1}],[{profit:1}]])assert.ok(!/NaN|Infinity/.test(cumulativeChart(rows)));
});
test('1〜4ラウンド設定、終了制御、再起動、既存3回の互換、CSV設定値',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-rounds-'));let server,base;
 async function start(){server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 await start();t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 async function req(path,data,token){return fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});}
 for(const rounds of [0,5,1.5,'4',null])assert.equal((await req('/api/games',{title:'不正',rounds})).status,400);
 const games=[];
 for(const rounds of [1,2,3,4]){
  const admin=await (await req('/api/games',{title:`${rounds}回`,rounds})).json(),path=`/api/games/${admin.code}`;
  const player=await (await req(path+'/join',{name:'A'})).json();games.push({admin,path,rounds});
  for(let round=1;round<=rounds;round++){
   assert.equal((await (await req(path,undefined,player.token)).json()).rules.rounds,rounds);
   const decision={round,iosPercent:50,businessModel:'freemium',price:500,development:500000,advertising:0};
   assert.equal((await req(path+'/decision',decision,player.token)).status,200);
   const response=await req(path+'/settle',{round},admin.token);assert.equal(response.status,200);const result=await response.json();
   assert.equal(result.phase,round===rounds?'finished':'results');assert.equal(result.history.length,round);
   assert.equal((await req(path+'/next',{round},admin.token)).status,round===rounds?409:200);
  }
  const csv=await (await req(path+'/export?format=csv',undefined,admin.token)).text();assert.ok(csv.includes('設定ラウンド数'));assert.ok(csv.includes(`"rounds":${rounds}`.replaceAll('"','""')));
 }
 const old=await (await req('/api/games',{title:'既存相当'})).json();
 await new Promise(r=>server.close(r));
 const file=join(dir,'games.json'),saved=JSON.parse(readFileSync(file,'utf8'));delete saved.games[old.code].totalRounds;writeFileSync(file,JSON.stringify(saved));
 await start();
 for(const {admin,path,rounds}of games){const result=await (await req(path,undefined,admin.token)).json();assert.equal(result.rules.rounds,rounds);assert.equal(result.phase,'finished');}
 assert.equal((await (await req(`/api/games/${old.code}`,undefined,old.token)).json()).rules.rounds,3);
 assert.equal((await req('/charts.js')).status,200);
});
