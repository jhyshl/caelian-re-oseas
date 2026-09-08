import { describe, expect, it } from 'vitest';
import { formatNumber, roundNumbersInText } from '@/ui/format-number';
import { battleCardText, canViewMonsterIntent, cleanCombatCopy } from '@/battle/presentation';
import { describeReworkEffects, applyReworkCards } from '@/battle/rework/catalog';
import relics from '@/content/generated/inventory/relics.json';
import { DEFAULT_STAR_SCALING } from '@/workshop-stars';
import type { CardDefinition } from '@/content/types';
import type { LocalBattleState, OwnedRelicRecord } from '@/domain/types';

const stats = {attack:100,defense:100,hpMax:1000,targetHpMax:800,speed:120};
const state = {player:{speed:120,mpMax:100}} as LocalBattleState;

describe('战斗显示规则',()=>{
  it('最多显示两位小数，保留整数，处理四舍五入边界',()=>{
    expect(formatNumber(16.6666666667)).toBe('16.67');expect(formatNumber(1.005)).toBe('1.01');
    expect(formatNumber(63)).toBe('63');expect(formatNumber(1.999)).toBe('2');expect(formatNumber(NaN)).toBe('0');
    expect(roundNumbersInText('暴击16.666666%')).toBe('暴击16.67%');
  });
  it('只有携带的洞察藏品授予意图显示，拥有而未携带无效',()=>{
    const row={relicId:'r_silver_compass',carried:false} as OwnedRelicRecord;
    expect(canViewMonsterIntent({relics:[row]},relics)).toBe(false);
    expect(canViewMonsterIntent({relics:[{...row,carried:true}]},relics)).toBe(true);
    expect(canViewMonsterIntent({relics:[{...row,carried:true,relicId:'unknown'}]},relics)).toBe(false);
    expect(canViewMonsterIntent(undefined,relics)).toBe(false);
  });
  it('防御100时18＋45%防御显示63，背包仍显示完整公式，三星正确换算',()=>{
    const effects=[{kind:'shield',flat:18,def:.45,target:'self'}];
    expect(describeReworkEffects(effects,1,stats)).toBe('自身获得63护盾');
    expect(describeReworkEffects(effects,3,stats)).toBe('自身获得75.6护盾');
    expect(describeReworkEffects(effects)).toContain('18＋45%防御');
    expect(effects[0]!.flat).toBe(18);
  });
  it('所有内置卡与嵌套选项均显示换算后的数字，不含通用说明',()=>{
    const cards=Object.values(applyReworkCards({}));expect(cards).toHaveLength(546);
    const problems=cards.filter(card=>/\d%\s*(攻击力|防御)|每个目标的每段独立|伤害预览按命中|仅使用攻击快照/.test(battleCardText(card,3,state,stats))).map(c=>c.id);
    expect(problems).toEqual([]);
  });
  it('自定义三星卡按配置计算，不额外叠加旧版隐式攻击倍率',()=>{
    const card={id:'custom-probe',name:'自制攻击',custom:true,type:'attack',effects:[{type:'damage',value:20,scaling:{stat:'attack',percent:100},target:'enemy'}],starScaling:DEFAULT_STAR_SCALING} as unknown as CardDefinition;
    expect(battleCardText(card,3,state,stats)).toContain('144总伤害');expect(card.effects[0]!.value).toBe(20);
  });
  it('召唤物技能使用继承后的攻击力换算',()=>{
    const effects=[{kind:'summon',name:'守卫',inherit:{hp:.3,atk:.5,def:.5},skills:[{name:'打击',effects:[{kind:'damage',flat:10,atk:1}]}]}];
    expect(describeReworkEffects(effects,1,stats)).toContain('造成60总伤害');
    expect(describeReworkEffects(effects,3,stats)).toContain('造成72总伤害');
  });
  it('去除预览假设和解释性备注，保留具体技能效果',()=>{
    expect(cleanCombatCopy('造成63伤害；伤害预览按命中且不暴击计算；条件效果以实际结算为准。')).toBe('造成63伤害');
  });
});
