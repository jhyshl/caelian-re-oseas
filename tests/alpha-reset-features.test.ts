import {afterEach, describe, expect, it} from 'vitest';
import {CaelianDatabase} from '@/storage/database';
import {GameRepository} from '@/storage/repository';
import {EventBus} from '@/kernel/event-bus';
import {GuildRepository} from '@/storage/repositories/guild-repository';
import {loadGuildCatalogs} from '@/content/catalogs/guild';
import regions from '@/content/generated/world/regions.json';
import {commissionBoard, escortDestinations} from '@/guild-commissions';
import {cardRecordId} from '@/battle/card-inventory';
import {normalizeWorkshopCard, normalizeWorkshopPack, saveWorkshopPack} from '@/workshop';
import {DEFAULT_STAR_SCALING, needsWorkshopStars, normalizeStarScaling, scaleWorkshopCard, readStarTemplates, saveStarTemplate} from '@/workshop-stars';
import type {QuestRecord} from '@/domain/types';
import * as runtime from '@/battle/rework/runtime/api.mjs';
const dbs:CaelianDatabase[]=[];
afterEach(async()=>{localStorage.clear();for(const db of dbs.splice(0)){db.close();await db.delete();}});
async function fixture(){
 const db=new CaelianDatabase('alpha','reset-features-'+crypto.randomUUID());dbs.push(db);const game=new GameRepository(db,new EventBus());
 const {id}=await game.ensureProfile(crypto.randomUUID());const cmd=(type:string,payload:unknown)=>game.execute(id,{id:crypto.randomUUID(),type,payload});
 await cmd('player.create',{name:'测试员',classMain:'knight',subclass:'holy_knight'});await db.playerStates.update(id,{statPoints:100,gold:10000});
 const guild=new GuildRepository(db),tx=<T>(f:()=>Promise<T>)=>db.transaction('rw',db.tables,f);
 return {db,game,id,cmd,guild,tx};
}
function pack(configured=true){
 const cards=Array.from({length:8},(_,i)=>({id:'custom_stars_card_'+i,name:'星级测试卡'+i,type:'attack',cost:1,rarity:'common',effects:[{type:'damage',value:20,scaling:{stat:'attack',percent:100},target:'enemy'}],...(configured?{starScaling:DEFAULT_STAR_SCALING}:{})}));
 return {format:'caelian_workshop_class_pack',version:1,packName:'星级测试',classes:[{id:'custom_stars',main:'freelance',name:'星级测试职业',talent:{name:'天赋',description:'无',effects:[]},cards,cardPool:[...cards,...cards].map(c=>c.id),starterDeck:Array.from({length:15},(_,i)=>cards[i%8]!.id)}]};
}
describe('批量加点、异地护送和自定义卡牌升星',()=>{
 it.each([1,3])('自制卡%s星在正式战斗只计算基础值＋显式攻击倍率，并同步AI行为',async(stars)=>{
  const f=await fixture();saveWorkshopPack(pack());await f.cmd('battle.start',{monsterId:'mon_slime'});
  const session=(await f.db.battleSessions.where('profileId').equals(f.id).first())!,g=runtime.hydrate(session.state.rework);
  Object.assign(g.player.stats,{attack:100,crit:0,speed:10000});g.player.ap=10;g.player.profession='custom_stars';g.player.buffs=[];
  for(const e of g.enemies){e.hp=e.maxHp=10000;e.shield=0;e.buffs=[];e.debuffs=[];e.stats.defense=0;e.stats.speed=0;}
  runtime.project(g,session.state);session.state.player.hand=[{instanceId:'custom-play',cardId:'custom_stars_card_0',stars}];
  await f.db.battleSessions.put(session);await f.cmd('battle.play-card',{battleId:session.id,handIndex:0,targetIndex:0});
  const after=(await f.db.battleSessions.get(session.id))!.state,core=runtime.hydrate(after.rework);
  expect(10000-after.enemies[0]!.hp).toBeCloseTo(stars===1?120:144);
  expect(core.player.thisTurn).toMatchObject({cardsPlayed:1,damageCards:1,apSpent:1});
 });
 it('自制卡的旧减益不能冒充本次命中的术证，真实护盾可获取守证',async()=>{
  const f=await fixture();await f.cmd('battle.start',{monsterId:'boss_solavia_hollow_saint'});
  const session=(await f.db.battleSessions.where('profileId').equals(f.id).first())!,g=runtime.hydrate(session.state.rework),boss=g.enemies[0];
  g.addStatus(g.player,boss,{type:'debuff',status:'weak',value:.1,turns:3},{skipEffectRoll:true});runtime.project(g,session.state);
  const before=runtime.legacyCardCheckpoint(session.state);
  runtime.recordLegacyCard(session.state,{id:'miss',type:'skill',effects:[{type:'apply_debuff',debuff:'weak'}]},1,before);
  expect(runtime.hydrate(session.state.rework).enemies[0].flags.boss.evidence.art).toBe(false);
  const next=runtime.legacyCardCheckpoint(session.state);session.state.player.shield+=20;
  runtime.recordLegacyCard(session.state,{id:'shield',type:'defense',effects:[{type:'shield',value:20}]},2,next);
  const core=runtime.hydrate(session.state.rework);expect(core.enemies[0].flags.boss.evidence.guard).toBe(true);expect(core.player.thisTurn.defenseAP).toBe(2);expect(core.player.thisTurn.shieldGained).toBe(20);
 });
 it('自定义次数跨越AP10点档位，原路退款且超预算整笔回滚',async()=>{
  const f=await fixture();
  await f.cmd('player.allocate-stat',{stat:'actionPointsPerTurn',direction:'add',count:6});
  expect(await f.db.playerStates.get(f.id)).toMatchObject({actionPointsPerTurn:11,statPoints:87});
  await f.cmd('player.allocate-stat',{stat:'actionPointsPerTurn',direction:'remove',count:6});
  expect(await f.db.playerStates.get(f.id)).toMatchObject({actionPointsPerTurn:5,statPoints:100});
  await f.cmd('player.allocate-stat',{stat:'attack',direction:'add',count:30});
  expect((await f.db.statAllocations.get(f.id))!.attack).toBe(30);
  const before=await f.db.playerStates.get(f.id);
  await expect(f.cmd('player.allocate-stat',{stat:'hpMax',direction:'add',count:71})).rejects.toThrow();
  expect(await f.db.playerStates.get(f.id)).toEqual(before);expect((await f.db.statAllocations.get(f.id))!.hpMax).toBe(0);
  expect(await f.cmd('player.allocate-stat',{stat:'hpMax',direction:'add',count:1.5})).toMatchObject({status:'rejected'});
  await expect(f.cmd('player.allocate-stat',{stat:'drawPerTurn',direction:'add',count:3})).rejects.toThrow();
  expect(await f.db.playerStates.get(f.id)).toEqual(before);
 });
 it('护送仅从起点外已解锁地区生成，未解锁与同城不能接取',async()=>{
  const f=await fixture(),{tasks}=await loadGuildCatalogs(),task=tasks.find(t=>t.type==='escort')!;
  const origin=regions.find(r=>r.name===task.region)!,dest=regions.find(r=>r.id!==origin.id)!;
  await f.db.regionAccess.where('profileId').equals(f.id).modify({accessible:false});
  await f.db.regionAccess.put({id:f.id+':'+origin.id,profileId:f.id,regionId:origin.id,accessible:true,unlockCondition:'',updatedAt:1});
  expect(commissionBoard([task],await f.db.regionAccess.toArray())).toEqual([]);
  await f.db.regionAccess.put({id:f.id+':'+dest.id,profileId:f.id,regionId:dest.id,accessible:true,unlockCondition:'',updatedAt:1});
  const board=commissionBoard([task],await f.db.regionAccess.toArray());expect(board).toHaveLength(1);expect(board[0]!.destination).toBe(dest.name);
  expect(escortDestinations(task.region,await f.db.regionAccess.toArray())).not.toContain(task.region);
  await f.db.worldStates.update(f.id,{region:task.region,location:task.region});
  const input={taskId:task.id!,title:task.name,region:task.region,objective:task.desc,totalStages:1,rewardExperience:0,rewardGold:10,rewardGuildExperience:0,minimumLevel:1,commissionType:'escort' as const,destination:task.region};
  await expect(f.tx(()=>f.guild.acceptCommission(f.id,input))).rejects.toThrow('起点以外');
  await f.tx(()=>f.guild.acceptCommission(f.id,{...input,destination:dest.name}));
  const q=(await f.db.questRecords.toArray())[0]!;
  await expect(f.tx(()=>f.guild.progressCommission(f.id,q.id))).rejects.toThrow('护送至');
  await expect(f.tx(()=>f.guild.completeCommission(f.id,q.id))).rejects.toThrow('尚未完成');
  await f.db.worldStates.update(f.id,{region:dest.name,location:dest.name,updatedAt:(q.commissionAcceptedAt??0)+10});
  await f.tx(()=>f.guild.progressCommission(f.id,q.id));expect(await f.db.questRecords.get(q.id)).toMatchObject({status:'ready',escortArrived:true});
  await f.tx(()=>f.guild.completeCommission(f.id,q.id));expect((await f.db.playerStates.get(f.id))!.gold).toBe(10010);
  await expect(f.tx(()=>f.guild.completeCommission(f.id,q.id))).rejects.toThrow();
 });
 it('旧版同城已就绪护送迁移后恢复异地目标，不能领取空奖励',async()=>{
  const f=await fixture(),{tasks}=await loadGuildCatalogs(),task=tasks.find(t=>t.type==='escort')!;
  await f.db.regionAccess.where('profileId').equals(f.id).modify({accessible:true});
  await f.db.questRecords.put({id:'old-escort',profileId:f.id,kind:'commission',definitionId:task.id,title:task.name,region:task.region,objective:'同城抵达',status:'ready',currentStage:1,totalStages:1,commissionType:'escort',rewardExperience:10,rewardGold:100,rewardGuildExperience:5,updatedAt:1});
  await f.guild.migrateCommissions(f.id);const q=(await f.db.questRecords.get('old-escort'))!;
  expect(q.status).toBe('active');expect(q.escortDestination).toBeTruthy();expect(q.escortDestination).not.toBe(task.region);expect(q.escortArrived).toBe(false);
 });
 it('复合委托缺少任何一类目标都无法领奖，提交材料只扣一次',async()=>{
  const f=await fixture();const now=Date.now();
  const q:QuestRecord={id:'hybrid',profileId:f.id,kind:'commission',title:'复合',region:'伊拉亚城',objective:'战斗＋材料',status:'active',currentStage:0,totalStages:2,commissionType:'combat_gather',commissionVersion:2,commissionKills:0,commissionItems:[{itemId:'食人花花粉',count:3}],commissionItemsSubmitted:false,rewardExperience:10,rewardGold:10,rewardGuildExperience:1,updatedAt:now};
  await f.db.questRecords.put(q);
  await expect(f.tx(()=>f.guild.progressCommission(f.id,q.id))).rejects.toThrow('需要');
  await f.cmd('inventory.adjust',{itemId:'食人花花粉',name:'食人花花粉',delta:3});await f.tx(()=>f.guild.progressCommission(f.id,q.id));
  expect(await f.db.questRecords.get(q.id)).toMatchObject({status:'active',commissionItemsSubmitted:true});expect(await f.db.inventoryStacks.count()).toBe(0);
  await expect(f.tx(()=>f.guild.completeCommission(f.id,q.id))).rejects.toThrow('尚未完成');await expect(f.tx(()=>f.guild.progressCommission(f.id,q.id))).rejects.toThrow('已提交');
  await f.db.questRecords.update(q.id,{commissionKills:2,currentStage:2,status:'ready'});await f.tx(()=>f.guild.completeCommission(f.id,q.id));expect(await f.db.questRecords.get(q.id)).toBeUndefined();
 });
 it('旧卡不会静默补星级；模板往返存储，三星仅提升固定值和属性倍率',()=>{
  const raw=pack(false).classes[0]!.cards[0]!,old=normalizeWorkshopCard(raw,'custom_stars',0);expect(needsWorkshopStars(old)).toBe(true);
  const card=normalizeWorkshopCard({...raw,starScaling:DEFAULT_STAR_SCALING},'custom_stars',0);
  const scaled=scaleWorkshopCard(card,3);expect(scaled.effects[0]).toMatchObject({value:24,scaling:{percent:120}});expect(card.effects[0]!.value).toBe(20);expect(scaled.cost).toBe(1);
  const roundtrip=normalizeWorkshopPack(JSON.parse(JSON.stringify(pack())));expect(roundtrip.classes[0]!.cards[0]!.starScaling).toEqual(DEFAULT_STAR_SCALING);
  saveStarTemplate('我的成长',DEFAULT_STAR_SCALING);saveStarTemplate('我的成长',DEFAULT_STAR_SCALING);expect(readStarTemplates()).toHaveLength(1);
  expect(()=>normalizeStarScaling({version:1,levels:[{flat:1,ratio:1}]})).toThrow('完整');
 });
 it('配置后的自定义卡牌三张同星＋2000金币合成，未配置拒绝且不扣费',async()=>{
  const f=await fixture(),cardId='custom_stars_card_0';saveWorkshopPack(pack(false));
  await f.db.ownedCards.put({id:cardRecordId(f.id,cardId,1),profileId:f.id,cardId,quantity:3,stars:1,source:'test',updatedAt:1});
  await expect(f.cmd('cards.upgrade',{cardId,stars:1})).rejects.toThrow('星级数值');expect((await f.db.playerStates.get(f.id))!.gold).toBe(10000);
  saveWorkshopPack(pack());await f.cmd('cards.upgrade',{cardId,stars:1});expect(await f.db.ownedCards.get(cardRecordId(f.id,cardId,1))).toBeUndefined();
  expect(await f.db.ownedCards.get(cardRecordId(f.id,cardId,2))).toMatchObject({quantity:1,stars:2});expect((await f.db.playerStates.get(f.id))!.gold).toBe(8000);
 });
});
