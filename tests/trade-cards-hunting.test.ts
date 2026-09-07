import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventBus} from '@/kernel/event-bus';
import {CaelianDatabase} from '@/storage/database';
import {GameRepository} from '@/storage/repository';
import {MarketRepository} from '@/storage/repositories/market-repository';
import {GatheringRepository} from '@/storage/repositories/gathering-repository';
import {QuestProgressRepository} from '@/storage/repositories/quest-progress-repository';
import {cardRecordId,grantCard,migrateCardInventory,resolveDeckStars} from '@/battle/card-inventory';
import {hydrate} from '@/battle/rework/runtime/api.mjs';
import {HUNTING_TRAPS} from '@/content/hunting-traps';
import {freightDayKey,type FreightOrder} from '@/market-freight';
import {QuestCatalog} from '@/quests/catalog';
import {initialQuestProgress} from '@/quests/state-machine';
import {manualQuestChoices} from '@/quests/manual-progress';
import catalogJson from '../public/managed-content/quests/alpha.json';
const dbs:CaelianDatabase[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const db of dbs.splice(0)){db.close();await db.delete();}});
async function setup() {
  const db=new CaelianDatabase('alpha','trade-'+crypto.randomUUID());dbs.push(db);
  const game=new GameRepository(db,new EventBus(),{random:()=>0.5});
  const profile=await game.ensureProfile(crypto.randomUUID()),id=profile.id;
  await game.execute(id,{id:crypto.randomUUID(),type:'player.create',payload:{name:'测试',classMain:'freelance',subclass:'magician'}});
  await db.playerStates.update(id,{gold:1000000});
  const clock={date:new Date(2026,8,7,12,30)},market=new MarketRepository(db,()=>clock.date,()=>0);
  await market.prepare();
  const tx=<T>(run:()=>Promise<T>)=>db.transaction('rw',db.tables,run);
  const cmd=(type:string,payload:unknown,commandId:string=crypto.randomUUID())=>game.execute(id,{id:commandId,type,payload});
  return {db,game,id,market,clock,tx,cmd};
}
type Fixture=Awaited<ReturnType<typeof setup>>;
const knife='mg_card_knife';
async function setCopies(f:Fixture,quantity:number,stars=1) {
  await f.db.ownedCards.put({id:cardRecordId(f.id,knife,stars),profileId:f.id,cardId:knife,stars,quantity,source:'fixture',updatedAt:Date.now()});
}
describe('同星卡牌合成与构筑',()=>{
  it('九张一星经四次合成生成一张三星，余下的一星与三星分别保存，重复命令不再扣费',async()=>{
    const f=await setup();await setCopies(f,10);
    for(let n=0;n<3;n++) await f.cmd('cards.upgrade',{cardId:knife,stars:1},'fuse-'+n);
    expect(await f.db.ownedCards.get(cardRecordId(f.id,knife,1))).toMatchObject({quantity:1,stars:1});
    expect(await f.db.ownedCards.get(cardRecordId(f.id,knife,2))).toMatchObject({quantity:3,stars:2});
    await f.cmd('cards.upgrade',{cardId:knife,stars:2},'fuse-3');
    expect(await f.db.ownedCards.get(cardRecordId(f.id,knife,2))).toBeUndefined();
    expect(await f.db.ownedCards.get(cardRecordId(f.id,knife,3))).toMatchObject({quantity:1,stars:3});
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(992000);
    expect(await f.cmd('cards.upgrade',{cardId:knife,stars:2},'fuse-3')).toMatchObject({status:'duplicate'});
    await expect(f.cmd('cards.upgrade',{cardId:knife,stars:1})).rejects.toThrow('3张');
    expect(await f.cmd('cards.upgrade',{cardId:knife,stars:3})).toMatchObject({status:'rejected'});
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(992000);
  });
  it('不足三张、金币不足以及写入异常均不会留下部分扣款或材料消耗',async()=>{
    const f=await setup();await setCopies(f,2);await setCopies(f,1,2);
    await expect(f.cmd('cards.upgrade',{cardId:knife,stars:1})).rejects.toThrow('3张');
    await setCopies(f,4);await f.db.playerStates.update(f.id,{gold:1999});
    await expect(f.cmd('cards.upgrade',{cardId:knife,stars:1})).rejects.toThrow('2000');
    await f.db.playerStates.update(f.id,{gold:10000});
    vi.spyOn(f.db.ownedCards,'put').mockRejectedValueOnce(new Error('write-failure'));
    await expect(f.cmd('cards.upgrade',{cardId:knife,stars:1},'retry')).rejects.toThrow('write-failure');
    expect((await f.db.ownedCards.get(cardRecordId(f.id,knife)))!.quantity).toBe(4);
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(10000);
    expect(await f.db.commandInbox.get('retry')).toBeUndefined();
    await f.cmd('cards.upgrade',{cardId:knife,stars:1},'retry');
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(8000);
  });
  it('同名一星与二星分别入组、转职后还原，并在真实战斗中按实体继承星级',async()=>{
    const f=await setup();await setCopies(f,4);await f.cmd('cards.upgrade',{cardId:knife,stars:1});
    const others=(await f.db.ownedCards.where('profileId').equals(f.id).toArray()).filter(c=>c.cardId!==knife).slice(0,8).map(c=>c.cardId);
    const cardIds=[knife,knife,...others],cardStars=[1,2,...others.map(()=>1)];
    await f.cmd('deck.update',{cardIds,cardStars});
    await expect(f.cmd('deck.update',{cardIds,cardStars:[2,2,...others.map(()=>1)]})).rejects.toThrow('同名同星');
    for(const subclass of ['priest','magician']) await f.cmd('player.reclass',{classMain:'freelance',subclass});
    expect((await f.game.snapshot(f.id)).decks.find(d=>d.active)).toMatchObject({cardIds,cardStars});
    expect((await f.db.ownedCards.get(cardRecordId(f.id,knife)))!.quantity).toBe(1);
    expect((await f.db.ownedCards.get(cardRecordId(f.id,knife,2)))!.quantity).toBe(1);
    await f.cmd('battle.start',{monsterId:'mon_slime'});
    const state=(await f.game.snapshot(f.id)).battle!.state;
    const instances=[...state.player.hand,...state.player.drawPile,...state.player.discardPile].filter(c=>c.cardId===knife);
    expect(instances.map(c=>c.stars).sort()).toEqual([1,2]);
    const core=hydrate(state.rework);
    const native=[...core.player.hand,...core.player.deck,...core.player.discard].filter((c:any)=>c.id===knife);
    expect(native.map((c:any)=>c.star).sort()).toEqual([1,2]);
  });
  it('旧存档保留曾购买的全局星级，后续新奖励只增加一星库存',async()=>{
    const f=await setup();
    await f.db.playerStates.update(f.id,{cardFusionVersion:undefined,cardStars:{[knife]:3}});
    await setCopies(f,2);
    await migrateCardInventory(f.db,f.id);
    expect(await f.db.ownedCards.get(cardRecordId(f.id,knife,3))).toMatchObject({stars:3,quantity:2});
    await grantCard(f.db,f.id,knife,1);
    expect(await f.db.ownedCards.get(cardRecordId(f.id,knife))).toMatchObject({stars:1,quantity:1});
    const cards=await f.db.ownedCards.where('profileId').equals(f.id).toArray();
    expect(resolveDeckStars([knife,knife],cards,[1,3])).toEqual([1,3]);
    await migrateCardInventory(f.db,f.id);
    expect((await f.db.ownedCards.get(cardRecordId(f.id,knife)))!.quantity).toBe(1);
  });
});
async function order(f:Fixture,quantity=1):Promise<FreightOrder> {
  const view=await f.market.freightView(f.id),region=view.regions.find(r=>r.regionId!==view.regionId)!;
  return {regionId:region.regionId,direction:'buy',refreshKey:region.refreshKey,carriageIds:view.state.equippedIds,rows:[{key:'trap:hunt_trap_low',quantity}]};
}
describe('跨城货运结算',()=>{
  it('全地区同时展示买卖价，混装共享50容量，库存与金币立即预扣且刷新后只交付一次',async()=>{
    const f=await setup(),view=await f.market.freightView(f.id);
    expect(view.regions.length).toBeGreaterThanOrEqual(10);
    expect(view.state.carriages).toHaveLength(1);
    const input=await order(f,25);input.rows.push({key:'trap:hunt_trap_mid',quantity:25});
    const region=view.regions.find(r=>r.regionId===input.regionId)!;
    const cost=25*region.listings.filter(l=>['hunt_trap_low','hunt_trap_mid'].includes(l.itemId)).reduce((n,l)=>n+l.price,0);
    expect(region.prices.find(p=>p.itemId==='hunt_trap_low')).toMatchObject({buy:expect.any(Number),sell:expect.any(Number)});
    await f.tx(()=>f.market.dispatchFreight(f.id,input));
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(1000000-cost);
    expect(await f.db.inventoryStacks.get(f.id+':hunt_trap_low')).toBeUndefined();
    const jobs=(await f.db.freightStates.get(f.id))!.jobs;
    await expect(f.tx(()=>f.market.dispatchFreight(f.id,input))).rejects.toThrow('空闲');
    f.clock.date=new Date(f.clock.date.getTime()+599999);await f.market.settleFreight(f.id);
    expect(await f.db.inventoryStacks.get(f.id+':hunt_trap_low')).toBeUndefined();
    f.clock.date=new Date(f.clock.date.getTime()+1);
    const reloaded=new MarketRepository(f.db,()=>f.clock.date);
    await Promise.all([reloaded.settleFreight(f.id),reloaded.settleFreight(f.id)]);
    expect(await f.db.inventoryStacks.get(f.id+':hunt_trap_low')).toMatchObject({quantity:25});
    expect(await f.db.inventoryStacks.get(f.id+':hunt_trap_mid')).toMatchObject({quantity:25});
    expect((await f.db.freightStates.get(f.id))!.jobs[0]!.deliveredAt).toBe(jobs[0]!.arrivesAt);
  });
  it('超载与余额不足不消耗库存、货物、次数；货运写入失败同样完整回滚',async()=>{
    const f=await setup(),input=await order(f,51);
    const before=await f.db.freightStates.get(f.id);
    await expect(f.tx(()=>f.market.dispatchFreight(f.id,input))).rejects.toThrow('容量');
    input.rows[0]!.quantity=2;
    await f.db.playerStates.update(f.id,{gold:0});
    await expect(f.tx(()=>f.market.dispatchFreight(f.id,input))).rejects.toThrow('金币不足');
    expect(await f.db.freightStates.get(f.id)).toEqual(before);
    expect((await f.market.view(f.id,input.regionId)).listings.find(l=>l.key===input.rows[0]!.key)!.stock).toBe(1000);
    await f.db.playerStates.update(f.id,{gold:1000000});
    vi.spyOn(f.db.freightStates,'put').mockResolvedValueOnce(f.id).mockRejectedValueOnce(new Error('dispatch-write-failure'));
    await expect(f.tx(()=>f.market.dispatchFreight(f.id,input))).rejects.toThrow('dispatch-write-failure');
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(1000000);
    expect((await f.market.view(f.id,input.regionId)).listings.find(l=>l.key===input.rows[0]!.key)!.stock).toBe(1000);
  });
  it('每日买卖合并计数，费用为0/0/0/500/1000/2000/2000，设备本地零点重置',async()=>{
    const f=await setup(),fees:number[]=[];
    for(let n=0;n<7;n++) {
      const input=await order(f);
      if(n%2===1) {input.direction='sell';input.rows=[{key:'item:hunt_trap_low',quantity:1}];}
      const before=(await f.db.playerStates.get(f.id))!.gold;
      await f.tx(()=>f.market.dispatchFreight(f.id,input));
      const job=(await f.db.freightStates.get(f.id))!.jobs.at(-1)!;fees.push(job.fee);
      if(input.direction==='sell') expect((await f.db.playerStates.get(f.id))!.gold).toBe(before-job.fee);
      f.clock.date=new Date(f.clock.date.getTime()+600000);await f.market.settleFreight(f.id);
      if(input.direction==='sell') expect((await f.db.playerStates.get(f.id))!.gold).toBe(before-job.fee+job.saleGold);
    }
    expect(fees).toEqual([0,0,0,500,1000,2000,2000]);
    f.clock.date=new Date(2026,8,8,0,0);const next=await f.market.freightView(f.id);
    expect(next.nextFee).toBe(0);expect(next.state.dispatchCount).toBe(0);
    expect(next.state.dayKey).toBe(freightDayKey(f.clock.date));
  });
  it('三种马车价格与容量正确，最多装配六辆，运输中不能卸下',async()=>{
    const f=await setup();
    for(const tier of ['ordinary','medium','advanced','ordinary','ordinary','ordinary'] as const) await f.tx(()=>f.market.buyCarriage(f.id,tier));
    let state=(await f.db.freightStates.get(f.id))!;
    expect(state.carriages).toHaveLength(7);expect(state.equippedIds).toHaveLength(6);
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(880000);
    await expect(f.tx(()=>f.market.configureFleet(f.id,state.carriages.map(c=>c.id)))).rejects.toThrow('6');
    const input=await order(f);input.carriageIds=[state.equippedIds[0]!];await f.tx(()=>f.market.dispatchFreight(f.id,input));
    await expect(f.tx(()=>f.market.configureFleet(f.id,state.equippedIds.slice(1)))).rejects.toThrow('运输中');
    state=(await f.db.freightStates.get(f.id))!;
    const fleet=[state.equippedIds[0]!,state.carriages[6]!.id];
    await f.tx(()=>f.market.configureFleet(f.id,fleet));
    expect((await f.db.freightStates.get(f.id))!.equippedIds).toEqual(fleet);
  });
});
describe('捕兽夹',()=>{
  it.each(HUNTING_TRAPS)('$name按精确失败边界判定并且每次只消耗一个',async(trap)=>{
    const f=await setup();
    for(const [roll,outcome] of [[0,'failure'],[trap.failMax,'failure'],[trap.failMax+1,'success'],[80,'success'],[81,'battle'],[100,'battle']] as const) {
      await f.db.gatheringStates.delete(f.id+':hunting-pending');
      await f.db.inventoryStacks.put({id:f.id+':'+trap.id,profileId:f.id,itemId:trap.id,name:trap.name,quantity:2,updatedAt:Date.now()});
      const repo=new GatheringRepository(f.db,{random:()=>roll/101+0.00001});
      const result=await f.tx(()=>repo.hunt(f.id,'mixed_tracks',trap.id));
      expect(result.data).toMatchObject({roll,outcome});
      expect((await f.db.inventoryStacks.get(f.id+':'+trap.id))!.quantity).toBe(1);
    }
  });
  it('没有夹子时不掷骰，不扣钱；本地和跨城报价都使用当前区域系数',async()=>{
    const f=await setup(),random=vi.fn(()=>0.9),repo=new GatheringRepository(f.db,{random});
    await expect(f.tx(()=>repo.hunt(f.id,'mixed_tracks'))).rejects.toThrow('捕兽夹');expect(random).not.toHaveBeenCalled();
    const regions=(await f.market.freightView(f.id)).regions;
    expect(new Set(regions.map(r=>r.listings.find(l=>l.itemId==='hunt_trap_low')!.price)).size).toBeGreaterThan(1);
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(1000000);
  });
});
describe('手动完成剧情节点',()=>{
  it('推进一节点并拒绝旧请求，最后节点自动发奖一次，旧AI结果不能覆盖手动进度',async()=>{
    const f=await setup(),repo=new QuestProgressRepository(f.db);
    const original=QuestCatalog.parse(catalogJson).get('side_flora_says')!;
    const node=original.nodes[0]!;
    const definition={...original,id:'manual-test',minimumLevel:1,startNodeId:'first',nodes:[
      {...node,id:'first',stage:0,transitions:[{id:'next',to:'last',authority:'judge' as const,condition:'完成',minConfidence:0.9}]},
      {...node,id:'last',stage:1,transitions:[{id:'finish',to:'done',authority:'local' as const,condition:'完成',minConfidence:0.9,localTrigger:{type:'confirm' as const}}]},
      {...node,id:'done',stage:2,status:'ready' as const,transitions:[]},
    ],rewards:{default:{experience:10,gold:1234,guildExperience:5,collectibles:['节点纪念']},endings:{}}};
    const quest=await repo.acceptDefinition(f.id,definition);
    const baseline=initialQuestProgress(definition);
    await repo.selectQuest(f.id,quest.id,baseline);
    const first={questId:quest.id,expectedNodeId:'first',expectedRevision:0};
    expect(manualQuestChoices(definition,baseline)).toHaveLength(1);
    expect(await repo.completeNode(f.id,definition,first)).toEqual({});
    await expect(repo.completeNode(f.id,definition,first)).rejects.toThrow('已变化');
    await repo.bindFloor(f.id,{questId:quest.id,floor:{id:'late',index:100,role:'assistant',fingerprint:'late',lineageHash:'late'},summary:'过时的AI结果',next:baseline,baseline,expectedNodeId:'first',expectedManualRevision:0,judgeResult:{}});
    expect((await repo.getTracker(f.id,quest.id))!.current.currentNodeId).toBe('last');
    const last={questId:quest.id,expectedNodeId:'last',expectedRevision:1};
    const before=(await f.db.playerStates.get(f.id))!.gold;
    const result=await repo.completeNode(f.id,definition,last);
    expect(result.completion).toMatchObject({gold:1234,experience:10,guildExperience:5});
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(before+1234);
    expect(await f.db.questRecords.get(quest.id)).toBeUndefined();
    expect(await f.db.questHistory.get(quest.id)).toBeDefined();
    await expect(repo.completeNode(f.id,definition,last)).rejects.toThrow();
    expect((await f.db.playerStates.get(f.id))!.gold).toBe(before+1234);
    expect(await f.db.specialCollectibles.where('profileId').equals(f.id).count()).toBe(1);
  });
});
