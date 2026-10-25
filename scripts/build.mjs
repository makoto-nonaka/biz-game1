import { cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
const api = (process.env.API_BASE_URL || '').replace(/\/$/, '');
if (api && !/^https?:\/\/[^\s/]+(?::\d+)?$/.test(api)) throw new Error('API_BASE_URL はサーバーのオリジンURLを指定してください。');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
// 拡張子なしURLが静的配信でも開けるようにする。
for (const page of ['teacher', 'play']) {
  mkdirSync(`dist/${page}`, { recursive: true });
  cpSync(page==='teacher'?'public/admin.html':'public/index.html', `dist/${page}/index.html`);
}
writeFileSync('dist/config.js', `window.API_BASE_URL = ${JSON.stringify(api)};\n`);
console.log('画面を dist に出力しました。API:', api || '同じサーバー');
