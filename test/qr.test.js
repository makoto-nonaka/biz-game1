import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('同梱のQR生成器が参加URLをSVGへ変換できる',()=>{
 const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../public/vendor/qrcode.js',import.meta.url),'utf8'),context);
 const q=context.qrcode(0,'M');q.addData('https://startup-classroom.onrender.com/?code=123');q.make();
 assert.ok(q.getModuleCount()>=21);const svg=q.createSvgTag({cellSize:5,margin:20,scalable:true});assert.match(svg,/<svg/);assert.match(svg,/viewBox=/);assert.match(svg,/<path/);
});
