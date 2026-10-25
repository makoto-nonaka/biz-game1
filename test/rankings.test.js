import test from 'node:test';
import assert from 'node:assert/strict';
import {rankBy,roundRanking,modelCompanies,customerCount} from '../public/rankings.js';
const rows=[
 {companyId:'a',name:'A',businessModel:'paid',price:700,revenue:1400,customers:2,markets:{android:{customers:2},ios:{customers:0}}},
 {companyId:'b',name:'B',businessModel:'freemium',price:300,revenue:2000,customers:10,markets:{android:{customers:1},ios:{customers:9}}},
 {companyId:'c',name:'C',businessModel:'paid',price:700,revenue:1400,customers:2,markets:{android:{customers:0},ios:{customers:2}}},
 {companyId:'d',name:'D',businessModel:'free',price:0,revenue:3000,customers:8,markets:{android:{customers:4},ios:{customers:4}}},
 {companyId:'e',name:'E',businessModel:'paid',price:300,revenue:300,customers:1,markets:{android:{customers:0},ios:{customers:1}}},
];
test('売上と市場別利用者数はそれぞれの値で降順に並ぶ',()=>{
 assert.deepEqual(roundRanking(rows,'revenue').map(r=>r.companyId),['d','b','a','c','e']);
 assert.deepEqual(roundRanking(rows,'users','total').map(r=>r.companyId),['b','d','a','c','e']);
 assert.deepEqual(roundRanking(rows,'users','android').map(r=>r.companyId),['d','a','b','c','e']);
 assert.deepEqual(roundRanking(rows,'users','ios').map(r=>r.companyId),['b','d','c','e','a']);
});
test('同値は同順位、負の累計利益でも降順、入力は変更しない',()=>{
 const original=JSON.stringify(rows);
 assert.deepEqual(roundRanking(rows,'revenue').map(r=>r.rank),[1,2,3,3,5]);
 assert.deepEqual(rankBy([{profit:-10},{profit:0},{profit:-10},{profit:-20}],r=>r.profit).map(r=>[r.value,r.rank]),[[0,1],[-10,2],[-10,2],[-20,4]]);
 assert.equal(JSON.stringify(rows),original);
});
test('モデル別価格を混ぜず、Freeに順位を付けない。空のモデルも扱える',()=>{
 assert.deepEqual(modelCompanies(rows,'paid').map(r=>[r.companyId,r.rank]),[['a',1],['c',1],['e',3]]);
 assert.deepEqual(modelCompanies(rows,'freemium').map(r=>r.companyId),['b']);
 assert.equal(modelCompanies(rows,'free')[0].companyId,'d');
 assert.ok(!('rank' in modelCompanies(rows,'free')[0]));
 assert.deepEqual(modelCompanies([],'paid'),[]);
});
test('旧版の単一市場の利用者数を読み取れる',()=>{
 assert.equal(customerCount({market:'ios',customers:20},'ios'),20);
 assert.equal(customerCount({market:'ios',customers:20},'android'),0);
});
