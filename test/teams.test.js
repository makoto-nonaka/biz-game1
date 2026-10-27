import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.js';
import {normalizeTeamKey} from '../lib/teams.js';
test('キーは全角・大小文字・前後空白を正規化',()=>{assert.equal(normalizeTeamKey(' ａ７Ｋ３ｍｘ '),'A7K3MX');assert.equal(normalizeTeamKey(null),'');});
test('事前発行、複数端末、名前・下書き共有、締切、除外、代表者移動と旧モードの分離',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-teams-'));let server,base;
 async function start(){server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 await start();t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const request=(path,data,token)=>fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const call=async(path,data,token)=>{const r=await request(path,data,token);assert.ok(r.ok,await r.clone().text());return r.json();};
 for(const teamSlots of [0,31,'15',2.5,null])assert.equal((await request('/api/games',{title:'不正',teamSlots})).status,400);
 const admin=await call('/api/games',{title:'チーム授業',teamSlots:4,rounds:2}),path=`/api/games/${admin.code}`;
 let v=await call(path,undefined,admin.token);assert.equal(v.phase,'registration');assert.equal(v.teams.length,4);assert.equal(new Set(v.teams.map(t=>t.key)).size,4);assert.ok(v.teams.every(t=>/^[1-9][0-9]{5}$/.test(t.key)));
 assert.equal((await request(path+'/start',{},admin.token)).status,409);
 const [a,b,c,unused]=v.teams;
 const x=await call(path+'/join',{teamKey:' '+a.key.toLowerCase()+' '}),y=await call(path+'/join',{teamKey:a.key});
 const resume=await call(path+'/join',{teamKey:a.key,resumeToken:y.token});assert.equal(resume.token,y.token);
 let student=await call(path,undefined,x.token);assert.equal(student.me.memberCount,2);assert.equal(student.me.canEdit,false);assert.equal(student.me.registered,false);assert.ok(!('teams' in student));
 await call(path+'/name',{name:'あしたアプリ'},x.token);
 student=await call(path,undefined,y.token);assert.equal(student.me.name,'あしたアプリ');assert.equal(student.me.canEdit,false);
 assert.equal((await request(path+'/name',{name:'横取り'},y.token)).status,409);
 assert.equal((await request(path+'/start',{},x.token)).status,403);
 const z=await call(path+'/join',{teamKey:b.key}),e=await call(path+'/join',{teamKey:c.key});
 await call(path+'/name',{name:'みらいソフト'},z.token);await call(path+'/name',{name:'除外チーム'},e.token);
 await call(path+'/team-status',{companyId:c.id,excluded:true},admin.token);
 await call(path+'/teams',{count:1},admin.token);v=await call(path,undefined,admin.token);assert.equal(v.teams.length,5);
 assert.equal((await request(path+'/team-status',{companyId:a.id,excluded:true},y.token)).status,403);
 v=await call(path+'/start',{},admin.token);assert.equal(v.phase,'deciding');assert.equal(v.companies.length,2);assert.equal(v.teams.filter(t=>t.active).length,2);
 assert.equal((await request(path+'/join',{teamKey:unused.key})).status,403);
 assert.equal((await request(path+'/join',{teamKey:c.key})).status,403);
 const late=await call(path+'/join',{teamKey:a.key});assert.ok(late.token);
 assert.equal((await request(path+'/teams',{count:1},admin.token)).status,409);
 const d={round:1,revision:0,iosPercent:40,businessModel:'freemium',price:500,development:500000,advertising:0};
 assert.equal((await request(path+'/draft',d,y.token)).status,403);await call(path+'/draft',d,x.token);
 student=await call(path,undefined,y.token);assert.equal(student.me.draft.iosPercent,40);assert.equal(student.me.draftRevision,1);
 assert.equal((await call(path,undefined,z.token)).me.draft,null);
 assert.equal((await request(path+'/decision',d,x.token)).status,409);
 await call(path+'/leader',{companyId:a.id,memberId:student.me.memberId},admin.token);
 assert.equal((await request(path+'/decision',{...d,revision:1},x.token)).status,403);
 await call(path+'/decision',{...d,revision:1},y.token);await call(path+'/decision',d,z.token);
 v=await call(path+'/settle',{round:1},admin.token);assert.equal(v.history[0].marketPool,6000);assert.equal(v.history[0].results.length,2);assert.equal(v.history[0].results.reduce((s,r)=>s+r.customers,0),12000);
 student=await call(path,undefined,y.token);const rival=student.history[0].results.find(r=>r.companyId===b.id);assert.ok(!('development' in rival));assert.ok(!('drafts' in student));assert.ok(!JSON.stringify(student).includes(a.key));
 assert.equal((await request(path+'/team-keys',undefined,y.token)).status,403);const csv=await (await request(path+'/team-keys',undefined,admin.token)).text();assert.ok(csv.includes(a.key));assert.ok(!csv.includes(x.token));
 await call(path+'/next',{round:1},admin.token);assert.equal((await call(path,undefined,y.token)).me.draftRevision,0);
 await new Promise(r=>server.close(r));await start();assert.equal((await call(path,undefined,y.token)).me.canEdit,true);
 for(const player of [y,z])await call(path+'/decision',{...d,round:2},player.token);
 v=await call(path+'/settle',{round:2},admin.token);assert.equal(v.phase,'finished');assert.equal(v.history.length,2);
});
test('30チーム×3端末でも30社分の市場として計算し、同時の名前登録は1人だけが成功',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-team-capacity-')),server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const req=(path,data,token)=>fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const admin=await (await req('/api/games',{title:'30チーム',teamSlots:30,rounds:1})).json(),path=`/api/games/${admin.code}`;
 const slots=(await (await req(path,undefined,admin.token)).json()).teams,leaders=[];
 for(const [i,s]of slots.entries()){
  const members=[];for(let n=0;n<3;n++)members.push(await (await req(path+'/join',{teamKey:s.key.toLowerCase()})).json());
  if(i===0){
   const attempts=await Promise.all([req(path+'/name',{name:'先着チーム'},members[0].token),req(path+'/name',{name:'もう一人の案'},members[1].token)]);
   assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);leaders.push(members[attempts[0].status===200?0:1]);
  }else{assert.equal((await req(path+'/name',{name:`チーム${i}`},members[0].token)).status,200);leaders.push(members[0]);}
 }
 let v=await (await req(path,undefined,admin.token)).json();assert.equal(v.teams.reduce((s,t)=>s+t.members.length,0),90);assert.equal(v.companies.length,30);
 assert.equal((await req(path+'/teams',{count:1},admin.token)).status,400);
 await req(path+'/start',{},admin.token);
 for(const lead of leaders)assert.equal((await req(path+'/decision',{round:1,revision:0,iosPercent:50,businessModel:'paid',price:500,development:500000,advertising:0},lead.token)).status,200);
 v=await (await req(path+'/settle',{round:1},admin.token)).json();assert.equal(v.phase,'finished');assert.equal(v.history[0].marketPool,90000);assert.equal(v.history[0].results.reduce((s,r)=>s+r.customers,0),180000);
});
