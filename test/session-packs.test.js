import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
test('2セッションのプレ・本番を事前発行し、共通チームキー・独立状態・運営キー再開・印刷を保持',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-packs-'));let server,base;
 async function start(){server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 await start();t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const req=(path,data,token)=>fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const call=async(path,data,token)=>{const r=await req(path,data,token);assert.ok(r.ok,await r.clone().text());return r.json();};
 for(const b of [{teamSlots:31},{mainRounds:0},{sessionCount:3}])assert.equal((await req('/api/session-packs',{title:'講義',teamSlots:20,mainRounds:3,sessionCount:2,...b})).status,400);
 const {packs}=await call('/api/session-packs',{title:'模擬講義',teamSlots:20,mainRounds:3,sessionCount:2});assert.equal(packs.length,2);assert.equal(new Set(packs.flatMap(p=>p.games.map(g=>g.code))).size,4);assert.notEqual(packs[0].managementKey,packs[1].managementKey);
 const pack=packs[0],pre=pack.games[0],main=pack.games[1],path=`/api/games/${pre.code}`;
 const a=await call(path,undefined,pre.token),b=await call(`/api/games/${main.code}`,undefined,main.token);assert.deepEqual(a.teams.map(t=>t.key),b.teams.map(t=>t.key));assert.equal(a.rules.rounds,1);assert.equal(b.rules.rounds,3);
 const q=await call(path+'/join',{teamKey:a.teams[0].key});await call(path+'/name',{name:'同じチーム'},q.token);
 const student=await call(path,undefined,q.token);assert.ok(!('pack' in student));assert.ok(!JSON.stringify(student).includes(pack.managementKey));
 assert.equal((await req('/api/session-packs/open',{managementKey:'wrong'})).status,401);
 const reopened=await call('/api/session-packs/open',{managementKey:pack.managementKey.toLowerCase().match(/.{1,4}/g).join('-')});assert.deepEqual(reopened,pack);
 await call(path+'/teams',{count:1},pre.token);const a2=await call(path,undefined,pre.token),b2=await call(`/api/games/${main.code}`,undefined,main.token);assert.equal(a2.teams.length,21);assert.deepEqual(a2.teams.map(t=>t.key),b2.teams.map(t=>t.key));
 await call(path+'/start',{},pre.token);assert.equal((await req(`/api/games/${main.code}/teams`,{count:1},main.token)).status,409);
 await call(path+'/decision',{round:1,revision:0,iosPercent:50,businessModel:'paid',price:500,development:0,advertising:0},q.token);await call(path+'/settle',{round:1},pre.token);
 const untouched=await call(`/api/games/${main.code}`,undefined,main.token);assert.equal(untouched.history.length,0);assert.equal(untouched.phase,'registration');assert.equal(untouched.teams[0].members.length,0);
 const other=packs[1].games[0];assert.equal((await req(path,undefined,other.token)).status,401);
 for(const file of ['/tickets.html','/tickets.js','/tickets.css'])assert.equal((await req(file)).status,200);
 const source=readFileSync(new URL('../public/tickets.js',import.meta.url),'utf8');assert.ok(source.includes("if(admin)"));
 await new Promise(r=>server.close(r));await start();assert.deepEqual(await call('/api/session-packs/open',{managementKey:pack.managementKey}),pack);
});
