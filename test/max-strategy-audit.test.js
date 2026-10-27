import test from 'node:test';
import assert from 'node:assert/strict';
import {policies,scenario,play} from '../balance/max-strategy-audit.mjs';
import {validDecision,settle} from '../lib/model-v5.js';
test('最大戦略検証は本体と同じ集計・累計順位を使い、相手計画を変更しない',()=>{
 const s=scenario(10,'random',20261027),before=JSON.stringify(s),p=policies.find(p=>p.id==='max-paid-75'),r=play(s,p),history=[];
 for(let round=1;round<=4;round++){
  const decisions={...s.plans[round-1],0:p.choice};assert.ok(Object.values(decisions).every(validDecision));
  const expected=settle(s.companies,decisions,history);assert.deepEqual(r.history[round-1].results,expected.results);history.push({round,...expected});
  const cumulative=s.companies.map((_,i)=>history.reduce((sum,h)=>sum+h.results[i].profit,0));
  assert.equal(r.rounds[round-1].profit,cumulative[0]);assert.equal(r.rounds[round-1].rank,1+cumulative.filter(v=>v>cumulative[0]).length);
 }
 play(s,policies.find(p=>p.id==='half-paid-75'));assert.equal(JSON.stringify(s),before);
});
test('各対戦条件と全候補で有効な選択になり、固定・ランダム相手は同じ計画を再利用できる',()=>{
 for(const suite of ['random','mixed','efficient','computers']){
  const s=scenario(3,suite,5678);for(const policy of policies){const r=play(s,policy);assert.ok(r.history.every(h=>h.results.every(validDecision)));}
  assert.deepEqual(s,scenario(3,suite,5678));
 }
});
