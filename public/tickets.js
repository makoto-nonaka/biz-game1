const base=(window.API_BASE_URL||'').replace(/\/$/,''),pages=document.querySelector('#pages'),message=document.querySelector('#message');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const admin=new URLSearchParams(location.search).has('admin');let prepared=[];
const qr=url=>{const q=window.qrcode(0,'M');q.addData(url);q.make();return q.createSvgTag({cellSize:4,margin:16,scalable:true});};
async function request(path,data,token){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});if(!r.ok)throw new Error('運営情報を読み込めません。管理画面で運営用ゲームキーを入力し直してください。');return r.json();}
function render(){
 const count=Number(document.querySelector('#count').value);if(!Number.isInteger(count)||count<1||count>30){message.textContent='チーム数は1〜30で指定してください。';return;}
 const selected=prepared.filter((_,i)=>document.querySelector(`[data-session-index="${i}"]`)?.checked);
 if(admin){
  pages.innerHTML=selected.map(({pack,practice,main})=>`<section class="admin-page"><h1>運営用控え — 参加者への配布禁止</h1><h2>${esc(pack.title)}</h2><p>運営用ゲームキー</p><strong class="master-key">${pack.managementKey.match(/.{1,4}/g).join('-')}</strong><p>管理画面の「運営用ゲームキーで再開」から、プレと本番の両方を呼び出せます。</p><p>管理画面：${esc(location.origin)}/admin.html?new=1</p><p>プレ：参加コード <b>${practice.code}</b> ／ 本番：参加コード <b>${main.code}</b></p><p>チームキーはプレ・本番で共通。成績と開発資源は別です。</p><table><thead><tr><th>枠番号</th><th>チームキー</th></tr></thead><tbody>${practice.teams.map((t,i)=>`<tr><td>${i+1}</td><td>${t.key}</td></tr>`).join('')}</tbody></table></section>`).join('');return;
 }
 const sheets=[];
 for(const {pack,practice,main}of selected){
  const teams=practice.teams.slice(0,count),preUrl=`${location.origin}/?code=${practice.code}`,mainUrl=`${location.origin}/?code=${main.code}`;
  for(let start=0;start<teams.length;start+=6)sheets.push(`<section class="ticket-page"><div class="sheet-caption">${esc(pack.title)} ／ チームごとに1枚配布</div><div class="ticket-grid">${teams.slice(start,start+6).map((t,i)=>`<article class="ticket"><h2>${esc(pack.title)}</h2><div class="key-row"><span>チーム ${start+i+1}</span><strong>${t.key}</strong></div><p>全員が同じチームキーを入力</p><div class="qr-pair"><div>${qr(preUrl)}<b>① プレ</b><span>参加コード ${practice.code}</span></div><div>${qr(mainUrl)}<b>② 本番</b><span>参加コード ${main.code}</span></div></div><p class="instructions">最初に左のQRで参加。案内後に右のQRで本番へ。<br>チーム名を登録した端末が代表者になります。</p><div class="company-line">チーム名：</div></article>`).join('')}</div></section>`);
 }
 pages.innerHTML=sheets.join('');message.textContent=`${selected.length}セッション分、最大${count}チームずつを表示しています。各セッションの予備枠は印刷しなくても残ります。`;
}
(async()=>{try{
 const saved=JSON.parse(localStorage.getItem('session-packs')||'[]');if(!saved.length)throw new Error('先に管理画面で「2セッション分を事前準備する」を作成するか、運営用ゲームキーで呼び出してください。');
 for(const p of saved){const pack=await request('/api/session-packs/open',{managementKey:p.managementKey});const pre=pack.games.find(g=>g.stage==='practice'),main=pack.games.find(g=>g.stage==='main');const practice=await request(`/api/games/${pre.code}`,null,pre.token),actual=await request(`/api/games/${main.code}`,null,main.token);if(practice.teams.length!==actual.teams.length||practice.teams.some((t,i)=>t.key!==actual.teams[i].key))throw new Error('プレと本番のキーが一致しません。管理画面で確認してください。');prepared.push({pack,practice,main:actual});}
 document.querySelector('#sessions').innerHTML=prepared.map(({pack,practice,main},i)=>`<label><input type="checkbox" data-session-index="${i}" ${i>=prepared.length-2?'checked':''}>${esc(pack.title)}（${practice.code}／${main.code}）</label>`).join('');
 document.querySelector('h1').textContent=admin?'運営用控えを印刷（配布禁止）':'チーム配布票を印刷';message.textContent=admin?'この紙には運営権限のあるキーを含みます。運営側だけで保管してください。':'';render();
 }catch(e){message.textContent=e.message;}})();
document.querySelector('#refresh').addEventListener('click',render);document.querySelector('#print').addEventListener('click',()=>window.print());
