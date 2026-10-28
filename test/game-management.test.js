import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';

async function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'smartapps-management-'));let server,base;
 const start=async()=>{server=createApp({dataDir:dir,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;};
 await start();t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const req=(path,data,token)=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const call=async(path,data,token)=>{const r=await req(path,data,token);assert.ok(r.ok,await r.clone().text());return r.json();};
 return {req,call,restart:async()=>{await new Promise(r=>server.close(r));await start();}};
}
const csv='参加コード,チームキー,チーム名\n123,123456,アプリA\n123,654321,アプリB';

test('ゲーム一覧は運営権限ごとに限定し、別PCは専用パスワードで全ゲームを開ける',async t=>{
 const {req,call}=await fixture(t,{adminPassword:'test-only-administration-password'});
 const a=await call('/api/games/import',{csv});const b=await call('/api/games',{title:'別ゲーム',teamSlots:2});
 const player=await call('/api/games/123/join',{teamKey:'123456'});
 for(const token of [undefined,player.token])assert.equal((await call('/api/admin/games/list',{},token)).games.length,0);
 const owned=await call('/api/admin/games/list',{tokens:[a.token]});assert.deepEqual(owned.games.map(g=>g.code),['123']);
 assert.ok(!JSON.stringify(owned).includes(a.token));assert.ok(!JSON.stringify(owned).includes('123456'));assert.ok(!JSON.stringify(owned).includes(b.token));
 assert.equal((await req('/api/admin/session',{password:'wrong'})).status,401);
 const admin=await call('/api/admin/session',{password:'test-only-administration-password'});
 const list=await call('/api/admin/games/list',{},admin.token);assert.equal(list.allGames,true);assert.equal(list.games.length,2);
 const item=list.games.find(g=>g.code==='123');
 assert.equal((await req('/api/admin/games/123/open',{instanceId:item.instanceId},player.token)).status,403);
 assert.equal((await call('/api/admin/games/123/open',{instanceId:item.instanceId},admin.token)).token,a.token);
 assert.equal((await call('/api/games/import',{csv},admin.token)).restoredExisting,true);
 await call('/api/admin/session/end',{},admin.token);assert.equal((await call('/api/admin/games/list',{},admin.token)).games.length,0);
 assert.equal((await req('/api/admin/games/123/archive',{confirmCode:'123',instanceId:item.instanceId},admin.token)).status,403);
});

test('無効化で番号を解放し、印刷済み番号・キーのCSVで新規ゲームを復元。旧端末と旧管理権限は無効',async t=>{
 const {req,call,restart}=await fixture(t);
 assert.equal((await req('/api/admin/session',{password:'unused'})).status,503);
 const a=await call('/api/games/import',{csv}),player=await call('/api/games/123/join',{teamKey:'123456'});
 await call('/api/games/123/start',{},a.token);
 await call('/api/games/123/decision',{round:1,revision:0,iosPercent:50,businessModel:'paid',price:500,development:500000,advertising:500000},player.token);
 await call('/api/games/123/settle',{round:1},a.token);
 const list=await call('/api/admin/games/list',{tokens:[a.token]}),item=list.games[0];
 assert.equal((await req('/api/admin/games/123/archive',{confirmCode:'999',instanceId:item.instanceId},a.token)).status,400);
 assert.equal((await req('/api/admin/games/123/archive',{confirmCode:'123',instanceId:'stale'},a.token)).status,409);
 const archived=await call('/api/admin/games/123/archive',{confirmCode:'123',instanceId:item.instanceId},a.token);
 assert.equal((await req('/api/games/123',undefined,a.token)).status,404);
 assert.equal((await req('/api/games/123/join',{teamKey:'123456'})).status,404);
 await restart();
 let state=await call('/api/admin/games/list',{tokens:[a.token]});assert.equal(state.games.length,0);assert.equal(state.archives.length,1);
 const fresh=await call('/api/games/import',{csv,rounds:4});assert.equal(fresh.code,'123');assert.notEqual(fresh.token,a.token);
 const view=await call('/api/games/123',undefined,fresh.token);assert.equal(view.history.length,0);assert.equal(view.phase,'registration');assert.equal(view.rules.rounds,4);assert.deepEqual(view.teams.map(t=>t.key),['123456','654321']);
 assert.equal((await req('/api/games/123',undefined,player.token)).status,401);
 assert.equal((await req('/api/games/123',undefined,a.token)).status,401);
 assert.equal((await req('/api/admin/games/123/archive',{confirmCode:'123',instanceId:item.instanceId},a.token)).status,403);
 assert.equal((await req('/api/admin/games/123/restore',{archiveId:archived.archiveId,confirmCode:'123',instanceId:item.instanceId},a.token)).status,409);
 const rejoined=await call('/api/games/123/join',{teamKey:'123456'});assert.notEqual(rejoined.token,player.token);
 const newer=(await call('/api/admin/games/list',{},fresh.token)).games[0];
 await call('/api/admin/games/123/archive',{confirmCode:'123',instanceId:newer.instanceId},fresh.token);
 const restored=await call('/api/admin/games/123/restore',{archiveId:archived.archiveId,confirmCode:'123',instanceId:item.instanceId},a.token);
 assert.equal(restored.token,a.token);assert.equal((await call('/api/games/123',undefined,player.token)).history.length,1);
});

test('専用パスワードの連続不一致を制限し、無効化前の画面では再発行後の同番号を消せない',async t=>{
 const {req,call}=await fixture(t,{adminPassword:'test-management'});
 for(let i=0;i<10;i++)assert.equal((await req('/api/admin/session',{password:'wrong'})).status,401);
 assert.equal((await req('/api/admin/session',{password:'test-management'})).status,429);
 const a=await call('/api/games/import',{csv});const first=(await call('/api/admin/games/list',{},a.token)).games[0];
 await call('/api/admin/games/123/archive',{confirmCode:'123',instanceId:first.instanceId},a.token);
 const b=await call('/api/games/import',{csv});
 assert.equal((await req('/api/admin/games/123/archive',{confirmCode:'123',instanceId:first.instanceId},b.token)).status,409);
 assert.equal((await call('/api/games/123',undefined,b.token)).phase,'registration');
});
