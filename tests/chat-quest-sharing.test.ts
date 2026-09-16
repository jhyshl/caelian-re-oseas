import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { QuestProgressRepository } from '@/storage/repositories/quest-progress-repository';
import { GuildRepository } from '@/storage/repositories/guild-repository';
import { QuestCatalog } from '@/quests/catalog';
import catalogData from '../public/managed-content/quests/alpha.json';
import { initialQuestProgress } from '@/quests/state-machine';
const databases: CaelianDatabase[] = [];
afterEach(async () => { for (const db of databases) db.close(); for (const db of databases.splice(0)) await db.delete(); localStorage.clear(); });
async function fixture(channel: 'alpha' | 'beta' = 'alpha') {
 const db = new CaelianDatabase(channel, 'chat-quests-'+crypto.randomUUID()); databases.push(db);
 const game = new GameRepository(db,new EventBus()), quests = new QuestProgressRepository(db);
 const profile = await game.resolveProfile('chat-1');
 await game.execute(profile.id,{id:'create',type:'player.create',payload:{name:'测试',classMain:'knight',subclass:'holy_knight'}});
 await db.playerStates.update(profile.id,{level:20,gold:100});
 const definition = {...QuestCatalog.parse(catalogData).data.quests[0]!, minimumLevel:1,
  rewards:{default:{experience:0,gold:0,guildExperience:0,collectibles:['测试纪念品']},endings:{}}};
 const settings = (reset=true,preserve=true) => game.execute(profile.id,{id:crypto.randomUUID(),type:'settings.update',payload:{preserveAdventureSave:preserve,resetQuestsOnNewChat:reset}});
 return {db,game,quests,profile,definition,settings};
}
describe('共用冒险数据，按聊天保存任务',()=>{
 it.each(['alpha','beta'] as const)('%s 新聊天任务归零，旧聊天的三条完成记录保留，等级和物品双向共用',async channel=>{
  const {db,game,quests,profile,definition,settings}=await fixture(channel);
  for(let i=0;i<3;i++) {const def={...definition,id:definition.id+'-'+i};const q=await quests.acceptDefinition(profile.id,def);await db.questRecords.update(q.id,{status:'ready'});await quests.completeDefinition(profile.id,def);}
  await db.inventoryStacks.put({id:profile.id+':token',profileId:profile.id,itemId:'token',name:'纪念物',quantity:4,updatedAt:1});
  await settings();
  const savedSpecials=await db.specialCollectibles.toArray(),savedRelics=await db.ownedRelics.toArray(),savedAchievements=await db.achievementProgress.toArray();
  expect((await game.resolveProfile('chat-2')).id).toBe(profile.id);
  let snapshot=await game.snapshot(profile.id);expect(snapshot.player.level).toBe(20);expect(snapshot.quests).toEqual([]);expect(snapshot.questHistory).toEqual([]);
  expect(snapshot.inventory.find(x=>x.itemId==='token')?.quantity).toBe(4);
  expect(await db.specialCollectibles.toArray()).toEqual(savedSpecials);expect(await db.ownedRelics.toArray()).toEqual(savedRelics);for(const achievement of savedAchievements.filter(a=>a.unlocked)) expect(await db.achievementProgress.get(achievement.id)).toMatchObject({unlocked:true,unlockedAt:achievement.unlockedAt});
  expect(savedAchievements.some(a=>a.unlocked)).toBe(true);
  const q=await quests.acceptDefinition(profile.id,{...definition,id:definition.id+'-0'});
  expect(q.profileId).not.toBe(profile.id);expect((await game.snapshot(profile.id)).quests).toHaveLength(1);
  await db.playerStates.update(profile.id,{level:21});await db.inventoryStacks.update(profile.id+':token',{quantity:7});
  await game.resolveProfile('chat-1');snapshot=await game.snapshot(profile.id);
  expect(snapshot.player.level).toBe(21);expect(snapshot.inventory.find(x=>x.itemId==='token')?.quantity).toBe(7);expect(snapshot.questHistory).toHaveLength(3);expect(snapshot.quests).toEqual([]);
  await expect(quests.selectQuest(profile.id,q.id,initialQuestProgress(definition))).rejects.toThrow();
  await game.resolveProfile('chat-2');expect((await game.snapshot(profile.id)).quests[0]?.id).toBe(q.id);
  await settings(false);await game.resolveProfile('chat-2');expect((await game.snapshot(profile.id)).quests[0]?.id).toBe(q.id);
 });
 it('两个数据库连接各自读取任务；刷新后仍使用原聊天的任务，楼层回退只改当前任务并操作共用背包',async()=>{
  const {db,game,quests,profile,definition,settings}=await fixture();await settings();
  const a=await quests.acceptDefinition(profile.id,definition);await quests.selectQuest(profile.id,a.id,initialQuestProgress(definition));
  const otherDb=new CaelianDatabase('alpha',db.name);databases.push(otherDb);const other=new GameRepository(otherDb,new EventBus()),otherQuests=new QuestProgressRepository(otherDb);
  await other.resolveProfile('chat-2');const b=await otherQuests.acceptDefinition(profile.id,definition);await otherQuests.selectQuest(profile.id,b.id,initialQuestProgress(definition));
  const next={...initialQuestProgress(definition),trackerState:'tracking' as const};
  await otherQuests.bindFloor(profile.id,{questId:b.id,floor:{id:'floor',index:2,role:'assistant',fingerprint:'body',lineageHash:'branch'},summary:'新聊天进度',next,judgeResult:{},giftItems:[{itemId:'token',itemName:'纪念物',count:2}]});
  expect((await quests.selectedTracker(profile.id))?.questId).toBe(a.id);expect((await otherQuests.selectedTracker(profile.id))?.questId).toBe(b.id);
  expect((await game.snapshot(profile.id)).inventory.find(x=>x.itemId==='token')?.quantity).toBe(2);
  otherDb.close();await otherDb.open();await other.resolveProfile('chat-2');expect((await otherQuests.getTracker(profile.id,b.id))?.current.summary).toBe('新聊天进度');
  await otherQuests.rollbackFromFloor(profile.id,2);expect((await db.inventoryStacks.get(profile.id+':token'))).toBeUndefined();expect((await quests.selectedTracker(profile.id))?.questId).toBe(a.id);
 });
 it('未开启重置时保留原共用行为；开启后只有新聊天创建空任务，关闭冒险继承则创建新玩家',async()=>{
  const {game,quests,profile,definition,settings}=await fixture();await settings(false);const a=await quests.acceptDefinition(profile.id,definition);
  await game.resolveProfile('old-shared');await settings();await game.resolveProfile('new-chat');expect((await game.snapshot(profile.id)).quests).toEqual([]);
  await game.resolveProfile('old-shared');expect((await game.snapshot(profile.id)).quests[0]?.id).toBe(a.id);
  await settings(true,false);const fresh=await game.resolveProfile('fresh-adventure');expect(fresh.id).not.toBe(profile.id);expect((await game.snapshot(fresh.id)).player.level).toBe(1);
 });
 it('委托接取、完成记录与重复接取检查按聊天区分',async()=>{
  const {db,game,profile,settings}=await fixture();await settings();const guild=new GuildRepository(db),task=(await guild.refreshCommissions(profile.id)).find(t=>t.type==='combat')!;
  expect(task).toBeDefined();await db.playerStates.update(profile.id,{level:100});await db.worldStates.update(profile.id,{region:task.region,location:task.region});
  const input={taskId:task.id!,title:task.name,region:task.region,objective:task.desc,totalStages:task.count??1,rewardExperience:task.xp,rewardGold:task.gold,rewardGuildExperience:task.gxp,minimumLevel:task.lvl};
  await guild.acceptCommission(profile.id,input);const a=(await game.snapshot(profile.id)).quests[0]!;
  await game.resolveProfile('chat-2');await guild.acceptCommission(profile.id,input);const b=(await game.snapshot(profile.id)).quests[0]!;expect(a.id).not.toBe(b.id);
  await db.questRecords.update(b.id,{status:'ready',commissionKills:b.totalStages});await guild.completeCommission(profile.id,b.id);
  expect((await game.snapshot(profile.id)).questHistory[0]?.id).toBe(b.id);await expect(guild.acceptCommission(profile.id,input)).rejects.toThrow('今日已完成');
  await game.resolveProfile('chat-1');expect((await game.snapshot(profile.id)).quests[0]?.id).toBe(a.id);expect((await game.snapshot(profile.id)).questHistory).toEqual([]);
 });
 it('旧聊天战斗不会出现在新聊天，也不能跨聊天出牌或结算',async()=>{
  const {db,game,profile,settings}=await fixture();await settings();
  const command=(type:string,payload:unknown)=>game.execute(profile.id,{id:crypto.randomUUID(),type,payload});
  expect((await command('battle.start',{monsterId:'mon_slime'})).status).toBe('applied');
  const first=(await game.snapshot(profile.id)).battle!;
  // An ongoing battle from v11 has no scope field and belongs to the original chat.
  await db.battleSessions.put({...first,questProfileId:undefined});
  await game.resolveProfile('chat-2');expect((await game.snapshot(profile.id)).battle).toBeNull();
  expect((await game.battleSnapshot(profile.id)).battle).toBeNull();
  await expect(command('battle.end-turn',{battleId:first.id})).rejects.toThrow('当前战斗不存在');
  await db.battleSessions.put({...first,questProfileId:undefined,state:{...first.state,status:'victory'}});
  await expect(command('battle.claim-reward',{battleId:first.id,kind:'card'})).rejects.toThrow('可领取奖励的战斗不存在');
  await expect(command('battle.finish',{battleId:first.id})).rejects.toThrow('战斗不存在');
  await db.battleSessions.put({...first,questProfileId:undefined});
  expect((await command('battle.start',{monsterId:'mon_slime'})).status).toBe('applied');
  const second=(await game.snapshot(profile.id)).battle!;expect(second.id).not.toBe(first.id);
  await game.resolveProfile('chat-1');expect((await game.snapshot(profile.id)).battle?.id).toBe(first.id);
  expect((await command('battle.end-turn',{battleId:first.id})).status).toBe('applied');
  await game.resolveProfile('chat-2');expect((await game.snapshot(profile.id)).battle?.id).toBe(second.id);
  expect((await db.battleSessions.get(second.id))?.state.turn).toBe(1);
 });
});
