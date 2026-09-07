import {afterEach,describe,expect,it} from 'vitest';
import {EventBus} from '@/kernel/event-bus';
import {CaelianDatabase} from '@/storage/database';
import {GameRepository} from '@/storage/repository';
import {saveWorkshopPack} from '@/workshop';
import {saveWorkshopMechanism,workshopStatusKey} from '@/workshop-mechanisms';
import * as api from '@/battle/rework/runtime/api.mjs';
import rawCatalog from '@/battle/rework/catalog.json';
const catalog=rawCatalog as any, databases:CaelianDatabase[]=[];
const json=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
afterEach(async()=>{localStorage.clear();await Promise.all(databases.splice(0).map(async db=>{db.close();await db.delete();}));});
function script(id:string,nested=false){return {format:'caelian_workshop_script_mechanism',version:1,id,name:id,triggers:['before_card','after_card','before_damage','enemy_damaged'],resources:['before','after','damage','received'].map(id=>({id,label:id,min:0,max:99,initial:0,visible:true})),source:`function handle(ctx){ const names={before_card:'before',after_card:'after',before_damage:'damage',enemy_damaged:'received'};const key=names[ctx.trigger];const out={resources:{}};if(key)out.resources[key]=ctx.resources[key]+1;if(ctx.trigger==='before_damage')out.event={amount:100};${nested?"if(ctx.trigger==='after_card')out.actions=[{type:'damage',value:7,target:'selected_enemy'}];":''}return out;}`};}
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

describe('GameRepository 新战斗真实工坊兼容',()=>{
 it('原生三星三段卡只发一次 before/after_card，工坊基数覆写不会再乘星级或段数',async()=>{
  const f=await fixture('thunder_mage',[script('probe.single')]);await f.prime('th_chain_lightning',3);
  await f.run('battle.play-card',{battleId:f.battleId,handIndex:0,targetIndex:0});
  const s=(await f.read()).state;
  expect(s.enemies[0]!.hp).toBe(9900);expect(s.player.ap).toBe(8);expect(s.player.discardPile).toHaveLength(1);
  expect(s.workshopMechanisms?.resources).toMatchObject({'probe.single:before':1,'probe.single:after':1,'probe.single:damage':1,'probe.single:received':1});
  expect(s.workshopMechanisms?.errors??{}).toEqual({});
  const restored=api.hydrate(json(s.rework));expect(restored.enemies[0].hp).toBe(9900);expect(restored.action).toBeNull();
 });
 it('after_card 嵌套伤害保留卡牌元数据且只入账一次，读档后不会复算',async()=>{
  const f=await fixture('thunder_mage',[script('probe.nested',true)]);await f.prime('th_spark_arc');
  await f.run('battle.play-card',{battleId:f.battleId,handIndex:0,targetIndex:0});
  const s=(await f.read()).state;
  expect(s.enemies[0]!.hp,JSON.stringify({resources:s.workshopMechanisms,logs:s.log.slice(-10)})).toBe(9800);expect(s.player.ap).toBe(9);
  expect(s.workshopMechanisms?.resources).toMatchObject({'probe.nested:before':1,'probe.nested:after':1,'probe.nested:damage':2,'probe.nested:received':2});
  expect(s.workshopMechanisms?.errors??{}).toEqual({});
  const readOnly=new GameRepository(f.db,new EventBus());const snap=await readOnly.snapshot(f.profile.id);
  expect(snap.battle!.state.enemies[0]!.hp).toBe(9800);expect(snap.battle!.state.workshopMechanisms?.resources).toEqual(s.workshopMechanisms?.resources);
 });
 it('原生发现卡在 IndexedDB 待选择期间保持事务隔离，JSON 恢复后 before/after 各一次',async()=>{
  const f=await fixture('astrologer',[script('probe.choice')]);await f.prime('as_astrology');
  await f.run('battle.play-card',{battleId:f.battleId,handIndex:0,targetIndex:0});
  let session=await f.read();expect(session.state.player.pendingCardChoice).toBeDefined();
  expect(session.state.player.ap).toBe(10);expect(session.state.workshopMechanisms?.resources['probe.choice:before']).toBe(0);
  await f.db.battleSessions.put(json(session));const restoredGame=new GameRepository(f.db,new EventBus());
  let count=0;while(session.state.player.pendingCardChoice){expect(++count).toBeLessThan(12);await f.run('battle.choose-astrology-card',{battleId:f.battleId,choiceIndex:0},restoredGame);session=await f.read();}
  expect(session.state.player.ap).toBe(9);expect(session.state.workshopMechanisms?.resources).toMatchObject({'probe.choice:before':1,'probe.choice:after':1});
  expect(session.state.reworkTransaction).toBeUndefined();expect(session.state.player.hand.length).toBe(1);
 });
 it('原生回合结算自定义持续治疗护盾与固伤，读档无重复 tick',async()=>{
  const manifest={format:'caelian_workshop_mechanism',version:1,id:'probe.status',name:'状态探针',resources:[],rules:[],statuses:[{id:'guard',label:'守护',polarity:'buff',effects:[{type:'turn_heal',value:5},{type:'turn_shield',value:4},{type:'damage_bonus',value:50},{type:'damage_reduction',value:25},{type:'debuff_immunity',value:1}]},{id:'rot',label:'腐蚀',polarity:'debuff',effects:[{type:'turn_damage',value:3}]}]};
  const f=await fixture('thunder_mage',[manifest]);await f.prime('th_spark_arc');let session=await f.read();
  session.state.player.hp=50;session.state.player.buffs[workshopStatusKey(manifest.id,'guard')]={value:2,turns:3};session.state.player.debuffs[workshopStatusKey(manifest.id,'rot')]={value:2,turns:3};await f.db.battleSessions.put(session);
  await f.run('battle.end-turn',{battleId:f.battleId});session=await f.read();
  expect(session.state.player.hp).toBe(54);expect(session.state.player.shield).toBe(8);
  const core=api.hydrate(json(session.state.rework));expect(core.player.hp).toBe(54);
  await f.run('battle.play-card',{battleId:f.battleId,handIndex:0,targetIndex:0});session=await f.read();
  expect(session.state.player.hp).toBe(54);expect(session.state.enemies[0]!.hp).toBe(9828);
 });
});
