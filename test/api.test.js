import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

test('30社・3ラウンドの授業、権限・二重送信・永続化', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'startup-test-'));
  let server, base;
  async function start() {
    server = createApp({ dataDir: dir, allowedOrigins: 'https://class.example' });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function request(path, {data, token, origin} = {}) {
    const response = await fetch(base + path, {method: data ? 'POST' : 'GET', headers: {
      ...(data ? {'Content-Type':'application/json'} : {}), ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(origin ? {Origin:origin} : {})
    }, ...(data ? {body:JSON.stringify(data)} : {})});
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  await start();
  t.after(async () => { await new Promise(r => server.close(r)); rmSync(dir, { recursive:true, force:true }); });
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/games', {data:{title:''}})).status, 400);
  const created = await request('/api/games', {data:{title:'動作テスト授業',rounds:3}});
  assert.equal(created.status, 201);
  const {code, token: teacher} = created.body;
  assert.match(code,/^[1-9][0-9]{2}$/);
  const path = `/api/games/${code}`;
  assert.equal((await request('/api/games/000/join', {data:{name:'x'}})).status, 404);
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, {token:teacher, origin:'https://evil.example'})).status, 403);
  const allowed = await request(path, {token:teacher, origin:'https://class.example'});
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://class.example');
  assert.equal((await request(path+'/settle', {token:teacher,data:{round:1}})).status, 409);
  const players = await Promise.all(Array.from({length:30}, async (_,i) => {
    const r = await request(path+'/join', {data:{name:`会社${i+1}`}});
    assert.equal(r.status, 201); return r.body;
  }));
  assert.equal((await request(path+'/join', {data:{name:'31社目'}})).status, 409);
  assert.equal((await request(path+'/settle', {token:players[0].token,data:{round:1}})).status, 403);
  assert.equal((await request(path+'/decision', {token:players[0].token,data:{round:1,market:'ios',price:1,development:0,advertising:0}})).status, 400);
  for(const bad of [{iosPercent:-1},{iosPercent:101},{iosPercent:50.1},{businessModel:'other'},{businessModel:'free',price:500}]) {
    assert.equal((await request(path+'/decision',{token:players[0].token,data:{round:1,iosPercent:50,businessModel:'paid',price:500,development:0,advertising:0,...bad}})).status,400);
  }
  const initial = await request(path,{token:teacher});
  assert.equal(initial.body.companies.length,30);
  assert.ok(!JSON.stringify(initial.body).includes(players[0].token));
  for (let round=1; round<=3; round++) {
    const businessModel=['paid','freemium','free'][round-1];
    const data = {round,iosPercent:50,businessModel,price:businessModel==='free'?0:500,development:500000,advertising:500000};
    assert.equal((await request(path+'/decision', {token:players[0].token,data})).status, 200);
    assert.equal((await request(path+'/decision', {token:players[0].token,data})).status, 409);
    assert.equal((await request(path+'/settle', {token:teacher,data:{round}})).status, 409);
    const privateView = (await request(path,{token:players[1].token})).body;
    assert.equal(privateView.me.decision,null);
    assert.equal(privateView.companies.filter(c=>c.submitted).length,1);
    assert.ok(!('decision' in privateView.companies[0]));
    assert.equal(privateView.history.length,round-1);
    await Promise.all(players.slice(1).map(async (player,i) => {
      const r = await request(path+'/decision', {token:player.token,data:{...data,iosPercent:(i*7)%101,businessModel:['free','freemium','paid'][(i+round)%3],price:(i+round)%3===0?0:[300,500,700][i%3],development:[0,500000,1000000][(i+round)%3]}});
      assert.equal(r.status,200);
    }));
    const double = await Promise.all([1,2].map(() => request(path+'/settle',{token:teacher,data:{round}})));
    assert.deepEqual(double.map(r=>r.status).sort(),[200,409]);
    const result = double.find(r=>r.status===200).body;
    assert.equal(result.history.length,round);
    assert.equal(result.rules.version,5);
    assert.equal(result.history.at(-1).modelVersion,5);
    if(round>1)assert.deepEqual(result.history.at(-1).results[0].resourcesBefore,result.history.at(-2).results[0].resourcesAfter);
    assert.equal(result.history.at(-1).results.length,30);
    assert.equal(result.history.at(-1).results.reduce((s,r)=>s+r.customers,0),180000);
    assert.equal(result.ranking.reduce((s,r)=>s+r.profit,0),result.history.reduce((s,h)=>s+h.results.reduce((sum,r)=>sum+r.profit,0),0));
    const individual = (await request(path,{token:players[0].token})).body;
    assert.equal(individual.me.id,players[0].companyId);
    assert.ok(individual.history.at(-1).results.some(r=>r.companyId===individual.me.id));
    const mine=individual.history.at(-1).results.find(r=>r.companyId===individual.me.id);
    assert.equal(mine.businessModel,businessModel);
    assert.equal(mine.revenue,mine.paymentRevenue+mine.adRevenue);
    assert.ok(!('segments' in mine.markets.android));
    assert.ok(!('resourcesBefore' in mine));
    assert.ok(!('segments' in individual.rules));
    assert.ok(!('productivityGain' in individual.rules));
    assert.ok(result.history.at(-1).results.every(r=>'resourcesAfter' in r));
    assert.equal(result.companies.filter(c=>c.submitted).length,30);
    assert.equal(mine.customers,mine.markets.android.customers+mine.markets.ios.customers);
    assert.equal(mine.revenue,mine.customers*(businessModel==='free'?300:businessModel==='freemium'?360:500));
    assert.equal((await request(path+'/decision', {token:players[1].token,data})).status,409);
    assert.equal((await request(path+'/join',{data:{name:'途中参加'}})).status,409);
    if(round<3) {
      assert.equal((await request(path+'/next',{token:players[0].token,data:{round}})).status,403);
      const advanced = await request(path+'/next',{token:teacher,data:{round}});
      assert.equal(advanced.body.round,round+1);
      assert.equal(advanced.body.submitted,0);
      assert.equal((await request(path+'/decision',{token:players[0].token,data})).status,409);
      assert.equal((await request(path+'/next',{token:teacher,data:{round}})).status,409);
    } else {
      assert.equal(result.phase,'finished');
      assert.equal((await request(path+'/next',{token:teacher,data:{round}})).status,409);
    }
  }
  await new Promise(r => server.close(r));
  await start();
  const restored = (await request(path,{token:teacher})).body;
  assert.equal(restored.history.length,3);
  assert.equal(restored.phase,'finished');
  assert.equal(restored.companies.length,30);
  assert.equal((await request(path,{token:players[0].token})).body.me.id,players[0].companyId);
  assert.equal(JSON.parse(readFileSync(join(dir,'games.json'),'utf8')).games[code].round,3);
});

