import { describe, expect, it } from 'vitest';
import { actor, makeGame } from '@/battle/rework/runtime/physics.mjs';
import { createPlayerController } from '@/battle/rework/runtime/common-player.mjs';
import { snapshot, hydrate } from '@/battle/rework/runtime/api.mjs';
import { installWorkshopPrograms } from '@/battle/workshop-program-runtime';
import { emptyRuleProgram, normalizeRuleProgram, type RuleExpression, type RuleStep, type RuleStatus } from '@/workshop-program';
import { WORKSHOP_RULE_EXAMPLES } from '@/workshop-program-templates';
function fixture(){
 const stats={hp:10000,attack:100,defense:0,speed:100,crit:100,critDamage:250,ehr:80,res:0};
 const p=actor('player','player',20,stats),a=actor('a','enemy',20,stats),b=actor('b','enemy',20,stats),c=actor('c','enemy',20,stats),g=makeGame(p,[a,b,c],{trace:true});
 p.ap=p.apMax=10;p.drawCount=3;g.round=1;g.phase='player';g.controller=createPlayerController();g.controller.init(g,{id:'custom'},[]);
 return {g,p,a,b,c,r:installWorkshopPrograms(g,[])};
}
const item=(key:string):RuleExpression=>({op:'item',key}),record=(key:string):RuleExpression=>({op:'var',key,scope:'local'});
const states=(target='selected_target',types?:string[]):RuleExpression=>({op:'statuses',key:'dot',target,...(types?{types}:{})});
function program(steps:RuleStep[]){const p=emptyRuleProgram();p.rules[0]!.steps=steps;return normalizeRuleProgram(p);}
const example=(id:string)=>normalizeRuleProgram(WORKSHOP_RULE_EXAMPLES.find(p=>p.id===id)!);
function readResult(r:any,p:any,a:any,expression:RuleExpression){const rule=program([{type:'set',key:'test',value:expression}]);r.cast(rule,p.id,a.id);return p.flags.workshopPrograms.trace.at(-1).message;}
const definition=(extra:Partial<RuleStatus>={}):RuleStatus=>({id:'heat',name:'热伤',polarity:'debuff',turns:3,stacking:'add',cleanseable:true,dispellable:true,baseChance:100,data:{power:.2},rules:[],modifiers:[{status:'burn',value:{op:'var',scope:'status',key:'power'},unit:'ratio'}],...extra});

