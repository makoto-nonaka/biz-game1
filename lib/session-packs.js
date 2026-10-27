import {randomInt,randomBytes} from 'node:crypto';
import {addTeamSlots} from './teams.js';
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalizeManagementKey=v=>typeof v==='string'?v.normalize('NFKC').toUpperCase().replace(/[\s-]/g,''):'';
export function createSessionPacks(state,{title,teamSlots,mainRounds,sessionCount}){
 state.sessionPacks??={};const packs=[];
 for(let n=1;n<=sessionCount;n++){
  let key;do{key=Array.from({length:12},()=>alphabet[randomInt(alphabet.length)]).join('');}while(state.sessionPacks[key]);
  const games=[];let shared=null;
  for(const [stage,rounds]of [['practice',1],['main',mainRounds]]){
   const available=Array.from({length:900},(_,i)=>String(i+100)).filter(c=>!state.games[c]);if(!available.length)throw Object.assign(new Error('参加コードの空きがありません。'),{status:409});
   const code=available[randomInt(available.length)],teacherToken=randomBytes(32).toString('hex');
   const g={code,title:`${title} 第${n}回 ${stage==='practice'?'プレ':'本番'}`,teacherToken,modelVersion:5,totalRounds:rounds,round:1,phase:'registration',companies:[],decisions:{},history:[],teams:[],drafts:{},teamMode:true,packKey:key,stage,createdAt:new Date().toISOString()};
   addTeamSlots(g,teamSlots);if(shared)g.teams.forEach((t,i)=>t.key=shared[i]);else shared=g.teams.map(t=>t.key);
   state.games[code]=g;games.push({code,token:teacherToken,role:'teacher',stage,label:stage==='practice'?'プレ（1回）':`本番（${mainRounds}回）`});
  }
  const pack={title:`${title} 第${n}セッション`,managementKey:key,games};state.sessionPacks[key]=pack;packs.push(pack);
 }
 return {packs};
}
