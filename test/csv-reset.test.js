import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {parseCsv,parseTeamCsv} from '../public/team-csv.js';
test('CSVはBOM・引用符・改行・全角数字を扱い、不正・重複・複数ゲームを拒否',()=>{
 const csv='\uFEFF"参加コード","チームキー","チーム名"\r\n"456","１２３２３４","A,社"\r\n"456","456567","B""社"\r\n';
 assert.deepEqual(parseTeamCsv(csv),{code:'456',teams:[{key:'123234',name:'A,社',excluded:false},{key:'456567',name:'B"社',excluded:false}]});
 assert.equal(parseTeamCsv('ゲーム番号,チームキー\n1,123234').code,'001');assert.equal(parseCsv('a,b\n"x\ny",z')[1][0],'x\ny');
 for(const csv of ['x,y\na,b','参加コード,チームキー\n456,123456\n456,123456','参加コード,チームキー\n456,abcdef\n457,XYZ123','参加コード,チームキー\n456,abcd','a,b\n"x','a,b\n"x"c'])assert.throws(()=>parseTeamCsv(csv));
});
test('CSVから番号・キー・名前を復元。既存ゲームは管理権限なしで取得・上書きしない',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-csv-')),server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
 const req=(path,data,token)=>fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const csv='参加コード,チームキー,チーム名,対象\n456,123234,会社A,参加枠\n456,456567,会社B,除外';
 let r=await req('/api/games/import',{csv,rounds:3,title:'復元'});assert.equal(r.status,201);const admin=await r.json();assert.equal(admin.code,'456');
 const path='/api/games/456',view=await (await req(path,null,admin.token)).json();assert.equal(view.teams[0].key,'123234');assert.equal(view.teams[1].excluded,true);
 const player=await (await req(path+'/join',{teamKey:'123234'})).json(),mine=await (await req(path,null,player.token)).json();assert.equal(mine.me.canEdit,true);assert.equal(mine.me.name,'会社A');
 assert.equal((await req('/api/games/import',{csv},player.token)).status,409);assert.equal((await req('/api/games/import',{csv})).status,409);
 assert.equal((await req('/api/games/import',{csv:csv.replace('123234','999999')},admin.token)).status,409);
 assert.equal((await req('/api/games/import',{csv},admin.token)).status,200);assert.equal((await (await req(path,null,player.token)).json()).me.memberId,mine.me.memberId);
 const exported=await (await req(path+'/team-keys',null,admin.token)).text();assert.deepEqual(parseTeamCsv(exported).teams.map(t=>t.key),['123234','456567']);
});
test('リセットは名前・キー・端末・代表者を保ち、成績・開発経験・選択を初期化。古い送信を拒否',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-reset-'));let server,base;
 async function start(){server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 await start();t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const req=(path,data,token)=>fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const call=async(path,data,token)=>{const r=await req(path,data,token);assert.ok(r.ok,await r.clone().text());return r.json();};
 const admin=await call('/api/games/import',{csv:'参加コード,チームキー,チーム名\n777,123234,アプリA\n777,456567,アプリB',rounds:1}),path='/api/games/777';
 const a=await call(path+'/join',{teamKey:'123234'}),viewer=await call(path+'/join',{teamKey:'123234'}),b=await call(path+'/join',{teamKey:'456567'});
 assert.equal((await req(path+'/reset',{runVersion:0,rounds:3},admin.token)).status,409);
 await call(path+'/start',{},admin.token);
 const d={round:1,revision:0,runVersion:0,iosPercent:0,businessModel:'paid',price:500,development:1000000,advertising:500000};
 for(const p of [a,b])await call(path+'/decision',d,p.token);const before=await call(path+'/settle',{round:1},admin.token);assert.equal(before.phase,'finished');assert.ok(before.history[0].results[0].resourcesAfter.android>0);
 assert.equal((await req(path+'/reset',{runVersion:0,rounds:3},viewer.token)).status,403);
 const reset=await call(path+'/reset',{runVersion:0,rounds:3},admin.token);assert.equal(reset.phase,'deciding');assert.equal(reset.round,1);assert.equal(reset.rules.rounds,3);assert.equal(reset.runVersion,1);assert.deepEqual(reset.history,[]);assert.ok(reset.ranking.every(r=>r.profit===0));assert.equal(reset.resetArchives.length,1);
 for(const p of [a,viewer,b]){const mine=await call(path,null,p.token);assert.equal(mine.me.decision,null);assert.equal(mine.me.draft,null);assert.equal(mine.me.draftRevision,0);assert.ok(!('resetArchives' in mine));assert.ok(mine.me.registered);}
 assert.equal((await call(path,null,a.token)).me.canEdit,true);assert.equal((await call(path,null,viewer.token)).me.canEdit,false);
 assert.equal((await req(path+'/decision',d,a.token)).status,409);assert.equal((await req(path+'/draft',d,a.token)).status,409);assert.equal((await req(path+'/settle',{round:1},admin.token)).status,409);
 const old=await (await req(path+'/export?format=csv&archive=0',null,admin.token)).text();assert.ok(old.includes(String(before.history[0].results[0].profit)));assert.equal((await req(path+'/export?archive=9',null,admin.token)).status,404);
 for(const p of [a,b])await call(path+'/decision',{...d,runVersion:1,iosPercent:100},p.token);
 const after=await call(path+'/settle',{round:1,runVersion:1},admin.token);assert.deepEqual(after.history[0].results[0].resourcesBefore,{android:0,ios:0});assert.equal(after.history[0].results[0].switchingCost,0);assert.equal(after.phase,'results');
 assert.deepEqual(after.teams.map(t=>[t.key,t.name,t.leaderId]),before.teams.map(t=>[t.key,t.name,t.leaderId]));
 await new Promise(r=>server.close(r));await start();const resumed=await call(path,null,a.token);assert.equal(resumed.runVersion,1);assert.equal(resumed.history.length,1);
});
