import { describe, expect, it } from 'vitest';
import { actor, makeGame } from '@/battle/rework/runtime/physics.mjs';
import { createPlayerController } from '@/battle/rework/runtime/common-player.mjs';
import { snapshot, hydrate } from '@/battle/rework/runtime/api.mjs';
import { projectLegacyTimed, syncLegacyActors } from '@/battle/rework/runtime/legacy-bridge.mjs';
import { effectValue } from '@/battle/rework/runtime/tactical-ai.mjs';
import { installWorkshopPrograms } from '@/battle/workshop-program-runtime';
import { emptyRuleProgram, normalizeRuleProgram, describeRuleProgram } from '@/workshop-program';
import { normalizeCardEffect } from '@/workshop';
import { workshopStatusInput } from '@/workshop-status-library';

function fixture() {
  const stats={hp:10000,attack:100,defense:0,speed:100,crit:100,critDamage:250,ehr:0,res:0};
  const p=actor('player','player',20,stats),e=actor('enemy','enemy',20,stats),g=makeGame(p,[e],{trace:true});
  p.ap=p.apMax=10;p.drawCount=3;g.round=1;g.phase='player';g.controller=createPlayerController();g.controller.init(g,{id:'custom'},[]);
  return {g,p,e,r:installWorkshopPrograms(g,[])};
}
function tick(g:any,e:any) { g.beginPhase(e);g.endPhase(e); }
function dotProgram(turns=5,maxStacks=6) {
  const program=emptyRuleProgram();program.rules[0]!.steps=[{type:'native_status',status:'burn',value:.35,turns,maxStacks,target:'target'}];
  return normalizeRuleProgram(program);
}

