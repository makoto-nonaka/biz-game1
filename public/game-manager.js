const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phase={registration:'参加受付中',deciding:'意思決定中',results:'結果表示中',finished:'終了'};
export function managementAuth(){try{const token=sessionStorage.getItem('game-management');return token?{token}:null;}catch{return null;}}
function knownTeachers(){
 let values=[];try{values=JSON.parse(localStorage.getItem('teacher-games')||'[]');}catch{}
 for(const storage of [localStorage,sessionStorage])try{const current=JSON.parse(storage.getItem('teacher')||'null');if(current)values.push(current);}catch{}
 try{values.push(...JSON.parse(localStorage.getItem('session-packs')||'[]').flatMap(p=>p.games));}catch{}
 return values.filter(v=>v?.role==='teacher'&&typeof v.token==='string');
}
export function rememberTeacher(value){
 if(value?.role!=='teacher')return;
 const values=knownTeachers().filter(v=>v.token!==value.token);
 values.push({code:value.code,token:value.token,role:'teacher'});
 localStorage.setItem('teacher-games',JSON.stringify(values.slice(-900)));
}
export function mountGameManager({base,onOpen,onArchive}){
 const host=document.createElement('section');host.id='game-manager';host.className='game-manager card';
 document.querySelector('#app').after(host);
 let data={games:[],archives:[],allGames:false},pending=null,working=false;
 const showMessage=(message,error=false)=>{const el=host.querySelector('[data-manager-message]');el.textContent=message;el.className=error?'manager-message error':'manager-message';};
 async function request(path,body={}){
  const token=managementAuth()?.token;
  const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({...body,...(path.startsWith('/api/admin/games')?{tokens:knownTeachers().map(v=>v.token)}:{})}),signal:AbortSignal.timeout(12000)});
  const value=await r.json();if(!r.ok)throw Error(value.error||'操作できませんでした。');return value;
 }
 function confirmation(row,operation){
  if(pending?.instanceId!==row.instanceId||pending?.operation!==operation||pending?.archiveId!==row.archiveId)return '';
  const restoring=operation==='restore';
  return `<form data-manager-confirm data-code="${esc(row.code)}" data-operation="${operation}" data-instance="${row.instanceId}" ${row.archiveId?`data-archive="${row.archiveId}"`:''}>
   <p>${restoring?'退避したゲームを元に戻します。':'このゲームを無効化し、番号を空けます。成績と参加端末は退避され、プレイヤーは接続できなくなります。CSVで作り直した後は、全員が参加し直してください。'}</p>
   <label>確認のためゲーム番号 ${esc(row.code)} を入力<input name="confirmCode" inputmode="numeric" pattern="${row.code}" autocomplete="off" required aria-label="確認用ゲーム番号"></label>
   <button class="${restoring?'secondary':'danger-button'}" type="submit">${restoring?'退避したゲームを戻す':'このゲームを無効化する'}</button><button class="quiet" type="button" data-manager-cancel>キャンセル</button></form>`;
 }
 function render(){
  const row=r=>`<article class="manager-game"><div><strong>ゲーム ${esc(r.code)} ／ ${esc(r.title)}</strong><p>${phase[r.phase]||esc(r.phase)} ／ ラウンド${r.round}・全${r.rounds}回 ／ 登録${r.registeredCount}社・枠${r.teamCount}<br>作成：${esc(r.createdAt?new Date(r.createdAt).toLocaleString('ja-JP'):'日時不明')}${r.archivedAt?` ／ 無効化：${esc(new Date(r.archivedAt).toLocaleString('ja-JP'))}`:''}</p></div><div class="manager-actions">${r.archiveId?`<button class="secondary" type="button" data-manager-restore="${r.archiveId}">元に戻す</button>`:`<button class="secondary" type="button" data-manager-open="${r.code}">管理画面を開く</button><button class="danger-button" type="button" data-manager-archive="${r.code}">無効化（番号を空ける）</button>`}</div>${confirmation(r,r.archiveId?'restore':'archive')}</article>`;
  host.innerHTML=`<h2>作成済みゲームの管理</h2><p>印刷済みのQRコードとチームキーを使う場合は、該当ゲームをそのまま開くか、無効化してから同じ番号のCSVを読み込んでください。</p>
   <p class="field-help">${data.allGames?'全ゲームを表示しています。':'このブラウザに管理権限を保存したゲームを表示しています。別のPC・ブラウザで作ったゲームは、運営専用パスワードで表示できます。'}</p>
   <div class="manager-actions"><button class="secondary" type="button" data-manager-refresh>一覧を更新</button>${data.allGames?'<button class="quiet" type="button" data-manager-logout>全ゲームの管理を終了</button>':''}</div>
   ${data.allGames?'':`<details><summary>運営専用パスワードで全ゲームを表示</summary><form data-manager-login><label>運営専用パスワード<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">全ゲームを表示する</button></form><p class="field-help">Renderの環境変数 ADMIN_PASSWORD に設定したパスワードです。プレイヤーには配布しないでください。</p></details>`}
   <p data-manager-message role="status" class="manager-message"></p>
   <div class="manager-list">${data.games.length?data.games.map(row).join(''):'<p class="empty">表示できるゲームはありません。</p>'}</div>
   ${data.archives.length?`<details class="manager-archives"><summary>無効化したゲーム（${data.archives.length}件）</summary>${data.archives.map(row).join('')}</details>`:''}
   <p class="fine-print">無効化した記録はサーバー内に退避します。サーバーの保存領域が失われた場合には、退避記録も失われます。</p>`;
  host.querySelectorAll('button').forEach(b=>b.disabled=working);
 }
 async function load(){data=await request('/api/admin/games/list');pending=null;render();}
 async function perform(fn){if(working)return;working=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){showMessage(e.message,true);}finally{working=false;host.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 host.addEventListener('submit',e=>{
  e.preventDefault();const form=e.target,fields=new FormData(form);
  if(form.matches('[data-manager-login]'))perform(async()=>{
   const value=await request('/api/admin/session',{password:fields.get('password')});form.reset();sessionStorage.setItem('game-management',value.token);await load();showMessage('全ゲームの管理を有効にしました。');
  });
  if(form.matches('[data-manager-confirm]'))perform(async()=>{
   const {code,operation,instance,archive}=form.dataset;
   const value=await request(`/api/admin/games/${code}/${operation}`,{confirmCode:fields.get('confirmCode'),instanceId:instance,archiveId:archive});
   if(operation==='restore'){rememberTeacher(value);await onOpen(value);}
   else{await onArchive(code,instance);await load();showMessage(`ゲーム ${code} を無効化しました。同じ番号のチームキーCSVを読み込めます。`);document.querySelector('#team-csv-file')?.scrollIntoView({behavior:'smooth',block:'center'});}
  });
 });
 host.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-manager-refresh'))perform(load);
  if(button.hasAttribute('data-manager-logout'))perform(async()=>{await request('/api/admin/session/end');sessionStorage.removeItem('game-management');await load();});
  if(button.hasAttribute('data-manager-open'))perform(async()=>{const row=data.games.find(r=>r.code===button.dataset.managerOpen);const value=await request(`/api/admin/games/${row.code}/open`,{instanceId:row.instanceId});rememberTeacher(value);await onOpen(value);});
  if(button.hasAttribute('data-manager-archive')){pending={...data.games.find(r=>r.code===button.dataset.managerArchive),operation:'archive'};render();}
  if(button.hasAttribute('data-manager-restore')){pending={...data.archives.find(r=>r.archiveId===button.dataset.managerRestore),operation:'restore'};render();host.querySelector('.manager-archives').open=true;}
  if(button.hasAttribute('data-manager-cancel')){pending=null;render();}
 });
 render();perform(load);
 return {reload:()=>perform(load)};
}