test('同名登録・不正入力・ゲーム間の権限を検証', async t => {
  const dir=mkdtempSync(join(tmpdir(),'startup-validation-'));
  const server=createApp({dataDir:dir});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{
    const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    return {status:r.status,body:await r.json()};
  };
  const one=(await post('/api/games',{title:'授業1'})).body;
  const two=(await post('/api/games',{title:'授業2'})).body;
  assert.notEqual(one.code,two.code);
  const path=`/api/games/${one.code}/join`;
  assert.equal((await post(path,{name:' Ａ社 '})).status,201);
  assert.equal((await post(path,{name:'A社'})).status,409);
  assert.equal((await post(path,{name:' '})).status,400);
  assert.equal((await post(path,{name:'あ'.repeat(25)})).status,400);
  assert.equal((await fetch(base+`/api/games/${one.code}`,{headers:{Authorization:`Bearer ${two.token}`}})).status,401);
  const invalid=await fetch(base+'/api/games',{method:'POST',body:'{'});
  assert.equal(invalid.status,400);
  for (const invalidValue of ['null', '[]', '3']) {
    assert.equal((await fetch(base+'/api/games',{method:'POST',body:invalidValue})).status,400);
  }
  const large=await fetch(base+'/api/games',{method:'POST',body:JSON.stringify({title:'x'.repeat(10000)})});
  assert.equal(large.status,413);
});


test('3桁コードの残り1つを選び、全900個使用済みなら終了する', async t=>{
 const dir=mkdtempSync(join(tmpdir(),'startup-code-'));
 const games=Object.fromEntries(Array.from({length:899},(_,i)=>[String(i+100),{}]));
 writeFileSync(join(dir,'games.json'),JSON.stringify({games}));
 const server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const create=()=>fetch(`http://127.0.0.1:${server.address().port}/api/games`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'最後のコード'})});
 const last=await create();assert.equal(last.status,201);assert.equal((await last.json()).code,'999');
 const full=await create();assert.equal(full.status,409);assert.match((await full.json()).error,/すべて使用中/);
});

