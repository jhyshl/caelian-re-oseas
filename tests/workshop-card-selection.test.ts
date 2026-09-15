import { describe, expect, it } from 'vitest';
import { actor, makeGame } from '@/battle/rework/runtime/physics.mjs';
import { createPlayerController } from '@/battle/rework/runtime/common-player.mjs';
import { installWorkshopPrograms } from '@/battle/workshop-program-runtime';
import { emptyRuleProgram, normalizeRuleProgram, type RuleExpression, type RuleStep } from '@/workshop-program';
import { WORKSHOP_RULE_EXAMPLES } from '@/workshop-program-templates';
import { workshopObjectCatalog } from '@/workshop-object-catalog';
import { emptyStatusProgram } from '@/workshop-status-program';

const selected: RuleExpression = {op:'card_items',key:'all',value:{op:'eq',args:[{op:'item',key:'cardId'},{op:'card_definition',key:'token'}]}};
function fixture(enemyCount=2) {
  const stats={hp:10000,attack:100,defense:0,speed:100,crit:0,critDamage:150,ehr:100,res:0};
  const p=actor('player','player',20,stats),enemies=Array.from({length:enemyCount},(_,i)=>actor('enemy'+i,'enemy',20,stats));
  const g=makeGame(p,enemies,{trace:true});g.controller=createPlayerController();g.controller.init(g,{id:'custom'},[]);g.round=1;g.phase='player';p.ap=10;
  const definition={id:'token',name:'幻影牌',type:'skill',cost:3,battleOnly:true,effects:[]};
  const r=installWorkshopPrograms(g,[],{card:id=>id==='token'?definition:undefined});
  const cast=(steps:RuleStep[])=>{const program=emptyRuleProgram();program.rules[0]!.steps=steps;r.cast(normalizeRuleProgram(program),p.id,enemies[0]!.id);};
  return {p,g,r,enemies,cast};
}
describe('共享的卡牌选择与操作积木',()=>{
  it('生成指定牌、按同一列表改费、检索、弃牌、消耗，只操作匹配实例',()=>{
    const {p,cast}=fixture();p.hand=[{id:'other',uid:'keep',ap:7}];
    cast([{type:'card',operation:'generate',source:{op:'card_definition',key:'token'},count:2,mode:'deck'}]);
    expect(p.deck).toHaveLength(2);expect(new Set(p.deck.map((c:any)=>c.uid)).size).toBe(2);
    cast([{type:'card',operation:'cost',selection:selected,field:'add',value:-2,count:2}]);
    expect(p.deck.map((c:any)=>c.ruleCost)).toEqual([1,1]);expect(p.hand[0].ap).toBe(7);
    cast([{type:'card',operation:'draw',selection:selected,count:1}]);expect(p.hand.filter((c:any)=>c.id==='token')).toHaveLength(1);
    cast([{type:'card',operation:'discard',selection:{op:'card_items',key:'hand',value:(selected as any).value},count:1}]);expect(p.discard).toHaveLength(1);
    cast([{type:'card',operation:'consume',selection:selected,count:10}]);expect(p.deck).toHaveLength(0);expect(p.discard).toHaveLength(0);expect(p.hand.map((c:any)=>c.uid)).toEqual(['keep']);
  });
  it('空列表与数量0不操作任何牌，支付指定牌代价不足时不弃其他牌',()=>{
    const {p,r,enemies,cast}=fixture();p.hand=[{id:'other',uid:'keep',ap:1}];
    cast([{type:'card',operation:'generate',source:{op:'card_definition',key:'token'},count:0},{type:'discard',selection:selected,value:1}]);expect(p.hand).toHaveLength(1);
    cast([{type:'discard',value:0}]);expect(p.hand).toHaveLength(1);
    const program=emptyRuleProgram();program.rules[0]!.costs=[{type:'discard_cost',source:{op:'card_definition',key:'token'},value:1}];program.rules[0]!.steps=[{type:'shield',target:'self',value:20}];
    expect(()=>r.cast(normalizeRuleProgram(program),p.id,enemies[0]!.id)).toThrow('资源不足');expect(p.hand[0].uid).toBe('keep');expect(p.shield).toBe(0);
  });
  it('弹射每段重选存活目标，单目标承受全部段数',()=>{
    const {p,r,enemies,g}=fixture(1);const example=normalizeRuleProgram(WORKSHOP_RULE_EXAMPLES.find(p=>p.id==='template.random_hits'));
    r.cast(example,p.id,enemies[0]!.id);expect(enemies[0]!.hp).toBe(9800);
    const multi=fixture(2);multi.enemies[0]!.hp=1;multi.g.rng=()=>.99;multi.r.cast(example,multi.p.id,multi.enemies[0]!.id);
    expect(multi.enemies[0]!.hp).toBe(0);expect(multi.enemies[1]!.hp).toBe(9840);expect(g.player.flags.workshopPrograms.trace).toBeDefined();
  });
  it('独立状态监听原生和自定义DOT，每跳记录结算次数并可兑换资源',()=>{
    const {p,g,r,enemies,cast}=fixture(1);const status=emptyStatusProgram();status.statuses[0]!.turns=-1;
    status.statuses[0]!.rules=[{id:'tally',event:'after_damage',eventScope:'all',priority:0,once:'never',condition:{op:'event',key:'dot'},costs:[],steps:[
      {type:'add',scope:'status',key:'total',value:{op:'event',key:'damage'}},
      {type:'resource',target:'self',key:'energy',value:{op:'event',key:'count'}},
    ]}];r.applyStatus(status,'state',p,p);
    r.nativeStatus(p,enemies[0],'poison',.3,2);g.beginPhase(enemies[0]);g.endPhase(enemies[0]);
    cast([{type:'damage',mode:'dot',target:'target',value:70}]);
    expect(p.resources.energy).toBe(2);expect(p.buffs.find((s:any)=>s.ruleInstance).ruleData.total).toBe(100);
    g.damage(p,enemies[0],{kind:'damage',flat:10,atk:0,crit:false});expect(p.resources.energy).toBe(2);
  });
  it('目录显示原生与草稿的中英文定义名称和战斗专用牌',()=>{
    const catalog=workshopObjectCatalog({native:{name:'原生牌',type:'skill',cost:1,rarity:'common',description:'',effects:[]}},[],{cards:[{id:'token',name:'幻影牌',battleOnly:true,type:'skill',cost:0,rarity:'common',description:'',effects:[]}],talent:{effects:[]}});
    expect(catalog.cards).toEqual(expect.arrayContaining([expect.objectContaining({id:'token',name:'幻影牌',group:'草稿·战斗专用牌'})]));
    expect(catalog.statuses.some(s=>s.id==='poison')).toBe(true);expect(catalog.resources.some(r=>r.id==='ap')).toBe(true);
  });
  it('按定义移除原生状态时匹配实际状态，不伤及其他状态',()=>{
    const {r,p,enemies,cast}=fixture();r.nativeStatus(p,enemies[0],'poison',.3,2);r.nativeStatus(p,enemies[0],'burn',.3,2);
    cast([{type:'remove_status',status:'poison',target:'target'}]);
    expect(enemies[0]!.dots.map((d:any)=>d.status)).toEqual(['burn']);
  });
});
