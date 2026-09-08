import { describe, expect, it } from 'vitest';
import { actor, makeGame } from '@/battle/rework/runtime/physics.mjs';
import { createPlayerController } from '@/battle/rework/runtime/common-player.mjs';
import { encode, decode } from '@/battle/rework/runtime/api.mjs';
import { installWorkshopPrograms } from '@/battle/workshop-program-runtime';
import { WORKSHOP_RULE_EXAMPLES } from '@/workshop-program-templates';
import { normalizeRuleProgram, emptyRuleProgram, type RuleProgram } from '@/workshop-program';
import { WORKSHOP_STATUS_LIBRARY } from '@/workshop-status-library';
function fixture(){
  const stats={hp:1000,attack:100,defense:0,speed:100,crit:0,critDamage:50,ehr:0,res:0};
  const p=actor('player','player',20,stats),e=actor('enemy','enemy',20,stats),g=makeGame(p,[e],{trace:true});
  p.name='玩家';p.ap=p.apMax=10;p.drawCount=3;g.round=1;g.phase='player';g.controller=createPlayerController();g.controller.init(g,{id:'custom'},[]);
  g.effectRng=()=>0;g.hitRng=()=>1;g.critRng=()=>1;
  const r=installWorkshopPrograms(g,[]);return {g,p,e,r};
}
const example=(index:number)=>normalizeRuleProgram(structuredClone(WORKSHOP_RULE_EXAMPLES[index]));
describe('通用工坊组合规则',()=>{
  it('示例都是相同格式的普通规则，状态库开放嘲讽、冻结和怪物效果',()=>{
    for(const p of WORKSHOP_RULE_EXAMPLES)expect(normalizeRuleProgram(p).version).toBe(2);
    expect(WORKSHOP_STATUS_LIBRARY.map(s=>s.id)).toEqual(expect.arrayContaining(['taunt','freeze','petrify','vulnerable','direct_damage_reduction']));
  });
  it('生命之契抵扣治疗、保持易伤、不可净化；过量解除仅移除自身效果',()=>{
    const {g,p,e,r}=fixture();e.hp=400;r.cast(example(0),p.id,e.id);
    const status=e.buffs.find((s:any)=>s.ruleInstance);expect(status.ruleData.remaining).toBe(200);expect(g.statusRatio(e,'vulnerable')).toBe(.2);
    expect(g.cleanse(e,99)).toBe(0);
    expect(g.heal(p,e,100)).toBe(0);expect(e.hp).toBe(400);expect(status.ruleData.remaining).toBe(100);
    g.addStatus(p,e,{kind:'debuff',status:'vulnerable',value:.1,valueUnit:'ratio',turns:3});
    expect(g.heal(p,e,150)).toBe(50);expect(e.hp).toBe(450);expect(e.buffs.some((s:any)=>s.ruleInstance)).toBe(false);expect(g.statusRatio(e,'vulnerable')).toBe(.1);
  });
  it('满血仍可抵扣，严格大于条件不会在相等时解除，读档不丢额度',()=>{
    const {g,p,e,r}=fixture();r.cast(example(0),p.id,e.id);g.heal(p,e,80);
    const restored=decode(JSON.parse(JSON.stringify(encode(g))));
    expect(restored.enemies[0].buffs.find((s:any)=>s.ruleInstance).ruleData.remaining).toBe(120);
    g.heal(p,e,120);expect(e.buffs.some((s:any)=>s.ruleInstance)).toBe(true);g.heal(p,e,1);expect(e.buffs.some((s:any)=>s.ruleInstance)).toBe(false);
  });
  it('每份契约独立并串行消费同一笔治疗',()=>{
    const {g,p,e,r}=fixture();e.hp=400;r.cast(example(0),p.id,e.id);r.cast(example(0),p.id,e.id);
    expect(g.heal(p,e,300)).toBe(0);expect(e.buffs.filter((s:any)=>s.ruleInstance)).toHaveLength(1);expect(e.buffs.find((s:any)=>s.ruleInstance).ruleData.remaining).toBe(100);
  });
  it('自定义Buff石化复用冻结，命中后跳过行动且遵守控制免疫',()=>{
    const {g,p,e,r}=fixture();r.cast(example(5),p.id,e.id);expect(g.beginPhase(e)).toBe(false);g.endPhase(e);
    expect(g.beginPhase(e)).toBe(true);r.cast(example(5),p.id,e.id);expect(e.buffs.filter((s:any)=>s.ruleInstance)).toHaveLength(0);
  });
  it('即使命名为Buff，敌对石化仍检定效果命中',()=>{
    const {g,p,e,r}=fixture();g.effectRng=()=>.99;e.stats.res=80;r.cast(example(5),p.id,e.id);expect(g.hasStatus(e,'freeze')).toBe(false);
  });
  it('玩家嘲讽与坚韧可同时施加；移除契约不会驱散其他来源',()=>{
    const {g,p,e,r}=fixture();expect(r.nativeStatus(p,p,'taunt',1,1)).toBe(true);expect(r.nativeStatus(p,p,'direct_damage_reduction',.2,1)).toBe(true);
    expect(g.hasStatus(p,'taunt')).toBe(true);expect(g.incomingReduction(p)).toBe(.2);expect(g.targets(e,{kind:'damage',target:'enemy'},p)[0]).toBe(p);
  });
  it('治疗转护盾读取真正溢出，蓄伤护符读取实际生命损失',()=>{
    const {g,p,e,r}=fixture();r.cast(example(2),p.id,p.id);p.hp=950;expect(g.heal(p,p,150)).toBe(50);expect(p.shield).toBe(100);
    r.cast(example(1),p.id,p.id);p.shield=30;g.rawHit(e,p,100);const stored=p.buffs.find((s:any)=>s.ruleStatus==='stored');expect(stored.ruleData.stored).toBe(21);
    g.beginPhase(p);expect(p.shield).toBe(21);expect(stored.ruleData.stored).toBe(0);
  });
  it('死亡传递使用目标筛选与状态数据传递',()=>{
    const {g,p,e,r}=fixture();const other=actor('enemy2','enemy',20,{...e.stats,hp:1000});g.enemies.push(other);r.cast(example(3),p.id,e.id);g.rawHit(p,e,2000);expect(other.debuffs.some((s:any)=>s.ruleStatus==='transfer')).toBe(true);
  });
  it('多项支付先核对再扣除，资源不足不部分扣血',()=>{
    const {p,e,r}=fixture();const program=emptyRuleProgram();program.rules[0]!.costs=[{type:'hp',target:'self',value:100},{type:'resource_cost',target:'self',key:'energy',value:3}];program.rules[0]!.steps=[{type:'damage',value:100,target:'target'}];
    expect(()=>r.cast(program,p.id,e.id)).toThrow('资源不足');expect(p.hp).toBe(1000);expect(e.hp).toBe(1000);
  });
  it('召唤物按优先级选择复合保护或普通攻击',()=>{
    const {g,p,e,r}=fixture();r.cast(example(6),p.id,e.id);const pet=g.allies.find((a:any)=>a.ruleSummon);expect(pet).toBeDefined();p.hp=200;g.beginPhase(pet);expect(g.hasStatus(pet,'taunt')).toBe(true);expect(g.incomingReduction(pet)).toBe(.2);expect(e.hp).toBe(1000);
  });
  it('公式拒绝非有限值、危险字段与未知积木，防止损坏导入',()=>{
    const p=emptyRuleProgram();p.rules[0]!.steps=[{type:'set',key:'__proto__',value:1}];expect(()=>normalizeRuleProgram(p)).toThrow();
    (p as RuleProgram).rules[0]!.steps=[{type:'damage',value:Infinity}];expect(()=>normalizeRuleProgram(p)).toThrow();
  });
  it('复用中文弱化、控制和百分数防御效果时保留原技能规范编号',()=>{
    const {g,p,e,r}=fixture();p.stats.defense=100;
    r.nativeStatus(p,p,'防御提高%',15,2);expect(g.stat(p,'defense')).toBeCloseTo(115);
    r.nativeStatus(p,e,'易伤：直接受伤增加%',15,2);expect(g.statusRatio(e,'vulnerable')).toBeCloseTo(.15);
    r.nativeStatus(p,e,'封邪：强控',1,1);expect(g.beginPhase(e)).toBe(false);
  });
  it('复用荆棘反击保留原技能复合效果且同回合只触发一次',()=>{
    const {g,p,e,r}=fixture();r.nativeStatus(p,p,'荆棘反击',1,2);g.rawHit(e,p,50);expect(e.hp).toBe(958);g.rawHit(e,p,50);expect(e.hp).toBe(958);
  });
  it('逐目标循环命中各目标，单体攻击遵守嘲讽，自身伤害保持自身目标',()=>{
    const {g,p,e,r}=fixture();const other=actor('second','enemy',20,{...e.stats,hp:1000});g.enemies.push(other);r.nativeStatus(e,e,'taunt',1,1);
    const program=emptyRuleProgram();program.rules[0]!.steps=[{type:'foreach',target:{op:'targets',key:'enemies'},steps:[{type:'damage',target:'target',value:10,crit:false}]}];r.cast(program,p.id,other.id);expect(e.hp).toBe(990);expect(other.hp).toBe(990);
    program.rules[0]!.steps=[{type:'damage',target:'target',value:10,crit:false},{type:'damage',target:'self',value:5,crit:false}];r.cast(program,p.id,other.id);expect(e.hp).toBe(980);expect(other.hp).toBe(990);expect(p.hp).toBe(995);
  });
  it('DOT只继承攻击快照，不受暴击属性变化影响',()=>{
    const {g,p,e,r}=fixture();p.stats.crit=100;p.stats.critDamage=250;r.nativeStatus(p,e,'中毒',.35,2);p.stats.attack=1000;g.beginPhase(e);g.endPhase(e);expect(e.hp).toBe(965);expect(g.totals.crits).toBe(0);
  });
  it('零伤害拦截真正抵消本次伤害，不强制造成1点',()=>{
    const {g,p,e,r}=fixture();const program=emptyRuleProgram();program.rules=[{id:'nullify',event:'before_damage',once:'never',priority:0,costs:[],steps:[{type:'event_set',field:'amount',value:0}]}];r.roots=[{program}];g.damage(e,p,{kind:'damage',flat:100});expect(p.hp).toBe(1000);
  });
  it('空循环与超大多段攻击也受执行保护约束',()=>{
    const {p,e,r}=fixture();const program=emptyRuleProgram();program.rules[0]!.steps=[{type:'repeat',value:1000000000,steps:[]}];expect(()=>r.cast(program,p.id,e.id)).toThrow('保护');program.rules[0]!.steps=[{type:'damage',target:'target',value:1,hits:1000000000}];expect(()=>r.cast(program,p.id,e.id)).toThrow('保护');
  });
});
