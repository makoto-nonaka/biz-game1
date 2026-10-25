import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createStore } from './lib/store.js';
import { RULES as V3_RULES, settle as settleV3 } from './lib/model-v3.js';
import { RULES as OLD_RULES, settle as settleOld } from './lib/model-v2.js';
import { RULES, validDecision, settle, ranking, normalizeDecision } from './lib/model.js';

const root = dirname(fileURLToPath(import.meta.url));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const token = () => randomBytes(32).toString('hex');

export function createApp({ dataDir = process.env.DATA_DIR || resolve(root, 'data'), allowedOrigins = process.env.ALLOWED_ORIGINS || '' } = {}) {
  const store = createStore(dataDir);
  const origins = allowedOrigins.split(',').map(s => s.trim()).filter(Boolean);
  const files = { '/': ['index.html', 'text/html'], '/teacher': ['admin.html', 'text/html'], '/admin.html': ['admin.html','text/html'], '/index.html': ['index.html','text/html'], '/student.html': ['student.html','text/html'],
    '/play': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
    '/rankings.js': ['rankings.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/config.js': ['config.js', 'text/javascript'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };

  function view(g, role, companyId) {
    const mine = g.companies.find(c => c.id === companyId);
    const rules=g.modelVersion===4?RULES:g.modelVersion===3?V3_RULES:OLD_RULES;
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
    return { code: g.code, title: g.title, round: g.round, phase: g.phase, rules: role==='teacher'?rules:studentRules,
      companies: g.companies.map(c => ({ id: c.id, name: c.name, submitted: !!g.decisions[c.id] })),
      submitted: Object.keys(g.decisions).length,
      me: mine ? { id: mine.id, name: mine.name, decision: g.decisions[mine.id] ? normalizeDecision(g.decisions[mine.id]) : null } : null,
      history, ranking: ranking(g.companies, g.history), role };
  }
  async function body(req) {
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (Buffer.byteLength(data) > 8192) fail(413, '入力が長すぎます。');
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
      if (url.pathname === '/api/games' && req.method === 'POST') {
        const b = await body(req);
        const title = textField(b.title, 40, '授業名');
        const created = store.transaction(state => {
          const available = Array.from({length:900},(_,i)=>String(i+100)).filter(code=>!state.games[code]);
          if (!available.length) fail(409, '参加コードがすべて使用中です。別の保存フォルダで新しいゲームを作成してください。');
          const code = available[randomInt(available.length)];
          const teacherToken = token();
          state.games[code] = { code, title, teacherToken, modelVersion: 4, round: 1, phase: 'deciding',
            companies: [], decisions: {}, history: [], createdAt: new Date().toISOString() };
          return { code, token: teacherToken, role: 'teacher' };
        });
        return send(201, created);
      }
      const match = url.pathname.match(/^\/api\/games\/((?:\d{3}|\d{6}))(?:\/(join|decision|settle|next))?$/);
      if (!match) fail(404, '接続先が見つかりません。');
      const [, code, action] = match;
      const g = store.read().games[code];
      if (!g) fail(404, '参加コードが見つかりません。3桁の数字を確認してください。');
      if (action === 'join' && req.method === 'POST') {
        const b = await body(req);
        const name = textField(b.name, 24, '会社名');
        const joined = store.transaction(state => {
          const game = state.games[code];
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
      const company = g.companies.find(c => c.token === auth);
      if (role !== 'teacher' && !company) fail(401, '参加情報を確認できません。最初の画面から入り直してください。');
      if (!action && req.method === 'GET') return send(200, view(g, role, company?.id));
      if (req.method !== 'POST') fail(405, 'この操作は利用できません。');
      const b = await body(req);
      const result = store.transaction(state => {
        const game = state.games[code];
        if (b.round !== game.round) fail(409, 'ラウンドが変わりました。画面を更新してください。');
        if (action === 'decision') {
          if (role !== 'student') fail(403, 'プレイヤーのみ確定できます。');
          if (game.phase !== 'deciding') fail(409, 'このラウンドの受付は終了しました。');
          if (game.decisions[company.id]) fail(409, 'すでに確定済みです。');
          if (!validDecision(b)) fail(400, '選択肢の値が不正です。');
          game.decisions[company.id] = normalizeDecision(b);
        } else {
          if (role !== 'teacher') fail(403, '運営管理者のみ操作できます。');
          if (action === 'settle') {
            if (game.phase !== 'deciding') fail(409, 'すでに集計済みです。');
            if (!game.companies.length || game.companies.some(c => !game.decisions[c.id])) fail(409, '全社の意思決定が揃ってから集計してください。');
            game.history.push({ round: game.round, ...(game.modelVersion === 4 ? settle : game.modelVersion === 3 ? settleV3 : settleOld)(game.companies, game.decisions, game.history) });
            game.phase = game.round === RULES.rounds ? 'finished' : 'results';
          } else if (action === 'next') {
            if (game.phase !== 'results' || game.round >= RULES.rounds) fail(409, '次のラウンドには進めません。');
            game.round++;
            game.phase = 'deciding';
            game.decisions = {};
          } else fail(404, '操作が見つかりません。');
        }
        return view(game, role, company?.id);
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
