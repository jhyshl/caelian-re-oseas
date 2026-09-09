import {afterEach, describe, expect, it} from 'vitest';
import {loadCommissionSources} from '@/content/catalogs/commissions';
import {dailyCommissionBoard} from '@/guild-commissions';
import {localDayKey, nextLocalMidnight} from '@/daily-refresh';
import regions from '@/content/generated/world/regions.json';
import {CaelianDatabase} from '@/storage/database';
import {GameRepository} from '@/storage/repository';
import {GuildRepository} from '@/storage/repositories/guild-repository';
import {EventBus} from '@/kernel/event-bus';
import type {GuildTaskDefinition} from '@/content/catalogs/guild';
const access=regions.map(r=>({id:r.id,profileId:'test',regionId:r.id,accessible:true,unlockCondition:'',updatedAt:1}));
const databases:CaelianDatabase[]=[];
afterEach(async()=>{for(const db of databases.splice(0)){db.close();await db.delete();}});
const input=(task:GuildTaskDefinition)=>({taskId:task.id!,title:'伪造标题',region:task.region,objective:'',totalStages:999,rewardExperience:999999,rewardGold:999999,rewardGuildExperience:999999,minimumLevel:1});

describe('本地零点城市委托',()=>{
  it('本地日历在零点切日，集市的8/12/16/20点与剧情时间不触发刷新',()=>{
    expect(localDayKey(new Date(2026,8,9,23,59,59))).toBe('2026-09-09');
    expect(localDayKey(new Date(2026,8,10,0,0,0))).toBe('2026-09-10');
    for (const hour of [0,8,12,16,20,23]) expect(localDayKey(new Date(2026,8,9,hour))).toBe('2026-09-09');
    expect(nextLocalMidnight(new Date(2026,11,31,23)).getTime()).toBe(new Date(2027,0,1).getTime());
  });
  it('各城市各4项、固定一天且跨日换新，目标全部来自现有数据库',async()=>{
    const sources=await loadCommissionSources(),first=dailyCommissionBoard(sources,access,'2026-09-09');
    expect(dailyCommissionBoard(sources,access,'2026-09-09')).toEqual(first);
    expect(dailyCommissionBoard(sources,access,'2026-09-10')).not.toEqual(first);
    const actualItems=new Set([...sources.recipes.map(r=>r.output),...Object.values(sources.markets).flatMap(rows=>rows.map(r=>r.name)),...Object.values(sources.gather).flat(),...Object.values(sources.monsters).flatMap(m=>(m.loot??[]).map(l=>l.name||l.id))]);
    const products=new Set(sources.recipes.map(r=>r.output));
    let ordinary=0,crafted=0,lootCount=0;const amounts=new Set<number>(),kinds=new Set<number>();
    for (let day=1;day<=40;day++) {
      const board=dailyCommissionBoard(sources,access,`2026-08-${day}`);
      for (const region of regions) {
        const city=board.filter(t=>t.region===region.name);expect(city).toHaveLength(4);
        expect(new Set(city.map(t=>t.id)).size).toBe(4);
        expect(new Set(city.map(t=>`${t.name}:${t.desc}`)).size).toBe(4);
      }
      for (const task of board) {
        if (task.type==='escort') { expect(task.destination).not.toBe(task.region);expect(regions.some(r=>r.name===task.destination)).toBe(true); }
        if (task.type==='combat'||task.type==='combat_gather') expect(Object.values(sources.monsters).some(m=>m.name===task.target)).toBe(true);
        if (!task.items) continue;
        kinds.add(task.items.length);expect(task.items.length).toBeGreaterThanOrEqual(1);expect(task.items.length).toBeLessThanOrEqual(3);
        expect(new Set(task.items.map(i=>i.itemId)).size).toBe(task.items.length);
        for (const item of task.items) { expect(actualItems.has(item.itemId),item.itemId).toBe(true);expect(item.count).toBeGreaterThanOrEqual(5);expect(item.count).toBeLessThanOrEqual(20);amounts.add(item.count); }
        if(task.type==='combat_gather') { lootCount++;const monster=Object.values(sources.monsters).find(m=>m.name===task.target)!;expect(task.items.every(i=>monster.loot!.some(l=>(l.name||l.id)===i.itemId))).toBe(true); }
        else { ordinary++;if(task.items.every(i=>products.has(i.itemId)))crafted++; }
      }
    }
    expect([...kinds].sort()).toEqual([1,2,3]);expect(amounts.size).toBe(16);expect(lootCount).toBeGreaterThan(0);
    expect(crafted/ordinary).toBeGreaterThan(.75);expect(crafted).toBeLessThan(ordinary);
  });
  it('跨日只换告示板，旧任务可继续提交；新任务不能冒用旧ID或刷奖励',async()=>{
    const db=new CaelianDatabase('alpha','daily-'+crypto.randomUUID());databases.push(db);
    const game=new GameRepository(db,new EventBus()),profile=await game.ensureProfile('daily');
    await game.execute(profile.id,{id:crypto.randomUUID(),type:'player.create',payload:{name:'测试',classMain:'knight',subclass:'holy_knight'}});
    await db.playerStates.update(profile.id,{level:100});
    await db.regionAccess.where('profileId').equals(profile.id).modify({accessible:true});
    let now=new Date(2026,8,9,23,59);const guild=new GuildRepository(db,()=>now);
    const board=await guild.refreshCommissions(profile.id),task=board.find(t=>t.type==='gather')!;
    await db.worldStates.update(profile.id,{region:task.region,location:task.region});
    const tx=<T>(fn:()=>Promise<T>)=>db.transaction('rw',db.tables,fn);
    await tx(()=>guild.acceptCommission(profile.id,input(task)));
    const quest=(await db.questRecords.toArray())[0]!;
    expect(quest).toMatchObject({title:task.name,rewardGold:task.gold,commissionItems:task.items,totalStages:task.count});
    await db.worldStates.update(profile.id,{date:'剧情第999年'} as any);
    expect(await guild.refreshCommissions(profile.id)).toEqual(board);
    now=new Date(2026,8,10,0,0);const next=await guild.refreshCommissions(profile.id);
    expect(next).not.toEqual(board);expect(await db.questRecords.get(quest.id)).toEqual(quest);
    await expect(tx(()=>guild.acceptCommission(profile.id,input(task)))).rejects.toThrow('零点刷新');
    for(const item of task.items!) await db.inventoryStacks.put({id:profile.id+':'+item.itemId,profileId:profile.id,itemId:item.itemId,name:item.itemId,quantity:item.count,updatedAt:now.getTime()});
    await tx(()=>guild.progressCommission(profile.id,quest.id));await tx(()=>guild.completeCommission(profile.id,quest.id));
    expect(await db.inventoryStacks.count()).toBe(0);expect(await db.questHistory.get(quest.id)).toBeTruthy();
    const fresh=next.find(t=>t.region===task.region)!;
    await db.questHistory.put({id:profile.id+':commission:'+fresh.id,profileId:profile.id,kind:'commission',title:fresh.name,definitionId:fresh.id,rewardExperience:0,rewardGold:0,rewardGuildExperience:0,completedDate:now.toISOString(),updatedAt:now.getTime()});
    await expect(tx(()=>guild.acceptCommission(profile.id,input(fresh)))).rejects.toThrow('今日已完成');
  });
});
