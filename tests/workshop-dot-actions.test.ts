import { describe, expect, it } from 'vitest';
import { actor, makeGame } from '@/battle/rework/runtime/physics.mjs';
import { createPlayerController } from '@/battle/rework/runtime/common-player.mjs';
import { snapshot, hydrate } from '@/battle/rework/runtime/api.mjs';
import { installWorkshopPrograms } from '@/battle/workshop-program-runtime';
import { describeRuleProgram, emptyRuleProgram, normalizeRuleProgram, type RuleStep } from '@/workshop-program';

function fixture() {
  const stats={hp:10000,attack:100,defense:0,speed:100,crit:100,critDamage:250,ehr:100,res:0};
  const p=actor('player','player',20,stats),a=actor('a','enemy',20,stats),b=actor('b','enemy',20,stats),c=actor('c','enemy',20,stats),g=makeGame(p,[a,b,c],{trace:true});
  p.ap=p.apMax=10;p.drawCount=3;g.round=1;g.phase='player';g.controller=createPlayerController();g.controller.init(g,{id:'custom'},[]);
  return {g,p,a,b,c,r:installWorkshopPrograms(g,[])};
}
function program(steps:RuleStep[]) {const p=emptyRuleProgram();p.rules[0]!.steps=steps;return normalizeRuleProgram(p);}
const others={op:'targets',key:'enemies',excludeSelected:true};

