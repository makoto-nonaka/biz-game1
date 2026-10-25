import { roundRanking, modelCompanies } from './rankings.js';
const app = document.querySelector('#app');
const base = (window.API_BASE_URL || '').replace(/\/$/, '');
const money = n => new Intl.NumberFormat('ja-JP').format(n) + '円';
const people = n => new Intl.NumberFormat('ja-JP').format(n) + '人';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const modelName = m => ({free:'Free',freemium:'Freemium',paid:'Paid'}[m || 'paid']);
const iosShare = d => d.iosPercent ?? (d.market === 'android' ? 0 : 100);
const allocationName = d => `Android ${100-iosShare(d)}% / iOS ${iosShare(d)}%`;
const activeRules = () => game?.rules || {version:4,freeRevenue:400,conversionRate:.4,baseCost:500000,variableCost:100,customersPerCompany:6000};
const rate = d => {
  const r=activeRules();
  return d.businessModel==='free'?r.freeRevenue:d.businessModel==='freemium'?d.price*r.conversionRate+(r.version>=3?(1-r.conversionRate)*r.freeRevenue:0):d.price;
};
const revenueExplanation = d => {
  const r=activeRules();
  return d.businessModel==='free'?`利用者数 × 広告収入${money(r.freeRevenue)}`:d.businessModel==='freemium'?`利用者数 × (40% × ${money(d.price)}${r.version>=3?` ＋ 60% × 広告収入${money(r.freeRevenue)}`:''})`:`${money(d.price)} × 購入者数`;
};
const switchingCost = d => {
  const previous=game?.history.at(-1)?.results.find(r=>r.companyId===game.me?.id);
  return activeRules().version>=4&&previous?Math.round(activeRules().switchingCostPerFullShift*Math.abs(d.iosPercent-iosShare(previous))/100):0;
};
const fixedCost = d => activeRules().baseCost+d.development+d.advertising+switchingCost(d);
const breakEven = d => Math.ceil(fixedCost(d)/(rate(d)-activeRules().variableCost));
const adIncome = r => r.adRevenue ?? (r.businessModel==='free'?r.revenue:0);
const payIncome = r => r.paymentRevenue ?? r.revenue-adIncome(r);
const priceHelp = () => draft.businessModel==='free'?`Freeは利用者無料。広告収入は1人あたり${money(activeRules().freeRevenue)}です。`:draft.businessModel==='freemium'?`40%が課金。${activeRules().version>=3?'無料の60%は広告収入を生みます。':'旧版ルールでは課金収入だけを計算します。'}`:'アプリの販売価格。購入者全員が支払います。';
let session = null, game = null, busy = false, requestVersion = 0, lastView = '', draftKey = '', draft = {}, acknowledged = false;
let rankingMode='profit', rankingMarket='total', rankingRound='latest';
const pagePath = location.pathname.replace(/\/+$/, '') || '/';
const teacherEntry=document.body.dataset.entry==='teacher';
const role=teacherEntry?'teacher':pagePath==='/play'?'student':null;
try { session = role && !new URLSearchParams(location.search).has('new') ? JSON.parse(sessionStorage.getItem(role) || localStorage.getItem(role) || 'null') : null; } catch { /* 壊れた端末データは再参加で復旧 */ }

function announce(message, error = false) {
  const el = document.querySelector('#notice');
  el.textContent = message;
  el.className = error ? 'notice error visible' : 'notice visible';
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => { el.className = 'notice'; }, 7000);
}
async function api(path, data, auth = session) {
  let response;
  try {
    response = await fetch(base + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(12000),
    });
  } catch { throw new Error('通信できません。接続を確認してから再試行してください。確定状況は再接続時に確認できます。'); }
  const payload = await response.json().catch(() => ({ error: '接続先の設定を確認してください。' }));
  if (!response.ok) throw Object.assign(new Error(payload.error || '操作に失敗しました。'), { status: response.status });
  return payload;
}
function saveSession(value) {
  session = value;
  const key = value.role === 'teacher' ? 'teacher' : 'student';
  sessionStorage.setItem(key, JSON.stringify(value));
  localStorage.setItem(key, JSON.stringify(value));
}
function clearSession() {
  if (role) { sessionStorage.removeItem(role); localStorage.removeItem(role); }
  session = null; game = null; lastView = ''; renderHome();
}

