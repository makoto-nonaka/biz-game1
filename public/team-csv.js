export function parseCsv(text){
 if(typeof text!=='string')throw Error('CSVファイルを選択してください。');
 text=text.replace(/^\uFEFF/,'');let rows=[],row=[],value='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
  if(c==='"'){if(value||closed)throw Error('CSVの引用符が不正です。');quoted=true;}
  else if(c===','||c==='\r'||c==='\n'){row.push(value);value='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}}
  else{if(closed)throw Error('CSVの引用符の後に不正な文字があります。');value+=c;}
 }
 if(quoted)throw Error('CSVの引用符が閉じられていません。');
 if(value||row.length||closed){row.push(value);if(row.some(v=>v.trim()))rows.push(row);}return rows;
}
export function parseTeamCsv(text){
 const rows=parseCsv(text);if(rows.length<2)throw Error('チームのデータ行がありません。');
 const headers=rows[0].map(s=>s.normalize('NFKC').trim()),col=names=>headers.findIndex(s=>names.includes(s));
 const codeCol=col(['参加コード','ゲーム番号','ゲームコード']),keyCol=col(['チームキー']),nameCol=col(['チーム名','会社名']),statusCol=col(['対象']);
 if(codeCol<0||keyCol<0)throw Error('CSVには「参加コード（またはゲーム番号）」と「チームキー」の列が必要です。');
 let code=null;const keys=new Set(),names=new Set(),teams=[];
 for(const [index,row]of rows.slice(1).entries()){
  const raw=(row[codeCol]||'').normalize('NFKC').trim();if(!/^(?:\d{1,3}|\d{6})$/.test(raw))throw Error(`${index+2}行目の参加コードを確認してください。`);
  const c=raw.length<=3?raw.padStart(3,'0'):raw;if(code&&c!==code)throw Error('1つのCSVには1つのゲーム番号だけを含めてください。');code=c;
  const key=(row[keyCol]||'').normalize('NFKC').trim().toUpperCase();if(!/^[0-9]{6}$/.test(key))throw Error(`${index+2}行目のチームキーは6桁の数字にしてください。`);
  if(keys.has(key))throw Error(`チームキー ${key} が重複しています。`);keys.add(key);
  let name=nameCol>=0?(row[nameCol]||'').trim():'';if(/^'[=+@-]/.test(name))name=name.slice(1);
  if([...name].length>24||/[\u0000-\u001f\u007f]/.test(name))throw Error(`${index+2}行目のチーム名は改行なし・24文字以内にしてください。`);
  const normalized=name.normalize('NFKC').toLowerCase();if(name&&names.has(normalized))throw Error('チーム名が重複しています。');if(name)names.add(normalized);
  teams.push({key,name,excluded:statusCol>=0&&(row[statusCol]||'').trim()==='除外'});
 }
 if(teams.length>30)throw Error('参加枠は30チーム以内にしてください。');return{code,teams};
}