describe('通用列表与状态积木',()=>{
 it('逐项遍历单位时初始化各目标的声明数据，保留最初选中目标并支持深渊 DOT',()=>{
  const {r,p,a,b,c}=fixture(),rule=program([{type:'foreach_item',value:{op:'targets',key:'enemies',excludeSelected:true},steps:[{type:'add',scope:'target',key:'hits',value:1},{type:'shield',target:'target',value:{op:'var',scope:'target',key:'hits'}}]}]);
  rule.variables=[{name:'hits',scope:'target',initial:5}];r.cast(rule,p.id,a.id);expect(a.shield).toBe(0);expect(b.shield).toBe(6);expect(c.shield).toBe(6);
  r.nativeStatus(p,a,'abyss',.3,3);r.cast(example('template.state_spread'),p.id,a.id);expect(b.dots[0].status).toBe('abyss');expect(c.dots[0].snapshotDamage).toBe(35);
 });
 it('扩散示例仅由通用积木组成，按原目标已有种类施加并排除原目标',()=>{
  const {r,p,a,b,c}=fixture();for(let i=0;i<3;i++)r.nativeStatus(p,a,'poison',.3,5,100,1,{maxStacks:0});r.nativeStatus(p,a,'burn',.5,2);
  r.cast(example('template.state_spread'),p.id,a.id);expect(a.dots).toHaveLength(4);
  for(const t of [b,c]){expect(t.dots.map((s:any)=>s.status)).toEqual(['poison','burn']);expect(t.dots.every((s:any)=>s.snapshotDamage===35)).toBe(true);}
 });
 it('引爆示例逐项读取原伤害，使用原等级计算防御和护盾后移除原列表',()=>{
  const {r,p,a}=fixture();for(let i=0;i<3;i++)r.nativeStatus(p,a,'poison',.3,3);for(let i=0;i<2;i++)r.nativeStatus(p,a,'burn',.5,2);
  a.stats.defense=200;a.shield=25;p.stats.attack=900;p.star=3;
  r.cast(example('template.state_detonate'),p.id,a.id,{star:3});expect(a.hp).toBe(9930);expect(a.shield).toBe(0);expect(a.dots).toHaveLength(0);
 });
 it('列表种类和自定义条件筛选、求和、最小最大值及去重可组合，空列表统计为零',()=>{
  const {r,p,a}=fixture();r.nativeStatus(p,a,'poison',.3,2);r.nativeStatus(p,a,'poison',.4,4);r.nativeStatus(p,a,'burn',.5,1);
  const filtered:RuleExpression={op:'filter_list',args:[states()],value:{op:'gt',args:[item('remaining'),1]}};
  expect(readResult(r,p,a,{op:'sum_list',args:[filtered],value:item('damage')})).toContain('70');
  expect(readResult(r,p,a,{op:'max_list',args:[filtered],value:item('damage')})).toContain('40');
  expect(readResult(r,p,a,{op:'min_list',args:[filtered],value:item('damage')})).toContain('30');
  expect(readResult(r,p,a,{op:'count',args:[{op:'unique',key:'type',args:[states()]}]})).toContain('2');
  expect(readResult(r,p,a,{op:'sum_list',args:[states('selected_target',[])],value:item('damage')})).toContain('0');
 });
 it('单位排序取两人、随机无重复抽取以及卡牌费用统计',()=>{
  const {r,p,a,b,c}=fixture();a.hp=8000;b.hp=1000;c.hp=3000;
  const targets:RuleExpression={op:'targets',key:'enemies'};
  r.cast(program([{type:'foreach',target:{op:'take',args:[{op:'sort_list',args:[targets],value:item('hp'),scope:'asc'},2]},steps:[{type:'shield',target:'target',value:50}]}]),p.id,a.id);
  expect(a.shield).toBe(0);expect(b.shield).toBe(50);expect(c.shield).toBe(50);
  const sample:RuleExpression={op:'sample',args:[targets,3]};expect(readResult(r,p,a,{op:'count',args:[{op:'unique',key:'self',args:[sample]}]})).toContain('3');
  p.hand=[{id:'x',uid:'one',ap:2,star:1},{id:'y',uid:'two',ap:3,star:2}];expect(readResult(r,p,a,{op:'sum_list',args:[{op:'card_items',key:'hand'}],value:item('cost')})).toContain('5');
 });
 it('修改持续回合、份数、原伤害与移除列表只影响被选中的实例',()=>{
  const {r,p,a}=fixture();r.nativeStatus(p,a,'poison',.3,2,100,1,{maxStacks:0});r.nativeStatus(p,a,'burn',.5,3);
  r.cast(program([{type:'modify_status',selection:states('selected_target',['poison']),field:'remaining',operation:'add',value:2},{type:'modify_status',selection:states('selected_target',['poison']),field:'damage',operation:'mul',value:2},{type:'modify_status',selection:states('selected_target',['poison']),field:'layers',operation:'set',value:3}]),p.id,a.id);
  const poison=a.dots.filter((s:any)=>s.status==='poison');expect(poison).toHaveLength(3);expect(poison.every((s:any)=>s.snapshotDamage===60&&s.remaining===4)).toBe(true);
  r.cast(program([{type:'remove_status',selection:states('selected_target',['poison'])}]),p.id,a.id);expect(a.dots.map((s:any)=>s.status)).toEqual(['burn']);
 });
 it('合并额度同步更新 DOT 原伤害，并支持保持、刷新、延长回合',()=>{
  for(const refresh of ['keep','refresh','extend'] as const){
   const {r,p,a,g}=fixture(),rule=program([]);rule.statuses=[definition({refresh})];r.applyStatus(rule,'heat',p,a);g.beginPhase(a);g.endPhase(a);
   expect(a.hp).toBe(9980);p.stats.attack=500;r.applyStatus(rule,'heat',p,a);
   expect(a.dots[0].snapshotDamage).toBe(40);expect(a.dots[0].remaining).toBe(refresh==='keep'?2:refresh==='refresh'?3:5);
   r.cast(program([{type:'modify_status',selection:{op:'statuses',key:'debuff',target:'selected_target',types:['heat']},field:'data.power',operation:'set',value:1}]),p.id,a.id);expect(a.dots[0].snapshotDamage).toBe(100);
  }
 });
 it('复制和转移状态保留原快照与回合，可重设时间；同一目标转移不丢失状态',()=>{
  const {r,p,a,b}=fixture();r.nativeStatus(p,a,'poison',.3,5);p.stats.attack=900;
  r.cast(program([{type:'copy_status',selection:states(),target:'b',operation:'copy',preserveSource:true}]),p.id,a.id);expect(a.dots).toHaveLength(1);expect(b.dots[0]).toMatchObject({snapshotDamage:30,remaining:5});
  r.cast(program([{type:'copy_status',selection:states(),target:'a',operation:'move'}]),p.id,a.id);expect(a.dots).toHaveLength(1);
  r.cast(program([{type:'copy_status',selection:states(),target:'b',operation:'move',preserveSource:false,turns:2}]),p.id,a.id);expect(a.dots).toHaveLength(0);expect(b.dots.some((s:any)=>s.snapshotDamage===270&&s.remaining===2)).toBe(true);
 });
 it('自定义复合状态复制后子效果独立计时，移除原父状态不影响副本',()=>{
  const {r,p,a,b,g}=fixture(),rule=program([]);rule.statuses=[definition({stacking:'independent'})];r.applyStatus(rule,'heat',p,a);
  r.cast(program([{type:'copy_status',selection:{op:'statuses',key:'debuff',target:'selected_target',types:['heat']},target:'b',operation:'copy'}]),p.id,a.id);
  expect(b.dots).toHaveLength(1);expect(b.dots[0].ruleParent).not.toBe(a.dots[0].ruleParent);
  r.cast(program([{type:'remove_status',selection:{op:'statuses',key:'debuff',target:'selected_target',types:['heat']}}]),p.id,a.id);expect(a.dots).toHaveLength(0);
  for(let i=0;i<3;i++){g.beginPhase(b);g.endPhase(b);}expect(b.hp).toBe(9940);expect(b.dots).toHaveLength(0);
 });
 it('不同卡牌共享数据，按目标和回合隔离记录，读档后仍保留',()=>{
  const {r,p,a,b,g}=fixture();const first=program([{type:'add',scope:'shared',key:'heat',value:2},{type:'add',scope:'target_turn',key:'hits',value:1}]);
  const second=program([{type:'shield',target:'self',value:{op:'var',scope:'shared',key:'heat'}},{type:'add',scope:'target_turn',key:'hits',value:1}]);
  r.cast(first,p.id,a.id);r.cast(second,p.id,a.id);expect(p.shield).toBe(2);
  r.cast(second,p.id,b.id);expect(p.flags.workshopPrograms.variables['shared:player:target:a:turn:1'].hits).toBe(2);expect(p.flags.workshopPrograms.variables['shared:player:target:b:turn:1'].hits).toBe(1);
  const loaded=hydrate(JSON.parse(JSON.stringify(snapshot(g)))),runtime=installWorkshopPrograms(loaded,[]);loaded.round=2;runtime.cast(second,p.id,a.id);expect(loaded.player.shield).toBe(6);expect(loaded.player.flags.workshopPrograms.variables['shared:player:target:a:turn:2'].hits).toBe(1);
 });
 it('延迟执行保留当前项和最初目标，列表清除不会误删后来新挂上的状态',()=>{
  const {r,p,a,b,g}=fixture();r.nativeStatus(p,a,'poison',.3,3);
  r.cast(program([{type:'foreach_item',value:states(),steps:[{type:'delay',turns:1,event:'turn_start',steps:[{type:'native_status',statusFrom:item('type'),target:{op:'targets',key:'enemies',excludeSelected:true},value:.2,turns:2,maxStacks:0}]}]}]),p.id,a.id);
  g.round=2;r.emit('turn_start',{sourceId:p.id,targetId:p.id});expect(a.dots).toHaveLength(1);expect(b.dots).toHaveLength(1);
  r.cast(program([{type:'set',key:'old',value:states()},{type:'native_status',status:'burn',value:.4,turns:2},{type:'remove_status',selection:record('old')}]),p.id,a.id);expect(a.dots.map((s:any)=>s.status)).toEqual(['burn']);
 });
 it('事件数据区分 DOT 和直接伤害，并记录实际数值',()=>{
  const {r,p,a,g}=fixture(),hook=program([]);hook.rules=[{id:'read',event:'after_damage',priority:0,once:'never',costs:[],steps:[{type:'add',scope:'shared',key:'dotHits',value:{op:'event',key:'dot'}},{type:'set',scope:'shared',key:'lastAmount',value:{op:'event',key:'hpDamage'}}]}];r.roots=[{program:hook}];
  r.nativeStatus(p,a,'poison',.3,2);g.beginPhase(a);g.endPhase(a);
  // Boolean events are useful in conditions, not numeric arithmetic.
  expect(p.flags.workshopPrograms.variables['shared:player'].lastAmount).toBe(30);
  const onlyDot=program([]);onlyDot.rules=[{...hook.rules[0]!,id:'count',condition:{op:'event',key:'dot'},steps:[{type:'add',scope:'shared',key:'dotCount',value:1}]}];r.roots=[{program:onlyDot}];g.beginPhase(a);g.endPhase(a);expect(p.flags.workshopPrograms.variables['shared:player'].dotCount).toBe(1);
 });
 it('伤害事件保留来源卡牌实例，直接伤害和自然 DOT 都可追溯',()=>{
  const {r,p,a,g}=fixture(),watch=program([]);watch.rules=[{id:'watch',event:'after_damage',priority:0,once:'never',costs:[],steps:[{type:'set',scope:'shared',key:'card',value:{op:'event',key:'cardId'}},{type:'set',scope:'shared',key:'uid',value:{op:'event',key:'cardUid'}}]}];r.roots=[{program:watch}];
  r.cast(program([{type:'damage',value:10,crit:false},{type:'native_status',status:'poison',value:.2,turns:2}]),p.id,a.id,{id:'card-test',uid:'instance-test',star:1});
  expect(p.flags.workshopPrograms.variables['shared:player']).toMatchObject({card:'card-test',uid:'instance-test'});g.beginPhase(a);g.endPhase(a);expect(p.flags.workshopPrograms.variables['shared:player']).toMatchObject({card:'card-test',uid:'instance-test'});
 });
 it('模板及新增表达式完整往返，不含固定引爆或扩散操作',()=>{
  for(const p of WORKSHOP_RULE_EXAMPLES){const normalized=normalizeRuleProgram(p);expect(normalizeRuleProgram(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);expect(JSON.stringify(normalized)).not.toMatch(/"type":"dot_(spread|detonate)"/);}
 });
});
