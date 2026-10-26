const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(n);
const yen=n=>number(n)+'円';
export function breakEvenGeometry({fixedCost,unitRevenue,variableCost,reachable}) {
 const contribution=unitRevenue-variableCost;
 const threshold=contribution>0?fixedCost/contribution:null;
 // 参加社数が増えても交点を読み取れる範囲にする。実際の市場上限は別途示す。
 const maxUsers=Math.max(1,threshold===null?reachable:threshold*1.5);
 const maxMoney=Math.max(1,unitRevenue*maxUsers,fixedCost+variableCost*maxUsers)*1.12;
 return {threshold,maxUsers,maxMoney};
}
export function breakEvenChart(options) {
 const {fixedCost,unitRevenue,variableCost,reachable}=options;
 const {threshold,maxUsers,maxMoney}=breakEvenGeometry(options);
 const x=n=>48+260*n/maxUsers,y=n=>192-142*n/maxMoney;
 const crossing=threshold===null?null:{x:x(threshold),y:y(unitRevenue*threshold)};
 const title=threshold===null?'利用者が増えても黒字にならない条件です':`損益分岐点は${number(Math.ceil(threshold))}人です`;
 return `<figure class="break-even-chart"><figcaption>売上と費用のグラフ</figcaption><div class="chart-legend"><span class="revenue-key">緑：売上</span><span class="cost-key">赤：費用</span></div><svg viewBox="0 0 340 245" role="img" aria-label="${esc(title)}。横軸は利用者数、縦軸は金額。交点より右では売上が費用を上回ります。"><text x="48" y="16" class="axis-title">金額（万円）</text>${[0,.5,1].map(t=>`<line x1="48" y1="${y(t*maxMoney)}" x2="308" y2="${y(t*maxMoney)}" class="chart-grid"/><text x="42" y="${y(t*maxMoney)+4}" text-anchor="end">${number(t*maxMoney/10000)}</text>`).join('')}<path d="M48 36 V192 H308" class="chart-axis"/><path d="M48 ${y(0)} L308 ${y(unitRevenue*maxUsers)}" class="revenue-line"/><path d="M48 ${y(fixedCost)} L308 ${y(fixedCost+variableCost*maxUsers)}" class="cost-line"/>${crossing?`<path d="M${crossing.x} 192 V${crossing.y}" class="threshold-line"/><circle cx="${crossing.x}" cy="${crossing.y}" r="5" class="threshold-dot"/><text x="${Math.min(265,Math.max(91,crossing.x))}" y="${Math.max(30,crossing.y-12)}" text-anchor="middle" class="threshold-label">損益分岐点</text>`:''}${[0,.5,1].map(t=>`<text x="${x(t*maxUsers)}" y="209" text-anchor="${t===0?'start':t===1?'end':'middle'}">${number(Math.round(t*maxUsers))}</text>`).join('')}<text x="308" y="233" text-anchor="end" class="axis-title">利用者数（人）</text></svg><p class="chart-caption">${esc(title)}。${threshold!==null&&threshold>reachable?'交点は今回の市場上限より先にあります。':''}市場上限は${number(reachable)}人です。獲得人数の予測ではありません。</p></figure>`;
}
export function cumulativeGeometry(rows) {
 const sorted=rows.map(r=>({...r})).sort((a,b)=>b.profit-a.profit);
 const extent=Math.max(1,...sorted.map(r=>Math.abs(r.profit)));
 return {extent,rows:sorted.map(r=>({...r,start:r.profit<0?150+145*r.profit/extent:150,width:145*Math.abs(r.profit)/extent}))};
}
export function cumulativeChart(rows,ownId) {
 const chart=cumulativeGeometry(rows);
 return `<div class="profit-chart" role="list" aria-label="累計利益の降順グラフ"><div class="profit-chart-scale"><div>会社名・累計利益</div><svg viewBox="0 0 300 28" aria-hidden="true"><text x="0" y="15">−${number(chart.extent/10000)}万</text><text x="150" y="15" text-anchor="middle">0円</text><text x="300" y="15" text-anchor="end">＋${number(chart.extent/10000)}万</text></svg></div>${chart.rows.map(r=>`<div class="profit-chart-row ${r.companyId===ownId?'own-profit':''}" role="listitem"><div class="profit-chart-name"><b>${esc(r.name)}${r.companyId===ownId?'（自社）':''}</b><span class="${r.profit<0?'negative':''}">${yen(r.profit)}</span></div><svg viewBox="0 0 300 42" preserveAspectRatio="none" role="img" aria-label="${esc(r.name)}：累計利益${yen(r.profit)}"><line x1="150" y1="0" x2="150" y2="42" class="profit-zero"/>${r.profit!==0?`<rect x="${r.start}" y="9" width="${r.width}" height="24" rx="3" class="${r.profit<0?'loss-bar':'profit-bar'}"/>`:'<circle cx="150" cy="21" r="3" class="profit-bar"/>'}</svg></div>`).join('')}</div><p class="fine-print">中央の縦線は利益ゼロ。緑は黒字、赤は赤字です。全社で同じ目盛りを使っています。</p>`;
}
