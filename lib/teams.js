import {randomInt,randomUUID,randomBytes} from 'node:crypto';
export const normalizeTeamKey=value=>typeof value==='string'?value.normalize('NFKC').trim().toUpperCase():'';
export function addTeamSlots(game,count){
 const keys=new Set(game.teams.map(t=>t.key));
 for(let n=0;n<count;n++){
  let key;do{key=String(randomInt(100000,1000000));}while(keys.has(key));keys.add(key);
  game.teams.push({id:randomUUID(),key,name:'',members:[],leaderId:null,excluded:false});
 }
}
export function joinTeam(game,key,resumeToken){
 const team=game.teams.find(t=>t.key===normalizeTeamKey(key));
 if(!team)throw Object.assign(new Error('チームキーが見つかりません。6桁の数字を確認してください。'),{status:404});
 if(team.excluded||(game.phase!=='registration'&&!game.companies.some(c=>c.id===team.id)))throw Object.assign(new Error('このチームは今回のゲームの参加対象外です。'),{status:403});
 let member=team.members.find(m=>m.token===resumeToken);
 if(!member){member={id:randomUUID(),token:randomBytes(32).toString('hex')};team.members.push(member);}
 if(team.name&&!team.leaderId)team.leaderId=member.id;
 return{code:game.code,token:member.token,companyId:team.id,role:'student',teamMode:true};
}
export function teamForToken(game,token){return token?game.teams?.find(t=>t.members.some(m=>m.token===token)):undefined;}
export function registrationTeams(game){return game.teams.filter(t=>t.name&&t.members.length&&!t.excluded);}