describe('工坊 DOT 的作者配置',()=>{
  it('基础效果与规则导出保留回合与上限，拒绝非法整数而非静默截断',()=>{
    const effect=normalizeCardEffect({type:'apply_debuff',nativeStatus:true,debuff:'burn',value:.35,turns:1200,maxStacks:20})!;
    expect(effect).toMatchObject({turns:1200,maxStacks:20,value:.35});
    expect(normalizeCardEffect(JSON.parse(JSON.stringify(effect)))).toEqual(effect);
    expect(normalizeCardEffect({...effect,turns:-1,maxStacks:0})).toMatchObject({turns:-1,maxStacks:0});
    for(const bad of [0,-2,1.5,Infinity])expect(()=>normalizeCardEffect({...effect,turns:bad})).toThrow('持续回合');
    for(const bad of [-1,1.5,Infinity])expect(()=>normalizeCardEffect({...effect,maxStacks:bad})).toThrow('可叠加上限');
    expect(dotProgram().rules[0]!.steps[0]).toMatchObject({turns:5,maxStacks:6});
    expect(describeRuleProgram(dotProgram())).toContain('持续5回合，同类最多6层');
    expect(describeRuleProgram(dotProgram(-1,0))).toContain('持续整场战斗，叠加不设上限');
  });
  it('同回合连续六次施加，五次结算后消失，并在 JSON 战斗读档后继续计时',()=>{
    const {g,p,e,r}=fixture(),program=dotProgram();
    for(let i=0;i<6;i++)r.cast(program,p.id,e.id);
    expect(e.dots).toHaveLength(6);expect(e.dots.map((d:any)=>d.snapshotDamage)).toEqual(Array(6).fill(35));
    tick(g,e);expect(e.hp).toBe(9790);expect(e.dots.map((d:any)=>d.remaining)).toEqual(Array(6).fill(4));
    const restored=hydrate(JSON.parse(JSON.stringify(snapshot(g))));installWorkshopPrograms(restored,[]);
    const enemy=restored.enemies[0];restored.player.stats.attack=900;
    for(let i=0;i<4;i++)tick(restored,enemy);
    expect(enemy.hp).toBe(8950);expect(enemy.dots).toHaveLength(0);tick(restored,enemy);expect(enemy.hp).toBe(8950);
  });
  it('上限为零时超过三层，整场 DOT 可读档、持续结算并被净化',()=>{
    const {g,p,e,r}=fixture();for(let i=0;i<8;i++)r.nativeStatus(p,e,'poison',.1,-1,100,1,{maxStacks:0});
    r.nativeStatus(p,e,'poison',.1,2,100,1,{maxStacks:0});
    expect(e.dots).toHaveLength(9);expect(projectLegacyTimed(e,e.dots).poison.turns).toBe(-1);
    const restored=hydrate(JSON.parse(JSON.stringify(snapshot(g))));installWorkshopPrograms(restored,[]);
    for(let i=0;i<6;i++)tick(restored,restored.enemies[0]);
    expect(restored.enemies[0].hp).toBe(9500);expect(restored.enemies[0].dots).toHaveLength(8);
    expect(restored.cleanse(restored.enemies[0],1)).toBe(1);expect(restored.enemies[0].dots).toHaveLength(0);
  });
  it('满层保留更强快照，同伤害可刷新即将过期的层',()=>{
    const {g,p,e,r}=fixture();for(let i=0;i<3;i++)r.nativeStatus(p,e,'burn',.35,5,100,1,{maxStacks:3});
    tick(g,e);tick(g,e);
    expect(r.nativeStatus(p,e,'burn',.35,5,100,1,{maxStacks:3})).toBe(true);
    expect(e.dots.map((d:any)=>d.remaining).sort()).toEqual([3,3,5]);
    expect(r.nativeStatus(p,e,'burn',.1,5,100,1,{maxStacks:3})).toBe(false);
    expect(r.nativeStatus(p,e,'burn',.7,5,100,1,{maxStacks:3})).toBe(true);
    expect(e.dots.map((d:any)=>d.snapshotDamage).sort()).toEqual([35,35,70]);expect(e.dots).toHaveLength(3);
  });
  it('内置 DOT 仍使用原有规则，不能挤掉工坊作者设置的层',()=>{
    const {g,p,e,r}=fixture();for(let i=0;i<6;i++)r.nativeStatus(p,e,'burn',.1,5,100,1,{maxStacks:6});
    const effect={kind:'dot',status:'burn',atk:.9,baseChance:100};
    expect(g.addDot(p,e,effect)).toBe(true);expect(g.addDot(p,e,effect)).toBe(true);expect(g.addDot(p,e,effect)).toBe(false);
    g.round++;expect(g.addDot(p,e,effect)).toBe(true);expect(g.addDot(p,e,effect)).toBe(false);
    expect(e.dots.filter((d:any)=>d.workshopDot)).toHaveLength(6);expect(e.dots.filter((d:any)=>!d.workshopDot)).toHaveLength(3);
    tick(g,e);tick(g,e);expect(e.dots).toHaveLength(6);
  });
  it.each(['buff','debuff'] as const)('自定义 %s 的六份 DOT 按父状态持续，百分数 35 等于倍率 0.35',polarity=>{
    const {g,p,e,r}=fixture(),program=emptyRuleProgram();
    program.statuses=[{id:'flame',name:'火焰',polarity,turns:5,maxStacks:6,stacking:'independent',baseChance:100,cleanseable:true,dispellable:true,data:{},rules:[],modifiers:[{status:'burn',value:35,unit:'percent'}]}];
    const normalized=normalizeRuleProgram(program);
    for(let i=0;i<7;i++)r.applyStatus(normalized,'flame',p,e);
    expect([...e.buffs,...e.debuffs].filter((s:any)=>s.ruleInstance)).toHaveLength(6);expect(e.dots).toHaveLength(6);
    expect(e.dots.every((d:any)=>d.snapshotDamage===35)).toBe(true);
    for(let i=0;i<5;i++)tick(g,e);expect(e.hp).toBe(8950);expect(e.dots).toHaveLength(0);
    expect([...e.buffs,...e.debuffs].some((s:any)=>s.ruleInstance)).toBe(false);
  });
  it('组合状态被移除时移除其 DOT，直接施加的同名 DOT 继续存在',()=>{
    const {g,p,e,r}=fixture(),program=emptyRuleProgram();program.statuses=[{id:'f',name:'火',polarity:'debuff',turns:-1,maxStacks:0,stacking:'independent',baseChance:100,cleanseable:true,dispellable:true,data:{},rules:[],modifiers:[{status:'burn',value:.35,unit:'ratio'}]}];
    r.applyStatus(program,'f',p,e);r.nativeStatus(p,e,'burn',.2,4,100,1,{maxStacks:1});
    program.rules[0]!.steps=[{type:'remove_status',status:'f',target:'target'}];r.cast(program,p.id,e.id);
    expect(e.dots).toHaveLength(1);expect(e.dots[0].snapshotDamage).toBe(20);tick(g,e);expect(e.hp).toBe(9980);
  });
  it('召唤物的自动行动估值不会套用两次施加限制',()=>{
    const {g,p,e,r}=fixture();p.flags.dotApplications={'1:enemy':2};
    const effect={kind:'dot',status:'burn',atk:.35,turns:5,maxStacks:6,workshopDot:true};
    for(let i=0;i<5;i++)r.nativeStatus(p,e,'burn',.35,5,100,1,{maxStacks:6});
    expect(effectValue(g,p,e,effect)).toBeGreaterThan(0);
    r.nativeStatus(p,e,'burn',.35,5,100,1,{maxStacks:6});expect(effectValue(g,p,e,effect)).toBe(0);
    tick(g,e);expect(effectValue(g,p,e,effect)).toBeGreaterThan(0);
  });
  it('投影与旧接口同步保持原始快照、剩余回合和层数',()=>{
    const {g,p,e,r}=fixture();for(let i=0;i<5;i++)r.nativeStatus(p,e,'bleed',.35,7,100,1,{maxStacks:5});tick(g,e);
    const debuffs=projectLegacyTimed(e,e.dots);
    syncLegacyActors(g,{player:{id:p.id,buffs:{},debuffs:{},summons:[]},enemies:[{id:e.id,buffs:{},debuffs}]} as any);
    expect(e.dots).toHaveLength(5);expect(e.dots.every((d:any)=>d.remaining===6&&d.snapshotDamage===35)).toBe(true);
  });
  it('输入单位说明区分倍率、百分数和百分点',()=>{
    expect(workshopStatusInput('burn').hint).toContain('填写 0.35');
    expect(workshopStatusInput('burn','percent').hint).toContain('填写 35');
    expect(workshopStatusInput('attack_up').label).toContain('0.2 = 20%');
    expect(workshopStatusInput('crit_up').label).toContain('百分点');
  });
});
