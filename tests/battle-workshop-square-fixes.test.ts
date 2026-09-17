import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import { afterEach, expect, it } from 'vitest';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { EventBus } from '@/kernel/event-bus';
import { saveWorkshopPack, normalizeWorkshopCard } from '@/workshop';
import { DEFAULT_STAR_SCALING } from '@/workshop-stars';
import { MarketRepository } from '@/storage/repositories/market-repository';
import { HUNTING_TRAPS } from '@/content/hunting-traps';
import { battleCardText } from '@/battle/presentation';
import { cardFormulaChoices, renderCardDescription } from '@/card-description';
import { emptyWorkshopObjectCatalog } from '@/workshop-object-catalog';
import { nativeStatusEntries } from '@/battle/status-presentation';
import * as core from '@/battle/rework/runtime/api.mjs';
import type { LocalBattleState } from '@/domain/types';
const databases:CaelianDatabase[]=[];
afterEach(async()=>{localStorage.clear();for(const db of databases){db.close();await db.delete();}databases.length=0;});
export function testPack() {
 const cards=Array.from({length:8},(_,i)=>({id:'custom_fix_card_'+i,name:'回归牌'+i,type:'skill',cost:0,description:'造成{{伤害}}伤害，获得{{护盾名称}}。',descriptionBindings:[{kind:'formula',label:'伤害',expression:{op:'add',args:[20,{op:'mul',args:[{op:'stat',key:'attack'},1.5]}]}},{kind:'name',label:'护盾名称',objectKind:'statuses',objectId:'strength'}],starScaling:DEFAULT_STAR_SCALING,effects:[{type:'shield',value:1,target:'self'}]}));
 return {format:'caelian_workshop_class_pack',version:1,classes:[{id:'custom_class_regression_fix',main:'freelance',name:'回归职业',talent:{name:'扩容',effects:[{type:'hand_limit_bonus',value:15}]},cards,cardPool:[...cards,...cards].map(c=>c.id),starterDeck:Array.from({length:15},(_,i)=>cards[i%8]!.id)}]};
}
it('真实战斗保留 25 张手牌上限，最多生成四个敌人，投影与读档不回退',async()=>{
 const pack=saveWorkshopPack(testPack());refreshWorkshopProfessionCatalogs();const db=new CaelianDatabase('alpha','fix-'+crypto.randomUUID());databases.push(db);const repo=new GameRepository(db,new EventBus());const p=await repo.ensureProfile('fix');let seq=0;
 const run=async(type:string,payload:unknown)=>{const r=await repo.execute(p.id,{id:'fix-'+seq++,type,payload} as any);expect(r.status,JSON.stringify(r)).toBe('applied');};
 await run('player.create',{name:'测试',classMain:'freelance',subclass:pack.classes[0]!.id});
 await run('battle.start',{monsterId:'mon_slime',count:12});
 const session=(await repo.snapshot(p.id)).battle!;expect(session.state.enemies).toHaveLength(4);expect(session.state.player.handLimit).toBe(25);
 const g=core.hydrate(session.state.rework);g.player.hand=[];g.player.deck=Array.from({length:30},(_,i)=>({id:pack.classes[0]!.cards[i%8]!.id,uid:'large-hand-'+i,legacy:true,ap:0,star:1,effects:[]}));g.controller.draw(g,25,false);core.project(g,session.state);
 expect(session.state.player.hand).toHaveLength(25);await db.battleSessions.put(session);
 const reloaded=new GameRepository(db,new EventBus()), saved=(await reloaded.snapshot(p.id)).battle!.state;const restored=core.hydrate(saved.rework);core.syncExternal(restored,saved);core.project(restored,saved);expect(saved.player.handLimit).toBe(25);expect(saved.player.hand).toHaveLength(25);
 const card=pack.classes[0]!.cards[0]!;const before=JSON.stringify(saved);const text=battleCardText(card,1,saved,{attack:1,defense:1,hpMax:100,targetHpMax:100});expect(text).not.toContain('{{');expect(text).not.toContain('strength');expect(text).not.toContain('使用此技能');expect(JSON.stringify(saved)).toBe(before);
});
it('动态说明完整保存，公式读取实时属性，名字引用显示中文',()=>{
 const card=normalizeWorkshopCard({...testPack().classes[0]!.cards[0],description:'作者长说明'.repeat(30)+'：{{伤害}}；{{护盾名称}}'},'custom_class_regression_fix',0);
 expect(card.description.length).toBeGreaterThan(90);expect(card.descriptionBindings).toHaveLength(2);
 const objects=emptyWorkshopObjectCatalog();objects.statuses.push({id:'strength',name:'力量',group:'增益'});
 expect(renderCardDescription(card,objects)).toContain('力量');expect(renderCardDescription(card,objects)).not.toContain('strength');
 const state={player:{attack:100,hp:100,hpMax:100,shield:0,speed:1,classResources:{}},enemies:[],selectedTarget:0} as unknown as LocalBattleState;
 expect(battleCardText(card,1,state,{attack:100,defense:0,hpMax:100,targetHpMax:100})).toContain('170');
 expect(battleCardText(card,1,state,{attack:200,defense:0,hpMax:100,targetHpMax:100})).toContain('320');
});
it('快捷公式按作者的固定值与倍率星级分别换算，护盾伤害不误用旧 value',()=>{
 const card=normalizeWorkshopCard({name:'星级',description:'{{伤害1}} / {{护盾伤害2}}',type:'skill',cost:0,starScaling:{version:1,levels:[{flat:1,ratio:1},{flat:2,ratio:3},{flat:3,ratio:4}]},effects:[{type:'damage',value:20,scaling:{stat:'attack',percent:50}},{type:'damage_from_shield',ratio:.5,value:999}]},'custom_class_regression_fix',0);
 card.descriptionBindings=cardFormulaChoices(card);const state={player:{hp:100,hpMax:100,shield:80,speed:1},enemies:[],selectedTarget:0} as unknown as LocalBattleState;
 expect(battleCardText(card,2,state,{attack:100,defense:0,hpMax:100,targetHpMax:100})).toBe('190 / 40');
});
it('捕兽夹可购买但无法从普通出售或货运报价出售，拒绝后库存和金币不变',async()=>{
 const db=new CaelianDatabase('alpha','traps-'+crypto.randomUUID());databases.push(db);const repo=new GameRepository(db,new EventBus()),p=await repo.ensureProfile('traps');
 for(const trap of HUNTING_TRAPS)await db.inventoryStacks.put({id:p.id+':'+trap.id,profileId:p.id,itemId:trap.id,name:trap.name,quantity:5,updatedAt:Date.now()});
 const market=new MarketRepository(db),view=await market.view(p.id);expect(view.sellItems.filter(row=>row.itemId.startsWith('hunt_trap'))).toEqual([]);expect(view.listings.some(row=>row.itemId==='hunt_trap_low')).toBe(true);
 const before=await db.playerStates.get(p.id);for(const trap of HUNTING_TRAPS)await expect(market.sellItem(p.id,{itemId:trap.id,quantity:5})).rejects.toThrow('不可出售');
 expect(await db.playerStates.get(p.id)).toEqual(before);expect((await db.inventoryStacks.get(p.id+':hunt_trap_low'))?.quantity).toBe(5);
 const freight=await market.freightView(p.id);expect(freight.regions.flatMap(r=>r.prices).filter(p=>p.itemId.startsWith('hunt_trap')).every(p=>p.sell===null)).toBe(true);
});
it('零层自定义状态不展示，存在的无数值标记仍展示',()=>{
 const actor={phaseCount:1,buffs:[{status:'custom',value:0,ruleData:{layers:0}},{status:'flag',value:0,remaining:2},{status:'custom',value:2,ruleData:{layers:2}}],debuffs:[],dots:[]};
 expect(nativeStatusEntries(actor,'buff').map(r=>r.name)).toEqual(['flag','custom']);
});