describe('工坊 DOT 扩散、引爆和清除',()=>{
  it('只扩散来源实际存在的种类，排除选中目标；使用新倍率和回合，独立于来源层数',()=>{
    const {r,p,a,b,c}=fixture();
    for(let i=0;i<3;i++)r.nativeStatus(p,a,'poison',.8,7,100,1,{maxStacks:0});
    r.nativeStatus(p,a,'burn',.6,6,100,1,{maxStacks:0});
    r.cast(program([{type:'dot_spread',source:'selected_target',target:others,value:.2,turns:4,count:1,maxStacks:0}]),p.id,a.id);
    expect(a.dots).toHaveLength(4);
    for(const target of [b,c]){expect(target.dots.map((d:any)=>d.status)).toEqual(['poison','burn']);expect(target.dots.every((d:any)=>d.snapshotDamage===20&&d.remaining===4)).toBe(true);}
  });
  it('指定种类与空列表生效，没有的种类不会凭空施加；每层遵守命中与上限',()=>{
    const {r,p,a,b,c}=fixture();r.nativeStatus(p,a,'poison',.2,4);r.nativeStatus(p,a,'burn',.2,4);
    r.cast(program([{type:'dot_spread',dotTypes:['poison','bleed'],target:others,count:4,value:.3,turns:5,maxStacks:2}]),p.id,a.id);
    for(const t of [b,c]){expect(t.dots).toHaveLength(2);expect(t.dots.every((d:any)=>d.status==='poison')).toBe(true);}
    r.cast(program([{type:'dot_spread',dotTypes:[],target:others}]),p.id,a.id);expect(b.dots).toHaveLength(2);
    r.cast(program([{type:'dot_spread',dotTypes:['burn'],target:others,chance:0}]),p.id,a.id);expect(b.dots).toHaveLength(2);
  });
  it('目标循环内始终排除最初选中的单位；场上只剩原目标时不施加',()=>{
    const {r,p,a,b,c}=fixture();r.nativeStatus(p,a,'poison',.2,4);
    r.cast(program([{type:'foreach',target:{op:'targets',key:'enemies'},steps:[{type:'dot_spread',target:others,maxStacks:0}]}]),p.id,a.id);
    expect(a.dots).toHaveLength(1);expect(b.dots).toHaveLength(3);expect(c.dots).toHaveLength(3);
    b.hp=c.hp=0;r.cast(program([{type:'dot_spread',target:others}]),p.id,a.id);expect(a.dots).toHaveLength(1);
  });
  it('3 层中毒与 2 层灼烧按原快照结算，忽略引爆者新攻击、星级和暴击，只清除匹配 DOT',()=>{
    const {r,p,a,g}=fixture();
    for(let i=0;i<3;i++)r.nativeStatus(p,a,'poison',.3,3,100,1,{maxStacks:0});
    for(let i=0;i<2;i++)r.nativeStatus(p,a,'burn',.5,2,100,1,{maxStacks:0});
    r.nativeStatus(p,a,'bleed',.1,2);g.addStatus(p,a,{kind:'debuff',status:'speed_down',value:.2,turns:3},{skipEffectRoll:true});
    a.stats.defense=200;a.shield=25;p.stats.attack=900;p.star=3;
    const before=a.hp;r.cast(program([{type:'dot_detonate',dotTypes:['poison','burn'],mode:'tick',consume:true,value:1}]),p.id,a.id,{star:3});
    expect(a.hp).toBe(before-70);expect(a.shield).toBe(0);expect(a.dots).toHaveLength(1);expect(a.dots[0].status).toBe('bleed');expect(a.debuffs.some((s:any)=>s.status==='speed_down')).toBe(true);
    expect(g.events.slice(-5).every((e:any)=>e.dot&&e.crits===0)).toBe(true);
  });
  it('剩余次数模式使用各层不同回合，整场 DOT 仅一跳；保留模式不扣原回合',()=>{
    const {r,p,a}=fixture();r.nativeStatus(p,a,'poison',.3,2);r.nativeStatus(p,a,'burn',.5,1);r.nativeStatus(p,a,'bleed',.1,-1);
    r.cast(program([{type:'dot_detonate',mode:'remaining',consume:false,value:2}]),p.id,a.id);
    expect(a.hp).toBe(9760);expect(a.dots.map((d:any)=>d.remaining)).toEqual([2,1,Infinity]);
    r.cast(program([{type:'dot_detonate',dotTypes:[],consume:true}]),p.id,a.id);expect(a.hp).toBe(9760);expect(a.dots).toHaveLength(3);
  });
  it('清除不可净化 DOT 以及自定义父状态附带的 DOT，不移除父状态或其他减益，也不自动补回',()=>{
    const {r,p,a,g}=fixture(),definition=program([]);
    definition.statuses=[{id:'fire',name:'燃烧甲',polarity:'debuff',turns:5,stacking:'independent',cleanseable:true,dispellable:true,baseChance:100,data:{},rules:[],modifiers:[{status:'burn',value:.2,unit:'ratio'},{status:'speed_down',value:.2,unit:'ratio'}]}];
    r.applyStatus(definition,'fire',p,a);r.nativeStatus(p,a,'poison',.1,3);
    expect(a.dots.some((d:any)=>d.cleanseable===false)).toBe(true);
    r.cast(program([{type:'dot_remove',dotTypes:['burn']}]),p.id,a.id);
    expect(a.dots.map((d:any)=>d.status)).toEqual(['poison']);expect(a.debuffs.some((s:any)=>s.ruleStatus==='fire')).toBe(true);
    g.beginPhase(a);g.endPhase(a);expect(a.dots.map((d:any)=>d.status)).toEqual(['poison']);expect(a.hp).toBe(9990);
  });
  it('引爆消耗先锁定原层，伤害回调再次引爆不会重复结算，回调新增 DOT 不会被误删',()=>{
    const {r,p,a}=fixture();r.nativeStatus(p,a,'poison',.3,3);
    const response=program([]);response.rules=[{id:'reaction',event:'after_damage',priority:0,once:'battle',costs:[],steps:[{type:'dot_detonate',consume:true},{type:'native_status',status:'burn',value:.1,turns:2,maxStacks:0}]}];r.roots=[{program:response}];
    r.cast(program([{type:'dot_detonate',consume:true}]),p.id,a.id);
    expect(a.hp).toBe(9970);expect(a.dots.map((d:any)=>d.status)).toEqual(['burn']);
  });
  it('战斗 JSON 读档后保留快照和延迟的原选中目标',()=>{
    const {r,p,a,g}=fixture();r.nativeStatus(p,a,'poison',.3,2);
    r.cast(program([{type:'delay',turns:1,event:'turn_start',steps:[{type:'dot_spread',target:others,value:.2,turns:2,maxStacks:0}]}]),p.id,a.id);
    const restored=hydrate(JSON.parse(JSON.stringify(snapshot(g)))),runtime=installWorkshopPrograms(restored,[]);restored.round=2;restored.selectedTarget=1;
    runtime.emit('turn_start',{sourceId:p.id,targetId:p.id});
    expect(restored.enemies[0].dots).toHaveLength(1);expect(restored.enemies[1].dots).toHaveLength(1);expect(restored.enemies[2].dots).toHaveLength(1);
    runtime.cast(program([{type:'dot_detonate',consume:true}]),p.id,a.id);expect(restored.enemies[0].hp).toBe(9970);expect(restored.enemies[0].dots).toHaveLength(0);
  });
  it('导出往返与说明保留所有选项；非法配置在执行前被拒绝',()=>{
    const value=program([{type:'dot_spread',source:'selected_target',target:others,dotTypes:['poison'],value:.2,turns:4,count:2,maxStacks:0},{type:'dot_detonate',dotTypes:['burn'],mode:'remaining',consume:false,value:1.5}]);
    expect(normalizeRuleProgram(JSON.parse(JSON.stringify(value)))).toEqual(value);expect(describeRuleProgram(value)).toContain('除选中目标外');expect(describeRuleProgram(value)).toContain('保留 DOT');
    expect(()=>program([{type:'dot_spread',dotTypes:['stun']}])).toThrow('DOT 种类');expect(()=>program([{type:'dot_spread',count:1.5}])).toThrow('正整数');
    const {r,p,a}=fixture();r.nativeStatus(p,a,'burn',.1,5000);
    expect(()=>r.cast(program([{type:'dot_detonate',mode:'remaining',consume:true}]),p.id,a.id)).toThrow('保护范围');expect(a.dots).toHaveLength(1);expect(a.hp).toBe(10000);
  });
});

it('排除选中目标的伤害筛选只剩一名敌人时，不被原目标嘲讽重新拉回',()=>{
  const {r,p,a,b,c,g}=fixture();c.hp=0;g.addStatus(a,a,{kind:'buff',status:'taunt',value:1,turns:3},{skipEffectRoll:true});
  r.cast(program([{type:'damage',target:others,value:50,mode:'recorded'}]),p.id,a.id);
  expect(a.hp).toBe(10000);expect(b.hp).toBe(9950);
});
