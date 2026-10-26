import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
test('解説・CSV/TXT出力は管理者専用。集計前後と再起動後の既存履歴に対応',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'smartapps-export-'));let server,base;
 async function start(){server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 await start();t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const request=(path,token,data)=>fetch(base+path,{method:data?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const teacher=await (await request('/api/games',null,{title:'分析テスト'})).json(),path=`/api/games/${teacher.code}`;
 const a=await (await request(path+'/join',null,{name:'会社A'})).json(),b=await (await request(path+'/join',null,{name:'会社B'})).json();
 assert.equal((await request(path+'/export?format=csv')).status,401);assert.equal((await request(path+'/export?format=csv',a.token)).status,403);assert.equal((await request(path+'/export?format=txt',a.token)).status,403);assert.equal((await request(path+'/export?format=json',teacher.token)).status,400);
 const initial=await (await request(path,teacher.token)).json();assert.deepEqual(initial.analysis,[]);
 assert.ok((await (await request(path+'/export?format=csv',teacher.token)).text()).includes('未確定'));
 for(const [i,player]of [a,b].entries())await request(path+'/decision',player.token,{round:1,iosPercent:[20,80][i],businessModel:['paid','freemium'][i],price:[500,700][i],development:i*500000,advertising:500000});
 const settled=await (await request(path+'/settle',teacher.token,{round:1})).json();assert.equal(settled.analysis.length,1);assert.ok(settled.analysis[0].notes.length>=3);
 const student=await (await request(path,a.token)).json();assert.ok(!('analysis' in student));assert.ok(!JSON.stringify(student).includes('alternativeProfit'));
 const saved=readFileSync(join(dir,'games.json'),'utf8');
 const csv=await request(path+'/export?format=csv',teacher.token);assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(csv.headers.get('content-disposition'),/attachment/);
 const body=await csv.text();assert.ok(body.includes('当回利益_円'));for(const token of [teacher.token,a.token,b.token])assert.ok(!body.includes(token));
 assert.equal(readFileSync(join(dir,'games.json'),'utf8'),saved);
 assert.ok((await (await request(path+'/export?format=txt',teacher.token)).text()).includes('【ラウンド1】'));
 await new Promise(r=>server.close(r));await start();
 const restored=await (await request(path,teacher.token)).json();assert.deepEqual(restored.analysis,settled.analysis);
 assert.equal((await request(path+'/export?format=csv',teacher.token)).status,200);
});