test('6桁コードの既存ゲームは旧ルールで集計を維持する',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'startup-legacy-'));
 const decision={iosPercent:50,businessModel:'freemium',price:500,development:500000,advertising:500000};
 const g={code:'123456',title:'旧授業',teacherToken:'teacher-old',round:1,phase:'deciding',companies:[{id:'a',name:'A',token:'a-old'},{id:'b',name:'B',token:'b-old'}],decisions:{a:decision,b:decision},history:[]};
 writeFileSync(join(dir,'games.json'),JSON.stringify({games:{'123456':g}}));
 const server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api/games/123456`;
 const response=await fetch(base+'/settle',{method:'POST',headers:{Authorization:'Bearer teacher-old','Content-Type':'application/json'},body:JSON.stringify({round:1})});
 assert.equal(response.status,200);const view=await response.json();assert.equal(view.rules.version,2);
 assert.equal(view.history[0].results[0].revenue,1200000);assert.equal(view.history[0].results[0].profit,-900000);
});

test('入口HTMLを分離し、学生用にルール本文を配信しない',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'startup-entry-')),server=createApp({dataDir:dir});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/','/index.html','/student.html','/play']){
  const r=await fetch(base+path),html=await r.text();assert.equal(r.status,200);
  assert.ok(html.includes('data-entry="student"'));assert.ok(!html.includes('id="rules"'));assert.ok(!html.includes('ゲームのルール'));
 }
 for(const path of ['/admin.html','/teacher']){
  const r=await fetch(base+path),html=await r.text();assert.equal(r.status,200);
  assert.ok(html.includes('data-entry="teacher"'));assert.ok(html.includes('id="rules"'));assert.ok(html.includes('開発資源'));
 }
});

test('既存v0.3ゲームは蓄積・移行費用を追加せず維持する',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'startup-v3-'));
 const previous={companyId:'a',name:'A',iosPercent:0,businessModel:'paid',price:500,development:1000000,advertising:0,profit:0};
 const g={code:'432',title:'v3',teacherToken:'teacher-v3',modelVersion:3,round:2,phase:'deciding',companies:[{id:'a',name:'A',token:'a'}],decisions:{a:{...previous,iosPercent:100,development:500000}},history:[{round:1,results:[previous]}]};
 writeFileSync(join(dir,'games.json'),JSON.stringify({games:{432:g}}));
 const server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api/games/432/settle`,{method:'POST',headers:{Authorization:'Bearer teacher-v3','Content-Type':'application/json'},body:JSON.stringify({round:2})});
 assert.equal(r.status,200);const v=await r.json();assert.equal(v.rules.version,3);assert.ok(!('resourcesAfter' in v.history.at(-1).results[0]));assert.equal(v.history.at(-1).results[0].fixedCost,1000000);
});

test('他社の経営情報はAPIでも非開示、自社と教員は詳細を確認できる',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'startup-disclosure-'));
 const server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,data,token){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});assert.ok(r.ok);return r.json();}
 const teacher=await call('/api/games',{title:'開示確認'}),path=`/api/games/${teacher.code}`;
 const a=await call(path+'/join',{name:'A'}),b=await call(path+'/join',{name:'B'});
 await call(path+'/decision',{round:1,iosPercent:25,businessModel:'paid',price:500,development:1000000,advertising:500000},a.token);
 await call(path+'/decision',{round:1,iosPercent:70,businessModel:'freemium',price:700,development:0,advertising:1000000},b.token);
 const admin=await call(path+'/settle',{round:1},teacher.token);
 const expectedKeys=['businessModel','companyId','customers','markets','name','price','revenue'].sort();
 for(const [student,other]of [[a,b],[b,a]]){
  const view=await call(path,undefined,student.token),rows=view.history[0].results;
  const own=rows.find(r=>r.companyId===student.companyId),rival=rows.find(r=>r.companyId===other.companyId);
  assert.deepEqual(Object.keys(rival).sort(),expectedKeys);
  for(const m of ['android','ios'])assert.deepEqual(Object.keys(rival.markets[m]),['customers']);
  assert.equal(rival.customers,rival.markets.android.customers+rival.markets.ios.customers);
  assert.equal(rival.revenue,admin.history[0].results.find(r=>r.companyId===other.companyId).revenue);
  for(const k of ['iosPercent','development','advertising','switchingCost','fixedCost','variableCost','cost','profit','breakEven','revenuePerCustomer','adRevenue','paymentRevenue','resourcesBefore','resourcesAfter'])assert.ok(!(k in rival),k);
  for(const k of ['iosPercent','development','advertising','switchingCost','fixedCost','variableCost','cost','profit','breakEven','revenue'])assert.ok(k in own,k);
  assert.ok(!('resourcesBefore' in own));assert.ok(!('segments' in own.markets.android));
  assert.equal(view.ranking.length,2);assert.ok(view.ranking.every(r=>'profit' in r));
 }
 assert.ok(admin.history[0].results.every(r=>'resourcesBefore' in r&&'iosPercent' in r&&'breakEven' in r));
 // レスポンス整形が保存データを削っていないことも確認。
 const again=await call(path,undefined,teacher.token);
 assert.deepEqual(again.history,admin.history);
});

test('保存済みv0.4は再起動後も40%・400円・基本費50万円を維持',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'startup-v4-compat-'));
 let server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,data,token)=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});assert.ok(r.ok);return r.json();};
 const teacher=await call('/api/games',{title:'旧版維持'}),path=`/api/games/${teacher.code}`;const player=await call(path+'/join',{name:'旧版会社'});
 await new Promise(r=>server.close(r));
 const filename=join(dir,'games.json'),saved=JSON.parse(readFileSync(filename,'utf8'));saved.games[teacher.code].modelVersion=4;writeFileSync(filename,JSON.stringify(saved));
 server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const d={round:1,iosPercent:50,businessModel:'freemium',price:500,development:500000,advertising:500000};await call(path+'/decision',d,player.token);
 const result=await call(path+'/settle',{round:1},teacher.token);assert.equal(result.rules.version,4);assert.equal(result.rules.freeRevenue,400);assert.equal(result.rules.conversionRate,.4);assert.equal(result.history[0].results[0].revenue,2640000);assert.equal(result.history[0].results[0].fixedCost,1500000);
});
