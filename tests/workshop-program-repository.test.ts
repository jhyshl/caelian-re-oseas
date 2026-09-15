import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopMechanism, WORKSHOP_MECHANISM_FORMAT, workshopStatusKey } from '@/workshop-mechanisms';
import { emptyStatusProgram } from '@/workshop-status-program';
import { grantCard } from '@/battle/card-inventory';
import { saveWorkshopPack } from '@/workshop';
import { DEFAULT_STAR_SCALING } from '@/workshop-stars';
import { emptyRuleProgram, type RuleProgram, type RuleStep } from '@/workshop-program';
import { WORKSHOP_RULE_EXAMPLES } from '@/workshop-program-templates';
import * as api from '@/battle/rework/runtime/api.mjs';
const databases:CaelianDatabase[]=[];
afterEach(async()=>{localStorage.clear();await Promise.all(databases.splice(0).map(async db=>{db.close();await db.delete();}));});
function program(steps:RuleStep[]):RuleProgram {const p=emptyRuleProgram();p.rules[0]!.steps=steps;return p;}
async function fixture(programs:RuleProgram[],talent?:RuleProgram,dummyCount=1,battleOnly=false,targets:Record<number,string>={}){
 const cards=Array.from({length:8},(_,i)=>({id:'custom_card_rule_'+i,name:'组合卡'+i,type:'skill',cost:1,starScaling:DEFAULT_STAR_SCALING,effects:[{type:'rule_program',target:targets[i]??'enemy',program:programs[i]??program([{type:'shield',target:'self',value:1}])}]}));
 if(battleOnly)cards.push({...cards[0]!,id:'custom_card_special',name:'战斗专用牌',battleOnly:true} as typeof cards[number]);
 const ordinary=cards.filter(c=>c.id!=='custom_card_special');
 const pack=saveWorkshopPack({format:'caelian_workshop_class_pack',version:1,packName:'通用规则验收',classes:[{id:'custom_class_program_host',main:'freelance',name:'组合师',talent:{name:'规则天赋',description:'',effects:talent?[{type:'rule_program',program:talent}]:[]},cards,cardPool:[...ordinary,...ordinary].map(c=>c.id),starterDeck:Array.from({length:15},(_,i)=>cards[i%8]!.id)}]});
 const db=new CaelianDatabase('alpha','rule-v2-'+crypto.randomUUID());databases.push(db);let game=new GameRepository(db,new EventBus());const profile=await game.ensureProfile('chat:'+crypto.randomUUID());let sequence=0;
 const command=async(type:string,payload:any)=>game.execute(profile.id,{id:'rule-command:'+sequence++,type,payload} as any);
 const run=async(type:string,payload:any)=>{const out=await command(type,payload);expect(out.status,JSON.stringify(out)).toBe('applied');};
 await run('player.create',{name:'组合测试',classMain:'knight',subclass:'holy_knight'});
 await run('battle.start',{workshopTest:{professionId:pack.classes[0]!.id,attributes:{hpMax:0,mpMax:0,attack:0,defense:0,speed:0,actionPointsPerTurn:0},dummyCount,dummyHp:10000,dummyAttack:0,dummyDefense:0,dummyInvincible:false,dummyAttackEnabled:false,autoRespawn:false,playerInvincible:false}});
 const first=(await db.battleSessions.where('profileId').equals(profile.id).first())!;
 const read=async()=> (await db.battleSessions.get(first.id))!;
 const prime=async(indices:number[],stars=1)=>{const session=await read(),g=api.hydrate(session.state.rework);g.player.hp=400;g.player.maxHp=1000;g.player.ap=g.player.apMax=10;g.player.stats.attack=100;g.player.stats.defense=0;g.player.stats.speed=10000;g.player.stats.crit=0;g.player.stats.ehr=80;g.player.hand=indices.map((index,i)=>({id:pack.classes[0]!.cards[index]!.id,uid:'test-card:'+i,legacy:true,ap:1,star:stars,effects:[]}));g.player.deck=[];g.player.discard=[];g.player.exhaust=[];for(const e of g.enemies){e.hp=e.maxHp=10000;e.stats.res=0;e.stats.defense=0;e.stats.speed=0;}api.project(g,session.state);await db.battleSessions.put(session);};
 const play=()=>run('battle.play-card',{battleId:first.id,handIndex:0,targetIndex:0});
 return {db,command,run,read,prime,play,battleId:first.id,reload:()=>{game=new GameRepository(db,new EventBus());}};
}
describe('组合规则正式仓库接线',()=>{
 it('己方选择可以把组合增益定向施加到玩家召唤物，读档后保留',async()=>{
  const summon=structuredClone(WORKSHOP_RULE_EXAMPLES[6]!);
  const shield=program([{type:'shield',target:'target',value:55}]);
  const f=await fixture([summon,shield],undefined,1,false,{1:'selected_allies'});
  await f.prime([0,1]);await f.play();
  const summoned=(await f.read()).state.player.summons[0]!;expect(summoned.id).toBeTruthy();
  await f.run('battle.play-card',{battleId:f.battleId,handIndex:0,targetIndex:0,allyTargetId:summoned.id});
  f.reload();const s=(await f.read()).state;
  expect(s.player.summons.find(p=>p.id===summoned.id)?.shield).toBe(55);expect(s.player.shield).toBe(0);expect(s.enemies[0]!.shield).toBe(0);
 });
 it('战斗专用牌不入职业卡池或永久库，可生成、读档使用并消耗',async()=>{
  const generator=program([{type:'card',operation:'generate',source:{op:'card_definition',key:'custom_card_special'},count:1,mode:'hand'}]);
  const f=await fixture([generator],undefined,1,true);await f.prime([0]);await f.play();
  let s=(await f.read()).state;expect(s.player.hand[0]!.cardId).toBe('custom_card_special');
  const profileId=(await f.read()).profileId;await grantCard(f.db,profileId,'custom_card_special');
  expect((await f.db.ownedCards.where('profileId').equals(profileId).toArray()).some(c=>c.cardId==='custom_card_special')).toBe(false);
  f.reload();await f.play();s=(await f.read()).state;expect(s.player.ap).toBe(8);expect(s.player.hand[0]!.cardId).toBe('custom_card_special');
  await f.db.battleSessions.update(f.battleId,{active:false});
  await expect(f.command('deck.update',{cardIds:Array(15).fill('custom_card_special')})).rejects.toThrow('战斗专用牌');
 });
 it('独立自定义状态使用完整规则，跨楼读档监听全场自定义DOT并增加已定义资源',async()=>{
  const custom=emptyStatusProgram();custom.statuses[0]!.turns=-1;
  const resource='workshop_resource:rule-state:meter';
  custom.statuses[0]!.rules=[{id:'count',event:'after_damage',eventScope:'all',priority:0,once:'never',condition:{op:'event',key:'dot'},costs:[],steps:[{type:'resource',key:resource,target:'self',value:{op:'event',key:'count'}}]}];
  saveWorkshopMechanism({format:WORKSHOP_MECHANISM_FORMAT,version:1,engine:'declarative',id:'rule-state',name:'统计状态',resources:[{id:'meter',label:'计数',min:0,max:100,initial:0,visible:true}],statuses:[{id:'tally',label:'结算统计',polarity:'buff',effects:[],program:custom}],rules:[]});
  const apply=program([{type:'apply_status',status:workshopStatusKey('rule-state','tally'),target:'self'}]);
  const dot=program([{type:'damage',mode:'dot',value:35,target:'target'}]);
  const f=await fixture([apply,dot]);await f.prime([0,1,1]);await f.play();f.reload();await f.play();await f.play();
  const s=(await f.read()).state;expect(s.workshopMechanisms?.resources['rule-state:meter']).toBe(2);
  expect(Object.values(s.player.buffs).some(b=>b.ruleLabel==='自定义状态')).toBe(true);expect(s.enemies[0]!.hp).toBe(9930);
 });
 it('旧式自定义状态的每回合失去生命也进入同一DOT统计事件',async()=>{
  saveWorkshopMechanism({format:WORKSHOP_MECHANISM_FORMAT,version:1,engine:'declarative',id:'legacy-tick',name:'旧式持续伤害',resources:[],statuses:[{id:'tick',label:'慢性伤害',polarity:'debuff',effects:[{type:'turn_damage',value:7}]}],rules:[]});
  const apply=program([{type:'apply_status',status:workshopStatusKey('legacy-tick','tick'),target:'target',turns:3}]);
  const talent=program([]);talent.rules=[{id:'count',event:'after_damage',eventScope:'all',priority:0,once:'never',condition:{op:'event',key:'dot'},costs:[],steps:[{type:'resource',key:'ticks',target:'self',value:{op:'event',key:'count'}}]}];
  const f=await fixture([apply],talent);await f.prime([0]);await f.play();await f.run('battle.end-turn',{battleId:f.battleId});
  const s=(await f.read()).state;expect(s.player.classResources?.ticks).toBe(1);expect(s.enemies[0]!.hp).toBe(9993);
 });
 it('通用状态组合经职业保存、正式出牌与读档执行，排除原目标并准确结算五层原伤害',async()=>{
  const setup=program([{type:'repeat',value:3,steps:[{type:'native_status',status:'poison',target:'target',value:.3,turns:3,maxStacks:0}]},{type:'repeat',value:2,steps:[{type:'native_status',status:'burn',target:'target',value:.5,turns:3,maxStacks:0}]}]);
  const spread=structuredClone(WORKSHOP_RULE_EXAMPLES.find(p=>p.id==='template.state_spread')!),detonate=structuredClone(WORKSHOP_RULE_EXAMPLES.find(p=>p.id==='template.state_detonate')!);
  const f=await fixture([setup,spread,detonate],undefined,3);await f.prime([0,1,2]);await f.play();f.reload();await f.play();
  let g=api.hydrate((await f.read()).state.rework);expect(g.enemies[0].dots).toHaveLength(5);for(const enemy of g.enemies.slice(1))expect(enemy.dots.map((d:any)=>d.status)).toEqual(['poison','burn']);
  f.reload();await f.play();const state=(await f.read()).state;g=api.hydrate(state.rework);expect(g.enemies[0].hp).toBe(9810);expect(g.enemies[0].dots).toHaveLength(0);expect(g.enemies[1].dots).toHaveLength(2);expect(state.player.ap).toBe(7);expect(state.workshopRuleTrace?.length).toBeGreaterThan(0);
 });
 it('天赋开场、卡牌实例 after_card、独立三星系数及读档均经真实命令执行',async()=>{
  const talent=program([{type:'resource',target:'self',key:'测试资源',value:3}]);talent.rules[0]!.event='battle_start';
  const card=program([{type:'damage',target:'target',value:{op:'add',args:[18,{op:'mul',args:[.45,{op:'stat',key:'attack',target:'self'}]}]},stars:[1,1.1,1.2],crit:false}]);
  card.rules.push({id:'after',event:'after_card',priority:0,once:'never',costs:[],steps:[{type:'resource',target:'self',key:'触发次数',value:1}]});
  const f=await fixture([card],talent);expect((await f.read()).state.player.classResources?.['测试资源']).toBe(3);await f.prime([0],3);await f.play();const s=(await f.read()).state;
  expect(s.player.ap).toBe(9);expect(s.enemies[0]!.hp,JSON.stringify({log:s.log.slice(-15),trace:api.hydrate(s.rework).player.flags.workshopPrograms.trace})).toBe(9925);expect(s.player.classResources?.['触发次数']).toBe(1);f.reload();expect((await f.read()).state.player.classResources?.['触发次数']).toBe(1);
 });
 it('生命之契挂在玩家身上后，后续治疗卡和读档使用同一剩余额度',async()=>{
  const contract=structuredClone(WORKSHOP_RULE_EXAMPLES[0]!);contract.rules[0]!.steps[0]!.target='self';
  const f=await fixture([contract,program([{type:'heal',target:'self',value:150}])]);await f.prime([0,1,1]);await f.play();await f.play();let s=(await f.read()).state;
  expect(s.player.hp).toBe(400);const effect=Object.values(s.player.buffs).find(x=>x.ruleLabel==='生命之契');expect(effect?.ruleData?.remaining).toBe(50);f.reload();await f.play();s=(await f.read()).state;expect(s.player.hp).toBe(500);expect(Object.values(s.player.buffs).some(x=>x.ruleLabel==='生命之契')).toBe(false);expect(s.player.ap).toBe(7);
 });
 it('召唤物由结束回合驱动条件优先级，不依赖手动调用阶段接口',async()=>{
  const f=await fixture([structuredClone(WORKSHOP_RULE_EXAMPLES[6]!)]);await f.prime([0]);await f.play();await f.run('battle.end-turn',{battleId:f.battleId});const s=(await f.read()).state;const g=api.hydrate(s.rework),pet=g.allies.find((a:any)=>a.ruleSummon);expect(pet.lastActionRound).toBe(1);expect(pet.flags).toBeDefined();expect(g.player.flags.workshopPrograms.trace.some((e:any)=>e.message.startsWith('使用已有状态效果'))).toBe(true);
 });
 it('付不起额外代价会拒绝整次出牌，AP、手牌和生命均不改变',async()=>{
  const p=program([{type:'damage',target:'target',value:999}]);p.rules[0]!.costs=[{type:'hp',target:'self',value:500}];const f=await fixture([p]);await f.prime([0]);const before=(await f.read()).state;
  await expect(f.command('battle.play-card',{battleId:f.battleId,handIndex:0,targetIndex:0})).rejects.toThrow('资源不足');const after=(await f.read()).state;expect(after.player.ap).toBe(before.player.ap);expect(after.player.hp).toBe(before.player.hp);expect(after.player.hand).toEqual(before.player.hand);expect(after.enemies[0]!.hp).toBe(before.enemies[0]!.hp);
 });
 it('修改卡牌费用在实例上保持，读档后仍按修改费用打出',async()=>{
  const setup=program([{type:'card',pile:'hand',operation:'cost',value:0,count:1}]);const f=await fixture([setup,program([{type:'shield',target:'self',value:20}])]);await f.prime([0,1]);await f.play();expect((await f.read()).state.player.hand[0]!.ruleCost).toBe(0);f.reload();await f.play();expect((await f.read()).state.player.ap).toBe(9);
 });
 it('生成原生职业卡后，读档仍能进入正确出牌入口并结算AP与伤害',async()=>{
  const f=await fixture([program([{type:'card',operation:'generate',key:'th_spark_arc',count:1,mode:'hand'}])]);await f.prime([0]);await f.play();expect((await f.read()).state.player.hand[0]!.cardId).toBe('th_spark_arc');f.reload();await f.play();const s=(await f.read()).state;expect(s.player.ap).toBe(8);expect(s.enemies[0]!.hp).toBeLessThan(10000);expect(s.player.discardPile.some(c=>c.cardId==='th_spark_arc')).toBe(true);
 });
 it('复制得到独立实例，变形成另一自定义卡后正确结算',async()=>{
  const setup=program([{type:'card',operation:'copy',pile:'hand',count:1,mode:'hand'},{type:'card',operation:'transform',pile:'hand',count:1,value:'custom_card_rule_2'}]);const f=await fixture([setup,program([{type:'shield',target:'self',value:20}]),program([{type:'heal',target:'self',value:30}])]);await f.prime([0,1]);await f.play();let s=(await f.read()).state;expect(s.player.hand).toHaveLength(2);expect(new Set(s.player.hand.map(c=>c.instanceId)).size).toBe(2);expect(s.player.hand[0]!.cardId).toBe('custom_card_rule_2');await f.play();s=(await f.read()).state;expect(s.player.hp).toBe(430);
 });
});
