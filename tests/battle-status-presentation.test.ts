import {describe,expect,it} from 'vitest';
import {actor,makeGame,catalog} from '@/battle/rework/runtime/physics.mjs';
import {nativeStatusEntries,statusValueText,nativeStatusNames} from '@/battle/status-presentation';

function fixture(){const a=actor('player','player',20,{hp:1000,attack:100,defense:80,speed:100,crit:0,critDamage:50,ehr:0,res:0});return makeGame(a,[],{seed:1});}
describe('战斗状态显示与真实单位',()=>{
  it('实际卡牌的固定加速25显示25点，百分比加速单独显示，并且不修改真实速度',()=>{
    const g=fixture(),effect=catalog.cards.flatMap((c:any)=>c.effects).find((e:any)=>e.status==='速度增加'&&e.value===25);
    g.addStatus(g.player,g.player,effect);g.addStatus(g.player,g.player,{kind:'buff',status:'speed_up',value:.2,valueUnit:'ratio',turns:3},{skillId:'percent'});
    const before=g.stat(g.player,'speed'),rows=nativeStatusEntries(g.player,'buff');
    expect(rows.map(r=>statusValueText(r.name,r.effect))).toEqual(['数值 25 点','数值 20%']);
    expect(nativeStatusNames.speed_up).toBe('速度提高');expect(g.stat(g.player,'speed')).toBe(before);expect(before).toBe(145);
  });
  it('没有单位标记的队友20%增益、百分数格式状态、控制和持续伤害分别显示',()=>{
    const g=fixture(),a=g.player;
    g.addStatus(a,a,{kind:'buff',status:'attack_up',value:.2,turns:2});g.addStatus(a,a,{kind:'buff',status:'defense_up',value:30,valueUnit:'percent',turns:2});
    g.addStatus(a,a,{kind:'debuff',status:'freeze',value:1,turns:1},{skipEffectRoll:true});
    expect(nativeStatusEntries(a,'buff').map(r=>statusValueText(r.name,r.effect))).toEqual(['数值 20%','数值 30%']);
    expect(statusValueText('freeze',nativeStatusEntries(a,'debuff')[0]!.effect)).toBe('');
    a.dots.push({status:'poison',snapshotDamage:20,remaining:2});expect(nativeStatusEntries(a,'debuff')[1]?.effect).toMatchObject({value:20,dot:true,turns:2});
  });
  it('同类不同来源各自保留数值和到期时间，永久与隐藏的工坊状态不误显示',()=>{
    const g=fixture(),a=g.player;
    g.addStatus(a,a,{kind:'buff',status:'attack_up',value:.4,turns:1},{skillId:'strong'});g.addStatus(a,a,{kind:'buff',status:'attack_up',value:.2,turns:3},{skillId:'weak'});
    a.buffs.push({status:'workshop_status:visible',value:3,expireAtPhase:Infinity,ruleLabel:'护持',ruleData:{储存:20}});
    a.buffs.push({status:'workshop_status:hidden',value:3,ruleHidden:true});
    const entries=nativeStatusEntries(a,'buff');expect(entries).toHaveLength(3);expect(entries.map(e=>[e.effect.value,e.effect.turns])).toEqual([[40,1],[20,3],[3,-1]]);
    expect(entries[2]?.effect.ruleLabel).toBe('护持');
  });
});
