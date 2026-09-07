import {afterEach,describe,expect,it} from 'vitest';
import {EventBus} from '@/kernel/event-bus';
import {CaelianDatabase} from '@/storage/database';
import {GameRepository} from '@/storage/repository';
import {saveWorkshopPack} from '@/workshop';
import {saveWorkshopMechanism} from '@/workshop-mechanisms';
import * as api from '@/battle/rework/runtime/api.mjs';
import rawCatalog from '@/battle/rework/catalog.json';
const catalog=rawCatalog as any, databases:CaelianDatabase[]=[];
const json=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
afterEach(async()=>{localStorage.clear();await Promise.all(databases.splice(0).map(async db=>{db.close();await db.delete();}));});
async function fixture(profession='holy_knight',manifests:any[]=[]){
 for(const manifest of manifests)saveWorkshopMechanism(manifest);
 const cards=Array.from({length:8},(_,i)=>({id:'fixture_custom_'+i,name:'fixture '+i,type:'skill',cost:0,effects:[{type:'draw',value:1,target:'self'}]}));
 saveWorkshopPack({format:'caelian_workshop_class_pack',version:1,packName:'Runtime test host',classes:[{id:'custom_class_native_runtime_host',main:'freelance',name:'Runtime host',talent:{name:'无',description:'无',effects:[]},cards,cardPool:[...cards,...cards].map(c=>c.id),starterDeck:Array.from({length:15},(_,i)=>cards[i%8]!.id)}]});
 const db=new CaelianDatabase('alpha','runtime-workshop-real-'+crypto.randomUUID());databases.push(db);
 const game=new GameRepository(db,new EventBus()),profile=await game.ensureProfile('chat:'+crypto.randomUUID());
 let sequence=0;
 const run=async(type:string,payload:any,runner=game)=>{const result=await runner.execute(profile.id,{id:'cmd:'+sequence++,type,payload} as any);expect(result.status,JSON.stringify(result)).toBe('applied');};
 await run('player.create',{name:'真实仓库回归',classMain:'knight',subclass:'holy_knight'});
 await run('battle.start',{workshopTest:{professionId:'custom_class_native_runtime_host',mechanismIds:manifests.map(x=>x.id),dummyCount:1,dummyHp:10000,dummyAttack:0,dummyDefense:0,dummyInvincible:false,dummyAttackEnabled:false,autoRespawn:false,playerInvincible:false,attributes:{hpMax:0,mpMax:0,attack:0,defense:0,speed:0,actionPointsPerTurn:0}}});
 let session=(await db.battleSessions.where('profileId').equals(profile.id).first())!;
 const read=async()=>{session=(await db.battleSessions.get(session.id))!;return session;};
 const prime=async(cardId:string,star=1)=>{
  await read();session.state.player.subclass=profession;const g=api.create(session.state,{level:100,explicit:true,seed:1}),p=g.player;
  p.hp=p.maxHp=1000;p.shield=0;p.stats.attack=100;p.stats.defense=0;p.stats.speed=10000;p.stats.crit=0;p.stats.critDamage=50;p.buffs=[];p.debuffs=[];p.dots=[];p.ap=10;p.apMax=10;p.resources={'星辉':3};
  p.hand=[{...structuredClone(catalog.cards.find((x:any)=>x.id===cardId)),uid:'fixture:'+sequence++,star}];
  p.deck=[];p.discard=[];p.exhaust=[];
  for(const e of g.enemies){e.hp=e.maxHp=10000;e.shield=0;e.stats.attack=0;e.stats.defense=0;e.stats.speed=0;e.stats.crit=0;e.buffs=[];e.debuffs=[];e.dots=[];}
  api.project(g,session.state);await db.battleSessions.put(session);
 };
 return {db,game,profile,run,read,prime,get battleId(){return session.id;}};
}