function renderHome() {
  if(teacherEntry){
    app.innerHTML=`<div class="landing"><section class="hero"><p class="eyebrow">ADMIN ENTRANCE</p><h1>教室が、<br><span>ひとつの市場に。</span></h1><p class="hero-copy">ゲームを作成し、3桁の参加コードを伝えてください。<br>各社の確定状況を確認しながら、3ラウンドを進めます。</p><p class="muted">プレイヤーには、このサーバーの入口URLを案内してください。</p><a class="secondary" href="/">プレイヤー用入口を開く →</a></section><section class="entry-stack"><article class="card teacher-entry"><div class="section-label">FOR ADMINS <span>ゲーム運営管理者用入口</span></div><h2>ゲームを作成</h2><form id="create-form"><label for="title">ゲーム名</label><input id="title" name="title" maxlength="40" value="はじめてのアプリ経営" required><button class="primary full" type="submit">ゲームを作成する ＋</button></form>${localStorage.getItem('teacher')?'<a class="resume" href="/admin.html">作成済みのゲームに戻る →</a>':''}</article></section></div>`;
    return;
  }
  app.innerHTML=`<div class="landing"><section class="hero"><p class="eyebrow"><span class="dot"></span> 50分で体験する、はじめての経営</p><h1>きみの選択が、<br><span>会社をつくる。</span></h1><p class="hero-copy">スマホアプリの会社をつくろう。<br>誰に、どんなアプリを届ける？<br>3回の意思決定から、経営の面白さを見つけよう。</p><div class="hero-meta"><span>03 ラウンド</span><span>20–30 社で競争</span></div><div class="lesson-note"><span class="note-symbol">↗</span><div><strong>経験を重ねて、次の一手へ。</strong><p>選んだ理由と結果を比べ、会社を育てよう。</p></div></div></section><section class="entry-stack"><article class="card join-card"><div class="section-label">FOR PLAYERS <span>プレイヤーの皆さん</span></div><h2>会社をつくって参加する</h2><p class="muted">ゲーム運営管理者から伝えられた参加コードを入力してください。</p><form id="join-form"><label for="code">参加コード</label><input id="code" name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{3}" maxlength="3" placeholder="3桁の数字" value="${esc(new URLSearchParams(location.search).get('code')||'')}" required><label for="name">会社名</label><input id="name" name="name" autocomplete="organization" maxlength="24" placeholder="例：あしたアプリ" required><button class="primary full" type="submit">この会社で参加する →</button></form><p class="fine-print">本名の入力は不要です</p>${localStorage.getItem('student')?'<a class="resume" href="/play">参加中の会社に戻る →</a>':''}</article></section></div>`;
}
function roundHeader() {
  return `<div class="game-top"><div><p class="eyebrow">${game.role === 'teacher' ? 'ADMIN CONTROL' : 'YOUR COMPANY'} / ${esc(game.title)}</p><h1>${game.role === 'teacher' ? '教室が、ひとつの市場に。' : esc(game.me.name)}</h1></div><button class="quiet" id="leave">入口に戻る</button></div>
    ${game.rules.version<4?'<p class="legacy-note">このゲームは旧版ルールで進行します。改訂版で遊ぶ場合は入口で新しいゲームを作成してください。</p>':''}<div class="round-strip"><div class="round-steps">${[1, 2, 3].map(n => `<span class="${n === game.round ? 'active' : n < game.round ? 'done' : ''}">${n < game.round ? '✓' : `0${n}`}<small>ラウンド${n}</small></span>`).join('')}</div><span class="phase">${game.phase === 'deciding' ? '意思決定を受付中' : game.phase === 'finished' ? '全3回が終了' : '結果を振り返ろう'}</span></div>`;
}
function renderGame() {
  if (!game) return;
  const key = `v4-${game.code}-${game.me?.id || 'teacher'}-${game.round}`;
  if (key !== draftKey) {
    draftKey = key;
    acknowledged = false;
    const previous = game.history.at(-1)?.results.find(r => r.companyId === game.me?.id);
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem('draft-' + key)); } catch { /* optional */ }
    draft = saved || (previous ? { iosPercent: iosShare(previous), businessModel: previous.businessModel || 'paid', price: previous.price || 500, development: previous.development, advertising: previous.advertising } : { iosPercent: 50, businessModel: 'paid', price: 500, development: 500000, advertising: 500000 });
  }
  app.innerHTML = `<div class="game-page">${roundHeader()}${game.role === 'teacher' ? teacherPanel() : studentPanel()}${game.history.length ? resultPanel() : ''}</div>`;
}
function teacherPanel() {
  const allReady = game.companies.length > 0 && game.submitted === game.companies.length;
  return `<div class="dashboard-grid"><section class="card code-card"><p class="eyebrow">JOIN THE MARKET</p><h2>参加コード</h2><div class="join-code">${game.code}</div><p>このコードをプレイヤーに伝えてください。</p><button class="secondary full" id="copy-link">参加リンクをコピー ↗</button><p class="fine-print">参加受付は第1回の集計まで。<br>この端末・ブラウザに運営管理者の操作権限を保存します。</p></section>
    <section class="card control-card"><div class="section-label">ROUND ${game.round} <span>運営管理者の進行</span></div><h2>${game.phase === 'deciding' ? 'みんなの意思決定を待っています' : game.phase === 'finished' ? '経営の体験を、学びに変えよう' : '結果を共有して、次の一手へ'}</h2>
    <div class="submission-count"><strong>${game.submitted}</strong><span>/ ${game.companies.length} 社が確定</span></div>
    ${game.phase === 'deciding' ? `<p class="muted">${allReady ? '全社が揃いました。参加人数を確認して集計してください。' : '全社の確定が揃うと、集計できます。画面は自動更新されます。'}</p><button class="primary full" id="settle" ${!allReady ? 'disabled' : ''}>ラウンド${game.round}を集計する →</button>` : game.phase === 'results' ? `<p class="muted">数字を確認し、工夫したことを共有してから進めましょう。</p><button class="primary full" id="next">ラウンド${game.round + 1}を始める →</button>` : '<p>「何を変えたか」「なぜ結果が変わったか」を、ぜひ言葉にしてみてください。</p>'}
    <p class="fine-print">集計と次ラウンドへの移動は運営管理者のみ操作できます。</p></section></div>
    <section class="card roster"><div class="section-heading"><h2>参加企業 <small>${game.companies.length} / 30社</small></h2><span class="live"><i></i> 自動更新</span></div>${game.companies.length ? `<div class="status-groups">${[false,true].map(done=>`<section><h3>${done?'確定済み':'未確定・考え中'} <small>${game.companies.filter(c=>c.submitted===done).length}社</small></h3><div class="company-list">${game.companies.filter(c=>c.submitted===done).map(c=>`<div><span>${esc(c.name)}</span><b class="status-pill ${done?'ready':''}">${done?'確定済み':'考え中'}</b></div>`).join('')||'<p class="muted">該当する会社はありません</p>'}</div></section>`).join('')}</div>` : '<p class="empty">最初の会社の参加を待っています。別のタブで入口を開けば、プレイヤーとして動作を試せます。</p>'}</section>`;
}
function choices(name, options) {
  return `<div class="choices">${options.map(o => `<label class="choice"><input type="radio" name="${name}" value="${o.value}" ${name === 'price' && draft.businessModel === 'free' ? 'disabled' : ''} ${draft[name] === o.value ? 'checked' : ''} required><span><strong>${o.label}</strong>${o.note ? `<small>${o.note}</small>` : ''}</span></label>`).join('')}</div>`;
}
function preview() {
  const r=activeRules(),fixed=fixedCost(draft),be=breakEven(draft);
  const total=game.companies.length*r.customersPerCompany;
  const reachable=(draft.iosPercent===0||draft.iosPercent===100)?total/2:total;
  const exampleUsers=Math.min(r.customersPerCompany,reachable);
  const exampleProfit=exampleUsers*(rate(draft)-r.variableCost)-fixed;
  return `<div><span>今回の固定費</span><strong>${money(fixed)}</strong><small>基本運営費50万円＋開発＋広告${activeRules().version>=4?`＋移行費用${money(switchingCost(draft))}`:""}</small></div><div><span>損益分岐点の利用者数</span><strong>${people(be)}</strong><small>1人あたりの売上 ${money(rate(draft))}<br>1人あたりの利益への貢献 ${money(rate(draft)-r.variableCost)}</small></div>
    <div class="example-profit"><span>${people(exampleUsers)}を獲得した場合の利益</span><strong class="${exampleProfit<0?'negative':''}">${money(exampleProfit)}</strong><small>人数を仮定した計算例です。売上予測の保証ではありません。</small></div>
    ${be>reachable?`<p class="feasibility-warning">現在${game.companies.length}社。参入する市場の利用者は最大${people(reachable)}のため、この条件では全員を獲得しても黒字にできません。</p>`:''}
    <p class="revenue-formula">${modelName(draft.businessModel)}：${revenueExplanation(draft)}</p><p>利用者1人につき100円の変動費がかかります。広告収入は受け取るお金、広告投資は集客のために支払うお金です。実際の利用者数は全社の選択で決まります。</p>`;
}
function updateDraftView() {
  const output=document.querySelector('#allocation-value');
  if(output) output.textContent=allocationName(draft);
  const slider=document.querySelector('#ios-percent');
  if(slider) slider.setAttribute('aria-valuetext',allocationName(draft));
  const free=draft.businessModel==='free';
  document.querySelectorAll('input[name="price"]').forEach(input=>{input.disabled=free;});
  const help=document.querySelector('#price-help');
  if(help) help.textContent=priceHelp();
  document.querySelector('#preview').innerHTML=preview();
}
function studentPanel() {
  if (game.phase !== 'deciding') return `<section class="card waiting"><span class="check-icon">✓</span><div><p class="eyebrow">${game.phase === 'finished' ? 'ALL ROUNDS COMPLETE' : 'ROUND COMPLETE'}</p><h2>${game.phase === 'finished' ? '3回の経営、おつかれさまでした。' : '結果を見て、次の戦略を考えよう。'}</h2><p>${game.phase === 'finished' ? '全3ラウンドの結果を確認できます。' : 'ゲーム運営管理者が次のラウンドを始めると、選択画面に自動で切り替わります。'}</p></div></section>`;
  if (game.me.decision) {
    const d = game.me.decision;
    return `<section class="card waiting"><span class="check-icon">✓</span><div><p class="eyebrow">DECISION CONFIRMED</p><h2>意思決定を確定しました</h2><p>${allocationName(d)} / ${modelName(d.businessModel)} / ${d.businessModel === 'free' ? '利用者無料' : money(d.price)} / 開発${money(d.development)} / 広告${money(d.advertising)}</p><p class="muted">${game.submitted} / ${game.companies.length}社が確定。ゲーム運営管理者の集計を待っています。<br>集計前に、なぜこの戦略を選んだか考えてみよう。</p></div></section>`;
  }
  return `<form id="decision-form" class="decision-grid"><section class="card decision-card"><div class="section-label">YOUR STRATEGY <span>ラウンド${game.round}の意思決定</span></div><h2>どんなアプリ会社にする？</h2><p class="muted">${game.round > 1 ? '前回の選択を表示しています。' : '選ぶ前に「なぜ？」を考えてみよう。'}</p>
    <fieldset><legend><b>01</b> 市場への力の配分</legend><div class="allocation-heading"><label for="ios-percent">市場配分</label><output id="allocation-value" for="ios-percent">${allocationName(draft)}</output></div><input id="ios-percent" class="market-slider" type="range" name="iosPercent" min="0" max="100" step="1" value="${draft.iosPercent}" aria-valuetext="${allocationName(draft)}"><div class="slider-ends"><span>Androidに集中</span><span>iOSに集中</span></div><p class="field-help">Androidは価格、iOSは開発の影響が大きい市場です。配分は労力の割合で、獲得人数の比率ではありません。${game.rules.version>=4?"市場を大きく変更すると、移行費用がかかります。":"市場ごとの競争で利用者数が変わります。"}</p></fieldset>
    <fieldset><legend><b>02</b> どうやって収益を得る？</legend>${choices('businessModel', [{value:'free',label:'Free',note:'無料・広告収入'},{value:'freemium',label:'Freemium',note:'基本無料・一部課金'},{value:'paid',label:'Paid',note:'有料販売'}])}<p class="field-help">どのモデルも、次のラウンドで自由に変更できます。</p></fieldset>
    <fieldset><legend><b>03</b> 販売・課金価格</legend>${choices('price', [300,500,700].map(n=>({value:n,label:n+'円'})))}<p class="field-help" id="price-help">${priceHelp()}</p></fieldset>
    <fieldset><legend><b>04</b> 開発にいくら使う？</legend><p class="field-help">${game.rules.version>=4?"アプリの品質を高め、次のラウンド以降の開発生産性にもつながります。":"アプリの品質を高めます。旧版では効果は今回限りです。"}</p>${choices('development', [0,500000,1000000].map(n=>({value:n,label:n/10000+'万円'})))}</fieldset>
    <fieldset><legend><b>05</b> 広告にいくら使う？</legend><p class="field-help">今回の集客のために払う費用です。効果は次の回に持ち越しません。</p>${choices('advertising', [0,500000,1000000].map(n=>({value:n,label:n/10000+'万円'})))}</fieldset></section>
    <aside class="card decision-summary"><p class="eyebrow">BEFORE YOU DECIDE</p><h2>投資は回収できそう？</h2><div id="preview">${preview()}</div><label class="confirm-label"><input type="checkbox" name="ack" ${acknowledged ? 'checked' : ''} required><span>確定後はこのラウンドの選択を変更できないことを確認しました。</span></label><button class="primary full" type="submit">この意思決定を確定する →</button><p class="fine-print">${game.rules.version>=4?"開発経験は蓄積し、広告の効果は今回だけです。":"開発・広告の効果は今回だけです。"}<br>売上が多くても、費用が多いと利益は減ります。</p></aside></form>`;
}
function userCounts(r) {
  const count=m=>r.markets?.[m]?.customers??(r.market===m?r.customers:0);
  return `<div class="user-counts"><div><span>Android</span><strong>${people(count('android'))}</strong></div><div><span>iOS</span><strong>${people(count('ios'))}</strong></div><div class="total-users"><span>合計</span><strong>${people(r.customers)}</strong></div></div>`;
}
function rankingTable(rows, label, format, ranked=true) {
  if(!rows.length) return '<p class="empty">該当する会社はありません。</p>';
  return `<table class="ranking-table"><thead><tr>${ranked?'<th class="rank-col">順位</th>':''}<th>会社名</th><th class="number">${label}</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.companyId===game.me?.id?'my-row':''}">${ranked?`<td><b class="rank-number">${r.rank}</b></td>`:''}<th scope="row">${esc(r.name)}${r.companyId===game.me?.id?'<small class="you">自社</small>':''}</th><td class="number ${rankingMode==='profit'&&r.value<0?'negative':''}">${format(r.value)}</td></tr>`).join('')}</tbody></table>`;
}
function rankingPanel() {
  const latest=game.history.at(-1);
  const selected=game.history.find(h=>String(h.round)===rankingRound)||latest;
  const tabs=[['profit','累計利益'],['revenue','売上'],['users','利用者数'],['models','モデル別']];
  const headings={profit:'累計利益ランキング',revenue:'売上ランキング',users:'利用者数ランキング',models:'ビジネスモデル別の選択企業'};
  let content='';
  if(rankingMode==='profit') content=rankingTable(game.ranking.map(r=>({...r,value:r.profit})),'累計利益',money);
  if(rankingMode==='revenue') content=rankingTable(roundRanking(selected.results,'revenue'),'売上',money);
  if(rankingMode==='users') content=rankingTable(roundRanking(selected.results,'users',rankingMarket),`${{total:'合計',android:'Android',ios:'iOS'}[rankingMarket]}利用者数`,people);
  if(rankingMode==='models') content=['free','freemium','paid'].map(model=>{
    const rows=modelCompanies(selected.results,model);
    return `<section class="model-ranking"><h3>${modelName(model)} <small>${rows.length}社</small></h3>${model==='free'?rankingTable(rows.map(r=>({...r,value:0})),'利用料金',()=> '無料',false):rankingTable(rows,model==='freemium'?'課金価格':'販売価格',money)}</section>`;
  }).join('');
  return `<div class="ranking-switch" role="group" aria-label="比較する指標">${tabs.map(([key,label])=>`<button type="button" data-ranking="${key}" aria-pressed="${rankingMode===key}">${label}</button>`).join('')}</div>
    <div class="section-heading"><h2>${headings[rankingMode]}</h2><small>${rankingMode==='profit'?`第1〜${latest.round}回の合計・同額は同順位`:'選択したラウンドの結果・累計ではありません'}</small></div>
    ${rankingMode!=='profit'?`<label class="ranking-round">対象ラウンド<select id="ranking-round"><option value="latest" ${rankingRound==='latest'?'selected':''}>最新（ラウンド${latest.round}）</option>${[...game.history].reverse().map(h=>`<option value="${h.round}" ${rankingRound===String(h.round)?'selected':''}>ラウンド${h.round}</option>`).join('')}</select></label>`:''}
    ${rankingMode==='users'?`<div class="ranking-switch market-switch" role="group" aria-label="利用者数の市場">${[['total','合計'],['android','Android'],['ios','iOS']].map(([key,label])=>`<button type="button" data-ranking-market="${key}" aria-pressed="${rankingMarket===key}">${label}</button>`).join('')}</div>`:''}
    ${rankingMode==='models'?'<p class="ranking-note">Freemium・Paidは価格が高い順（同額は同順位）。価格の高さは経営の優劣を表しません。Freeは会社名の一覧です。</p>':''}
    ${content}`;
}
function updateRanking(focusSelector) {
  document.querySelector('#ranking-panel').innerHTML=rankingPanel();
  if(focusSelector) document.querySelector(focusSelector)?.focus({preventScroll:true});
}
function resultPanel() {
  const h = game.history.at(-1);
  const mine = h.results.find(r => r.companyId === game.me?.id);
  return `<section class="results"><div class="section-heading"><div><p class="eyebrow">ROUND ${h.round} / RESULTS</p><h2>${game.phase === 'finished' ? '最終結果' : `ラウンド${h.round}の結果`}</h2></div><span class="muted">各市場 ${people(h.marketPool)} / 未購入 ${people(h.unserved)}</span></div>
    ${mine ? `<div class="metric-grid"><article class="card profit-card"><span>今回の利益</span><strong class="${mine.profit < 0 ? 'negative' : ''}">${money(mine.profit)}</strong><small>売上 − 費用</small></article><article class="card"><span>利用者数</span>${userCounts(mine)}</article><article class="card"><span>売上</span><strong>${money(mine.revenue)}</strong><small>${modelName(mine.businessModel)}<br>${revenueExplanation(mine)}</small></article><article class="card"><span>費用</span><strong>${money(mine.cost)}</strong><small>固定費 ${money(mine.fixedCost)}<br>変動費 ${money(mine.variableCost)}</small></article></div>
    <dl class="income-breakdown"><div><dt>販売・課金収入</dt><dd>${money(payIncome(mine))}</dd></div><div><dt>受取広告収入</dt><dd>${money(adIncome(mine))}</dd></div><div><dt>市場移行費用（固定費に含む）</dt><dd>${money(mine.switchingCost||0)}</dd></div><div><dt>支払広告投資（固定費に含む）</dt><dd>${money(mine.advertising)}</dd></div></dl>
    <div class="reflection"><strong>${mine.customers >= mine.breakEven ? '損益分岐点に到達しました。' : '損益分岐点に届きませんでした。'}</strong><p>必要な利用者数 ${people(mine.breakEven)} ／ 実際 ${people(mine.customers)}</p></div>` : ''}
    <section class="card ranking-card" id="ranking-panel">${rankingPanel()}</section>
    <details class="card competitor-details"><summary>各社の利用者数と販売条件を比較する</summary>${[...game.history].reverse().map(past=>`<h3>ラウンド${past.round}</h3><div class="company-comparison-grid">${past.results.map(r=>`<article class="company-comparison ${r.companyId===game.me?.id?'own-company':''}"><div class="comparison-company-name"><h4>${esc(r.name)}</h4>${r.companyId===game.me?.id?'<span class="you">自社</span>':''}</div><p class="comparison-offer">${modelName(r.businessModel)} ／ ${r.businessModel==='free'?'利用者無料':`${r.businessModel==='freemium'?'課金価格':'販売価格'} ${money(r.price)}`}</p>${userCounts(r)}</article>`).join('')}</div>`).join('')}</details>
    ${game.role==='teacher'?`<details class="card competitor-details"><summary>運営管理者用 詳細な経営データ</summary>${[...game.history].reverse().map(past => `<h3>ラウンド${past.round}</h3><div class="table-scroll"><table class="comparison"><thead><tr><th>会社名</th><th>市場配分</th><th>モデル</th><th>販売・課金価格</th><th>Android利用者</th><th>iOS利用者</th><th>開発</th><th>広告</th><th>利用者数</th><th>売上</th><th>販売・課金収入</th><th>受取広告収入</th><th>移行費用（固定費内）</th><th>固定費</th><th>変動費</th><th>費用</th><th>利益</th><th>損益分岐点</th></tr></thead><tbody>${past.results.map(r => `<tr class="${r.companyId === game.me?.id ? 'my-row' : ''}"><th scope="row">${esc(r.name)}</th><td>${allocationName(r)}</td><td>${modelName(r.businessModel)}</td><td>${r.businessModel === 'free' ? '無料' : money(r.price)}</td><td>${people(r.markets?.android.customers ?? (r.market==='android'?r.customers:0))}</td><td>${people(r.markets?.ios.customers ?? (r.market==='ios'?r.customers:0))}</td><td>${money(r.development)}</td><td>${money(r.advertising)}</td><td>${people(r.customers)}</td><td>${money(r.revenue)}</td><td>${money(payIncome(r))}</td><td>${money(adIncome(r))}</td><td>${money(r.switchingCost||0)}</td><td>${money(r.fixedCost)}</td><td>${money(r.variableCost)}</td><td>${money(r.cost)}</td><td class="${r.profit < 0 ? 'negative' : ''}">${money(r.profit)}</td><td>${people(r.breakEven)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</details>`:''}
    ${game.role==='teacher'&&game.rules.version>=3?`<details class="card competitor-details"><summary>顧客タイプ別の獲得人数を見る</summary>${[...game.history].reverse().map(past=>`<h3>ラウンド${past.round}</h3><div class="table-scroll"><table class="comparison"><thead><tr><th>会社名</th>${['Android','iOS'].map(m=>game.rules.segments.map(s=>`<th>${m}<br>${esc(s.name)}</th>`).join('')).join('')}</tr></thead><tbody>${past.results.map(r=>`<tr class="${r.companyId===game.me?.id?'my-row':''}"><th scope="row">${esc(r.name)}</th>${['android','ios'].map(m=>(r.markets[m].segments||[]).map(s=>`<td>${people(s.customers)}</td>`).join('')).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}</details>`:''}
    </section>`;
}
async function refresh(force = false) {
  if (!session || (busy && !force)) return;
  const version = ++requestVersion;
  try {
    const next = await api(`/api/games/${session.code}`);
    if (version !== requestVersion) return;
    document.body.classList.remove('offline');
    const previousCount=game?.companies.length;
    const serialized = JSON.stringify(next.role === 'student' && next.phase === 'deciding' && !next.me.decision ? {round:next.round,phase:next.phase,me:next.me,history:next.history} : next);
    if (serialized !== lastView || force) { game = next; lastView = serialized; renderGame(); }
    else {game=next;if(previousCount!==next.companies.length && document.querySelector('#preview'))updateDraftView();}
  } catch (e) {
    if (version !== requestVersion) return;
    document.body.classList.add('offline');
    if (force) announce(e.message, true);
    if (!game) {
      if (e.status === 401 || e.status === 404) clearSession();
      else app.innerHTML = '<section class="card retry"><h1>接続を確認してください</h1><p>参加情報はこの端末に保存されています。</p><button class="primary" id="retry">再接続する</button><button class="quiet" id="leave">入口に戻る</button></section>';
    }
  }
}
async function run(action) {
  if (busy) return;
  busy = true; ++requestVersion;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await action(); } catch (e) { announce(e.message, true); }
  finally {
    busy = false;
    if (session) await refresh(true);
    else document.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}
app.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target, data = Object.fromEntries(new FormData(form));
  if (form.id === 'join-form') run(async () => {
    const value = await api(`/api/games/${data.code}/join`, { name: data.name }, null);
    saveSession(value); location.assign('/play');
  });
  if (form.id === 'create-form') run(async () => {
    const value = await api('/api/games', { title: data.title }, null);
    saveSession(value); location.assign('/admin.html');
  });
  if (form.id === 'decision-form') run(async () => {
    await api(`/api/games/${session.code}/decision`, { round: game.round, ...draft, price: draft.businessModel === 'free' ? 0 : draft.price });
    announce('意思決定を確定しました。');
  });
});
function updateSelection(e) {
  if (e.target.name === 'ack') { acknowledged=e.target.checked; return; }
  if (e.target.type !== 'radio' && e.target.type !== 'range') return;
  draft[e.target.name] = e.target.name === 'businessModel' ? e.target.value : Number(e.target.value);
  sessionStorage.setItem('draft-' + draftKey, JSON.stringify(draft));
  updateDraftView();
}
app.addEventListener('input', updateSelection);
app.addEventListener('change', e => {
  if(e.target.id==='ranking-round'){rankingRound=e.target.value;updateRanking('#ranking-round');return;}
  updateSelection(e);
});
app.addEventListener('click', e => {
  const ranking=e.target.closest('button[data-ranking]');
  if(ranking){rankingMode=ranking.dataset.ranking;updateRanking(`[data-ranking="${rankingMode}"]`);return;}
  const market=e.target.closest('button[data-ranking-market]');
  if(market){rankingMarket=market.dataset.rankingMarket;updateRanking(`[data-ranking-market="${rankingMarket}"]`);return;}
  const id = e.target.closest('button')?.id;
  if (id === 'leave') location.assign(teacherEntry?'/admin.html?new=1':'/');
  if (id === 'retry') refresh(true);
  if (id === 'settle' || id === 'next') run(async () => {
    await api(`/api/games/${session.code}/${id}`, { round: game.round });
    announce(id === 'settle' ? '全社の結果を集計しました。' : '次のラウンドを開始しました。');
  });
  if (id === 'copy-link') {
    const link = `${location.origin}/?code=${game.code}`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(() => announce('参加リンクをコピーしました。')).catch(() => announce(`参加リンク：${link}`));
    else announce(`参加リンク：${link}`);
  }
});
if (session) { sessionStorage.setItem(role, JSON.stringify(session)); refresh(true); } else renderHome();
setInterval(() => { if (session && !document.hidden) refresh(); }, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && session) refresh(); });
