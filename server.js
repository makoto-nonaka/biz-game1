import {parseTeamCsv} from './public/team-csv.js';
import {createSessionPacks,normalizeManagementKey} from './lib/session-packs.js';
import {addTeamSlots,joinTeam,teamForToken,registrationTeams} from './lib/teams.js';
import { computerDecisions } from './lib/computers.js';
import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createStore } from './lib/store.js';
import { analyzeGame, exportCsv, exportText } from './lib/analysis.js';
import { RULES as V3_RULES, settle as settleV3 } from './lib/model-v3.js';
import { RULES as OLD_RULES, settle as settleOld } from './lib/model-v2.js';
import { RULES as V4_RULES, settle as settleV4 } from './lib/model.js';
import { RULES, validDecision, settle, ranking, normalizeDecision } from './lib/model-v5.js';

const root = dirname(fileURLToPath(import.meta.url));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const token = () => randomBytes(32).toString('hex');

export function createApp({ dataDir = process.env.DATA_DIR || resolve(root, 'data'), allowedOrigins = process.env.ALLOWED_ORIGINS || '' } = {}) {
  const store = createStore(dataDir);
  const origins = allowedOrigins.split(',').map(s => s.trim()).filter(Boolean);
  const files = { '/': ['index.html', 'text/html'], '/teacher': ['admin.html', 'text/html'], '/admin.html': ['admin.html','text/html'], '/index.html': ['index.html','text/html'], '/student.html': ['student.html','text/html'],
    '/team-csv.js':['team-csv.js','text/javascript'], '/tickets.html':['tickets.html','text/html'], '/tickets.js':['tickets.js','text/javascript'], '/tickets.css':['tickets.css','text/css'], '/singleplay.html': ['singleplay.html','text/html'], '/play': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
    '/charts.js': ['charts.js', 'text/javascript'], '/rankings.js': ['rankings.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/config.js': ['config.js', 'text/javascript'],
    '/vendor/qrcode.js':['vendor/qrcode.js','text/javascript'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };

  function view(g, role, companyId, memberId) {
    const team=g.teamMode?g.teams.find(t=>t.id===companyId):null;
    const mine = team||g.companies.find(c => c.id === companyId);
    const companies=g.teamMode&&g.phase==='registration'?registrationTeams(g):g.companies;
    const modelRules=g.modelVersion===5?RULES:g.modelVersion===4?V4_RULES:g.modelVersion===3?V3_RULES:OLD_RULES;
    const rules={...modelRules,rounds:g.totalRounds??modelRules.rounds};
    const studentRules=Object.fromEntries(['version','rounds','customersPerCompany','baseCost','variableCost','freeRevenue','conversionRate','prices','investments','switchingCostPerFullShift'].filter(k=>rules[k]!==undefined).map(k=>[k,rules[k]]));
    const marketCounts=r=>Object.fromEntries(['android','ios'].map(m=>[m,{customers:r.markets?.[m]?.customers??(r.market===m?r.customers:0)}]));
    const history=role==='teacher'?g.history:g.history.map(h=>({...h,results:h.results.map(r=>{
      if(r.companyId!==companyId){
        // 他社は市場に表れた結果だけを返す。新規内部フィールドも漏れないよう許可リスト方式。
        return {companyId:r.companyId,name:r.name,businessModel:r.businessModel||'paid',price:r.price,
          customers:r.customers,revenue:r.revenue,markets:marketCounts(r)};
      }
      const {resourcesBefore,resourcesAfter,...visible}=r;
      visible.markets=marketCounts(r);
      return visible;
    })}));
    return { code: g.code, title: g.title, round: g.round, phase: g.phase, runVersion:g.runVersion??0, rules: role==='teacher'?rules:studentRules,
      companies: companies.map(c => ({ id: c.id, name: c.name, submitted: !!g.decisions[c.id] })),
      submitted: Object.keys(g.decisions).length,
      me: mine ? { id: mine.id, name: mine.name||'チーム名を登録してください', ...(team?{registered:!!team.name,canEdit:team.leaderId===memberId,memberId,memberLabel:`端末${team.members.findIndex(m=>m.id===memberId)+1}`,excluded:team.excluded,memberCount:team.members.length,draft:g.drafts?.[mine.id]?.decision??null,draftRevision:g.drafts?.[mine.id]?.revision??0}:{}), decision: g.decisions[mine.id] ? normalizeDecision(g.decisions[mine.id]) : null } : null,
      history, ranking: ranking(companies, g.history), role,
      ...(g.packKey&&role==='teacher'?{pack:{stage:g.stage,games:store.read().sessionPacks[g.packKey].games.map(({token,...v})=>v)}}:{}),
      ...(g.teamMode?{teamMode:true,...(role==='teacher'?{teams:g.teams.map(t=>({id:t.id,key:t.key,name:t.name,members:t.members.map((m,i)=>({id:m.id,label:`端末${i+1}`})),leaderId:t.leaderId,excluded:t.excluded,active:g.phase==='registration'?!!(t.name&&t.members.length&&!t.excluded):g.companies.some(c=>c.id===t.id)}))}:{})}:{}), ...(g.mode==='single'?{mode:'single'}:{}), ...(role==='teacher'?{analysis:analyzeGame(g),resetArchives:(g.resetArchives||[]).map((a,index)=>({index,at:a.at,rounds:a.snapshot.history.length}))}:{}) };
  }
  async function body(req,limit=8192) {
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (Buffer.byteLength(data) > limit) fail(413, '入力が長すぎます。');
    }
    try {
      const parsed = JSON.parse(data || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, '送信内容が不正です。');
      return parsed;
    } catch { fail(400, '送信内容が不正です。'); }
  }
  function textField(value, max, label) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max
      || /[\u0000-\u001f\u007f]/u.test(value)) fail(400, `${label}は1〜${max}文字で入力してください。`);
    return value.trim();
  }
  const server = createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      if (origin) {
        const sameOrigin = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
        if (!sameOrigin && !origins.includes(origin)) fail(403, 'このサイトからの接続は許可されていません。');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (url.pathname === '/api/health' && req.method === 'GET') return send(200, { ok: true });
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' || !files[url.pathname]) fail(404, 'ページが見つかりません。');
        const [file, mime] = files[url.pathname];
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
        res.end(readFileSync(resolve(root, 'public', file))); return;
      }
      if(url.pathname==='/api/games/import'&&req.method==='POST'){
        const b=await body(req,65536);let parsed;
        try{parsed=parseTeamCsv(b.csv);}catch(e){fail(400,e.message);}
        const existing=store.read().games[parsed.code];
        if(existing){
          if(req.headers.authorization!==`Bearer ${existing.teacherToken}`)fail(409,'このゲーム番号は使用中です。該当ゲームの運営画面から読み込んでください。CSVだけで運営権限を取得することはできません。');
          if(!existing.teamMode||existing.teams.length!==parsed.teams.length||existing.teams.some(t=>!parsed.teams.some(p=>p.key===t.key)))fail(409,'既存ゲームのチームキーと一致しません。現在のゲームは変更していません。');
          return send(200,{code:existing.code,token:existing.teacherToken,role:'teacher',restoredExisting:true});
        }
        const title=textField(b.title||`CSVから復元 ${parsed.code}`,40,'ゲーム名'),rounds=b.rounds??4;
        if(!Number.isInteger(rounds)||rounds<1||rounds>4)fail(400,'ラウンド回数は1〜4を指定してください。');
        const result=store.transaction(state=>{
          const teacherToken=token(),g={code:parsed.code,title,teacherToken,modelVersion:5,totalRounds:rounds,round:1,phase:'registration',runVersion:0,companies:[],decisions:{},history:[],teams:[],drafts:{},teamMode:true,createdAt:new Date().toISOString()};
          addTeamSlots(g,parsed.teams.length);g.teams.forEach((t,i)=>Object.assign(t,parsed.teams[i]));state.games[g.code]=g;
          return {code:g.code,token:teacherToken,role:'teacher',restoredExisting:false};
        });return send(201,result);
      }
      if(url.pathname==='/api/session-packs'&&req.method==='POST'){
        const b=await body(req),title=textField(b.title,20,'講義名');
        if(!Number.isInteger(b.teamSlots)||b.teamSlots<1||b.teamSlots>30||!Number.isInteger(b.mainRounds)||b.mainRounds<1||b.mainRounds>4||!Number.isInteger(b.sessionCount)||b.sessionCount<1||b.sessionCount>2)fail(400,'参加枠1〜30、本番1〜4回、セッション数1〜2を指定してください。');
        return send(201,store.transaction(state=>createSessionPacks(state,{...b,title})));
      }
      if(url.pathname==='/api/session-packs/open'&&req.method==='POST'){
        const b=await body(req),key=normalizeManagementKey(b.managementKey),pack=store.read().sessionPacks?.[key];
        if(!pack)fail(401,'運営用ゲームキーを確認してください。');return send(200,pack);
      }
      if(url.pathname==='/api/singleplay'&&req.method==='POST'){
        const b=await body(req),name=textField(b.name,24,'会社名');
        const count=b.computers===undefined?5:b.computers,rounds=b.rounds===undefined?3:b.rounds;
        if(!Number.isInteger(count)||count<2||count>14)fail(400,'コンピュータ企業は2〜14社で指定してください。');
        if(!Number.isInteger(rounds)||rounds<1||rounds>4)fail(400,'ラウンド回数は1〜4の整数で指定してください。');
        const result=store.transaction(state=>{
          let code;do{code='s'+randomBytes(12).toString('hex');}while(state.games[code]);
          const player={id:randomUUID(),name,token:token()};
          const computers=Array.from({length:count},(_,i)=>({id:randomUUID(),name:`CPU ${String(i+1).padStart(2,'0')}`,token:token(),computer:true,strategy:i}));
          const g={code,title:'コンピュータ対戦',mode:'single',ownerId:player.id,computerSeed:token(),teacherToken:token(),modelVersion:5,totalRounds:rounds,round:1,phase:'deciding',companies:[player,...computers],decisions:{},history:[],createdAt:new Date().toISOString()};
          g.decisions=computerDecisions(g.companies,g.history,g.computerSeed);
          state.games[code]=g;
          return{code,token:player.token,companyId:player.id,role:'student',mode:'single'};
        });
        return send(201,result);
      }
      if (url.pathname === '/api/games' && req.method === 'POST') {
        const b = await body(req);
        const title = textField(b.title, 40, 'ゲーム名');
        const totalRounds=b.rounds===undefined?4:b.rounds;
        if(!Number.isInteger(totalRounds)||totalRounds<1||totalRounds>4)fail(400,'ラウンド回数は1〜4の整数で指定してください。');
        if(b.teamSlots!==undefined&&(!Number.isInteger(b.teamSlots)||b.teamSlots<1||b.teamSlots>30))fail(400,'参加枠は1〜30で指定してください。');
        const created = store.transaction(state => {
          const available = Array.from({length:900},(_,i)=>String(i+100)).filter(code=>!state.games[code]);
          if (!available.length) fail(409, '参加コードがすべて使用中です。別の保存フォルダで新しいゲームを作成してください。');
          const code = available[randomInt(available.length)];
          const teacherToken = token();
          state.games[code] = { code, title, teacherToken, modelVersion: 5, totalRounds, round: 1, phase: 'deciding',
            companies: [], decisions: {}, history: [], createdAt: new Date().toISOString() };
          if(b.teamSlots!==undefined){const g=state.games[code];g.teamMode=true;g.phase='registration';g.teams=[];g.drafts={};addTeamSlots(g,b.teamSlots);}
          return { code, token: teacherToken, role: 'teacher' };
        });
        return send(201, created);
      }
      const match = url.pathname.match(/^\/api\/games\/((?:s[a-f0-9]{24}|\d{3}|\d{6}))(?:\/(join|decision|settle|next|export|name|draft|teams|team-status|start|leader|team-keys|reset))?$/);
      if (!match) fail(404, '接続先が見つかりません。');
      const [, code, action] = match;
      const g = store.read().games[code];
      if (!g) fail(404, '参加コードが見つかりません。3桁の数字を確認してください。');
      if (action === 'join' && req.method === 'POST') {
        const b = await body(req);
        if(g.teamMode){return send(201,store.transaction(state=>joinTeam(state.games[code],b.teamKey,b.resumeToken)));}
        const name = textField(b.name, 24, '会社名');
        const joined = store.transaction(state => {
          const game = state.games[code];
          if(game.mode==='single')fail(403,'このゲームは1人用です。専用入口から開始してください。');
          if (game.round !== 1 || game.phase !== 'deciding') fail(409, '参加受付は終了しました。');
          if (game.companies.length >= RULES.maxCompanies) fail(409, '定員の30社に達しました。');
          if (game.companies.some(c => c.name.normalize('NFKC').toLowerCase() === name.normalize('NFKC').toLowerCase())) fail(409, 'その会社名は登録済みです。別の名前にしてください。');
          const company = { id: randomUUID(), name, token: token() };
          game.companies.push(company);
          return { code, token: company.token, companyId: company.id, role: 'student' };
        });
        return send(201, joined);
      }
      const auth = req.headers.authorization?.replace(/^Bearer /, '');
      const role = auth === g.teacherToken ? 'teacher' : 'student';
      const authTeam=teamForToken(g,auth);
      const member=authTeam?.members.find(m=>m.token===auth);
      const company = authTeam||g.companies.find(c => c.token === auth);
      if (role !== 'teacher' && !company) fail(401, '参加情報を確認できません。最初の画面から入り直してください。');
      if(action==='team-keys'){
        if(role!=='teacher'||!g.teamMode)fail(403,'チームキーの出力は運営管理者のみ操作できます。');
        if(req.method!=='GET')fail(405,'この操作は利用できません。');
        const cell=s=>'"'+String(s).replaceAll('"','""')+'"';
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="SmartApps_${code}_team_keys.csv"`});
        res.end('\uFEFF'+[['参加コード','チームキー','チーム名','登録端末数','対象'],...g.teams.map(t=>[code,t.key,/^[=+@-]/.test(t.name)?"'"+t.name:t.name,t.members.length,t.excluded?'除外':'参加枠'])].map(r=>r.map(cell).join(',')).join('\r\n'));return;
      }
      if (action === 'export') {
        if (role !== 'teacher') fail(403, '記録の出力は運営管理者のみ操作できます。');
        if (req.method !== 'GET') fail(405, 'この操作は利用できません。');
        const format=url.searchParams.get('format')||'csv';
        if (!['csv','txt'].includes(format)) fail(400, '出力形式はcsvまたはtxtを指定してください。');
        const exportedAt=new Date().toISOString();
        let source=g;const archived=url.searchParams.get('archive');
        if(archived!==null){if(!/^\d+$/.test(archived)||!g.resetArchives?.[Number(archived)])fail(404,'過去の記録が見つかりません。');source={...g,...g.resetArchives[Number(archived)].snapshot};}
        res.writeHead(200, {'Content-Type':format==='csv'?'text/csv; charset=utf-8':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="SmartApps_${code}_${exportedAt.slice(0,10)}.${format}"`});
        res.end(format==='csv'?exportCsv(source,exportedAt):exportText(source,exportedAt));return;
      }
      if (!action && req.method === 'GET') return send(200, view(g, role, company?.id,member?.id));
      if (req.method !== 'POST') fail(405, 'この操作は利用できません。');
      const b = await body(req);
      const result = store.transaction(state => {
        const game = state.games[code];
        if(action==='reset'){
          if(role!=='teacher'||!game.teamMode)fail(403,'チームゲームの運営管理者のみリセットできます。');
          if(b.runVersion!==(game.runVersion??0))fail(409,'ゲームは既に更新されています。画面を更新してください。');
          if(!game.history.length||game.phase==='registration')fail(409,'1ラウンド以上集計した後にリセットできます。');
          const rounds=b.rounds??game.totalRounds;if(!Number.isInteger(rounds)||rounds<1||rounds>4)fail(400,'ラウンド数は1〜4を指定してください。');
          game.resetArchives??=[];game.resetArchives.push({at:new Date().toISOString(),snapshot:{history:structuredClone(game.history),decisions:structuredClone(game.decisions),drafts:structuredClone(game.drafts),round:game.round,phase:game.phase,totalRounds:game.totalRounds,runVersion:game.runVersion??0}});
          game.round=1;game.phase='deciding';game.totalRounds=rounds;game.history=[];game.decisions={};game.drafts={};game.runVersion=(game.runVersion??0)+1;
          return view(game,role,company?.id,member?.id);
        }
        if(game.teamMode){
          if(['draft','decision','settle','next'].includes(action)&&(b.runVersion??0)!==(game.runVersion??0))fail(409,'ゲームがリセットされました。最新の画面で選び直してください。');
          const t=game.teams.find(t=>t.id===company?.id);
          const leader=t&&t.leaderId===member?.id;
          const isAdmin=role==='teacher';
          if(['teams','team-status','start','leader'].includes(action)){
            if(!isAdmin)fail(403,'運営管理者のみ操作できます。');
            if(action!=='leader'&&game.phase!=='registration')fail(409,'参加受付は終了しました。');
            if(action==='teams'){
              if(!Number.isInteger(b.count)||b.count<1||game.teams.length+b.count>30)fail(400,'合計30チームまで追加できます。');
              if(game.packKey){
                const pair=state.sessionPacks[game.packKey].games.map(g=>state.games[g.code]);
                if(pair.some(g=>g.phase!=='registration'))fail(409,'プレまたは本番を開始した後は参加枠を追加できません。事前に予備枠を用意してください。');
                const other=pair.find(g=>g.code!==game.code),before=game.teams.length;addTeamSlots(game,b.count);addTeamSlots(other,b.count);other.teams.slice(before).forEach((t,i)=>t.key=game.teams[before+i].key);
              }else addTeamSlots(game,b.count);
            }
            if(action==='team-status'){
              const target=game.teams.find(t=>t.id===b.companyId);if(!target||typeof b.excluded!=='boolean')fail(400,'チームを確認してください。');target.excluded=b.excluded;
            }
            if(action==='leader'){
              const target=game.teams.find(t=>t.id===b.companyId);if(!target?.name||!target.members.some(m=>m.id===b.memberId))fail(400,'登録済みチームの端末を指定してください。');target.leaderId=b.memberId;
            }
            if(action==='start'){
              const active=registrationTeams(game);if(!active.length)fail(409,'チーム名の登録が完了した参加チームがありません。');
              game.companies=active.map(t=>({id:t.id,name:t.name}));game.phase='deciding';game.decisions={};game.drafts={};
            }
            return view(game,role,company?.id,member?.id);
          }
          if(t&&(t.excluded||(game.phase!=='registration'&&!game.companies.some(c=>c.id===t.id))))fail(403,'このチームは参加対象外です。');
          if(action==='name'){
            if(!t)fail(403,'チームの端末から操作してください。');
            if(game.phase!=='registration')fail(409,'参加受付は終了しました。');
            if(t.name&&!leader)fail(409,'チーム名は登録済みです。代表者の画面で変更してください。');
            const name=textField(b.name,24,'チーム名');
            if(game.teams.some(other=>other.id!==t.id&&other.name.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase()))fail(409,'そのチーム名は登録済みです。');
            t.name=name;if(!t.leaderId)t.leaderId=member.id;
            return view(game,role,t.id,member.id);
          }
          if(['draft','decision'].includes(action)){
            if(!leader)fail(403,'意思決定の変更・確定は代表者のみ操作できます。');
            if(game.phase!=='deciding'||game.decisions[t.id])fail(409,'このラウンドは変更できません。');
            if(b.round!==game.round)fail(409,'ラウンドが変わりました。画面を更新してください。');
            if(b.revision!==(game.drafts[t.id]?.revision??0))fail(409,'共有された選択が更新されています。画面を更新してください。');
            if(!validDecision(b))fail(400,'選択肢の値が不正です。');
            if(action==='draft'){
              game.drafts[t.id]={decision:normalizeDecision(b),revision:b.revision+1};
              return view(game,role,t.id,member.id);
            }
          }
        }
        if (b.round !== game.round) fail(409, 'ラウンドが変わりました。画面を更新してください。');
        if (action === 'decision') {
          if (role !== 'student') fail(403, 'プレイヤーのみ確定できます。');
          if (game.phase !== 'deciding') fail(409, 'このラウンドの受付は終了しました。');
          if (game.decisions[company.id]) fail(409, 'すでに確定済みです。');
          if (!validDecision(b)) fail(400, '選択肢の値が不正です。');
          game.decisions[company.id] = normalizeDecision(b);
          if(game.mode==='single'){
            if(company.id!==game.ownerId)fail(403,'このゲームは操作できません。');
            game.history.push({round:game.round,...settle(game.companies,game.decisions,game.history)});
            game.phase=game.round===(game.totalRounds??3)?'finished':'results';
          }
        } else {
          const singleOwner=game.mode==='single'&&company?.id===game.ownerId;
          if (role !== 'teacher'&&!(singleOwner&&action==='next')) fail(403, '運営管理者のみ操作できます。');
          if (action === 'settle') {
            if (game.phase !== 'deciding') fail(409, 'すでに集計済みです。');
            if (!game.companies.length || game.companies.some(c => !game.decisions[c.id])) fail(409, '全社の意思決定が揃ってから集計してください。');
            game.history.push({ round: game.round, ...(game.modelVersion === 5 ? settle : game.modelVersion === 4 ? settleV4 : game.modelVersion === 3 ? settleV3 : settleOld)(game.companies, game.decisions, game.history) });
            game.phase = game.round === (game.totalRounds??RULES.rounds) ? 'finished' : 'results';
          } else if (action === 'next') {
            if (game.phase !== 'results' || game.round >= (game.totalRounds??RULES.rounds)) fail(409, '次のラウンドには進めません。');
            game.round++;
            game.phase = 'deciding';
            game.decisions = game.mode==='single'?computerDecisions(game.companies,game.history,game.computerSeed):{};
            if(game.teamMode)game.drafts={};
          } else fail(404, '操作が見つかりません。');
        }
        return view(game, role, company?.id,member?.id);
      });
      return send(200, result);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : '保存または集計に失敗しました。もう一度お試しください。' });
      else res.end();
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp();
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`SmartApps Biz Game: http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