describe('GameRepository 兼容减益效果命中与来源',()=>{
 it.each([
  {name:'基础100 命中0 抵抗80',base:100,ehr:0,res:80,hit:false,self:false},
  {name:'基础100 命中80 抵抗50',base:100,ehr:80,res:50,hit:true,self:false},
  {name:'基础50 命中0 抵抗0',base:50,ehr:0,res:0,hit:false,self:false},
  {name:'基础50 命中80 抵抗0',base:50,ehr:80,res:0,hit:true,self:false},
  {name:'基础100 命中80 抵抗80',base:100,ehr:80,res:80,hit:false,self:false},
  {name:'自身负面代价不抵抗且不耗效果随机数',base:50,ehr:0,res:80,hit:true,self:true},
 ])('$name',async row=>{
  const f=await fixture('thunder_mage');await f.prime('th_spark_arc');let session=await f.read();
  const cardId='fixture_legacy_debuff';session.state.workshopTest!.candidateCards![cardId]={name:'兼容减益探针',type:'skill',cost:0,rarity:'common',description:'基础命中测试',effects:[{type:'apply_debuff',debuff:'weak',value:20,turns:2,chance:row.base,target:row.self?'self':'enemy'}]};
  const core=api.hydrate(session.state.rework);core.player.hand=[{id:cardId,name:'probe',uid:'legacy-probe',legacy:true,ap:0,effects:[],star:1}];core.player.stats.ehr=row.ehr;core.player.stats.res=row.res;core.enemies[0].stats.res=row.res;core.effectRng.setState(1);api.project(core,session.state);await f.db.battleSessions.put(json(session));
  await f.run('battle.play-card',{battleId:f.battleId,handIndex:0,targetIndex:0},new GameRepository(f.db,new EventBus()));session=await f.read();
  const target=row.self?session.state.player:session.state.enemies[0]!;expect(Boolean(target.debuffs.weak)).toBe(row.hit);
  const restored=api.hydrate(json(session.state.rework));expect(restored.effectRng.getState()).toBe(row.self?1:1831565814);
 });
 it('敌方伤害中的工坊反应减益仍使用玩家命中，不能借敌方 action 绕过抵抗',async()=>{
  const id='probe.reactive';const manifest={format:'caelian_workshop_script_mechanism',version:1,id,name:id,triggers:['before_damage'],resources:[],source:"function handle(ctx){if(ctx.event.sourceSide!=='enemy')return {};return {actions:[{type:'apply_debuff',status:'weak',value:20,turns:2,target:'selected_enemy'}]};}"};
  const f=await fixture('thunder_mage',[manifest]);await f.prime('th_spark_arc');let session=await f.read();session.state.workshopTest!.dummyAttackEnabled=true;
  const core=api.hydrate(session.state.rework);core.player.stats.ehr=0;core.player.stats.speed=0;const enemy=core.enemies[0];enemy.stats.res=80;enemy.stats.attack=20;enemy.stats.speed=10000;
  const basic=enemy.definition.skills[0];enemy.definition={...enemy.definition,skills:[{...basic,id:'reactive-fixture-hit',priority:100,condition:'总是',cooldown:0,cooldownGroup:'fixture',effects:[{type:'damage',flat:0,atk:1,hits:1,crit:false,target:'enemy'}]}]};api.planActor(core,enemy);core.effectRng.setState(1);api.project(core,session.state);await f.db.battleSessions.put(session);
  await f.run('battle.end-turn',{battleId:f.battleId});session=await f.read();expect(session.state.enemies[0]!.debuffs.weak).toBeUndefined();expect(session.state.player.hp).toBe(980);expect(api.hydrate(session.state.rework).effectRng.getState()).toBe(1831565814);
 });
 it('旧召唤施加的 DOT 在 JSON 恢复后仍指向该召唤来源',async()=>{
  const f=await fixture('thunder_mage');await f.prime('th_spark_arc');let session=await f.read();const id='legacy:source-probe';
  session.state.player.summons.push({id,name:'来源探针',duration:3,hp:100,hpMax:100,shield:0,attack:45,defense:0,speed:100,effectHit:80,attackable:true,mechanical:false,buffs:{},debuffs:{},skills:[{name:'来源中毒',weight:1,effects:[{type:'apply_debuff',debuff:'poison',value:20,turns:2,chance:100,target:'enemy'}]}]} as any);await f.db.battleSessions.put(session);
  await f.run('battle.end-turn',{battleId:f.battleId});session=await f.read();const restored=api.hydrate(json(session.state.rework)),dot=restored.enemies[0].dots[0];expect(dot).toBeDefined();expect(dot.sourceId).toBe(id);expect(dot.sourceActor).toBe(restored.allies.find((a:any)=>a.id===id));expect(dot.snapshotDamage).toBe(20);
 });
});
