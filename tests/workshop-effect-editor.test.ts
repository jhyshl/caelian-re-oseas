import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import WorkshopEffectEditor from '@/modules/deck/WorkshopEffectEditor.vue';

let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.replaceChildren(); });

function mount(effect: Record<string, any>) {
  const draft = reactive(effect);
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({ setup: () => () => h(WorkshopEffectEditor, { effect: draft }) });
  app.mount(host);
  const field = (name: string) => [...host.querySelectorAll('label')]
    .find(label => label.querySelector('span')?.textContent === name);
  return { draft, host, field };
}

describe('效果编辑器只提供实际结算字段', () => {
  it('旧护盾伤害不显示无效公式，编辑比例不会改写旧字段', async () => {
    const { draft, host, field } = mount({ type: 'damage_from_shield', target: 'enemy', ratio: .5, value: 20, scaling: { stat: 'shield', percent: 20 } });
    expect(field('数值')).toBeUndefined();
    expect(field('数值公式')).toBeUndefined();
    expect(field('属性')).toBeUndefined();
    const ratio = field('护盾比例（0.5 = 50%）')!.querySelector('input')!;
    ratio.value = '.75'; ratio.dispatchEvent(new Event('input')); await nextTick();
    expect(draft.ratio).toBe(.75);
    expect(draft.value).toBe(20);
    expect(draft.scaling).toEqual({ stat: 'shield', percent: 20 });
    expect(host.textContent).toContain('多个伤害积木会分别结算、分别判定暴击');
  });

  it.each(['strip_shield', 'strip_buffs', 'cleanse', 'dispel', 'discard', 'recover_discard', 'reveal_intent', 'destroy_summon'])(
    '%s 不出现无效固定值或属性公式', type => {
      const { field } = mount({ type, amount: 1, target: 'enemy' });
      expect(field('数值')).toBeUndefined();
      expect(field('数值公式')).toBeUndefined();
      if (['cleanse', 'dispel', 'discard', 'recover_discard', 'destroy_summon'].includes(type)) expect(field('数量 / 消耗')).toBeDefined();
    },
  );

  it('一个伤害积木可以完整设置固定值加当前护盾百分比', async () => {
    const { draft, field } = mount({ type: 'damage', target: 'enemy', value: 8 });
    const mode = field('数值公式')!.querySelector('select')!;
    mode.value = 'hybrid'; mode.dispatchEvent(new Event('change')); await nextTick();
    const stat = field('属性')!.querySelector('select')!;
    stat.value = 'shield'; stat.dispatchEvent(new Event('change'));
    const percent = field('属性比例 y%')!.querySelector('input')!;
    percent.value = '50'; percent.dispatchEvent(new Event('input'));
    const value = field('数值')!.querySelector('input')!;
    value.value = '20'; value.dispatchEvent(new Event('input')); await nextTick();
    expect(draft.value).toBe(20);
    expect(draft.scaling).toEqual({ stat: 'shield', percent: 50 });
    expect(field('攻击次数（每次使用此伤害公式）')!.querySelector('input')!.value).toBe('1');
  });
});

it('DOT 编辑提示倍率，回合与层数修改写回草稿且不设固定上限',async()=>{
  const {draft,host,field}=mount({type:'apply_debuff',nativeStatus:true,debuff:'burn',value:.35,turns:2});
  const value=field('每跳攻击倍率（0.35 = 35%）')!.querySelector('input')!;
  expect(value.step).toBe('0.01');expect(host.textContent).toContain('每层每跳伤害 = 施加时攻击力');
  const turns=field('持续回合')!.querySelector('input')!,cap=field('可叠加上限（0 为不设上限）')!.querySelector('input')!;
  expect(turns.max).toBe('');expect(cap.max).toBe('');expect(cap.value).toBe('3');
  turns.value='1200';turns.dispatchEvent(new Event('input'));cap.value='8';cap.dispatchEvent(new Event('input'));await nextTick();
  expect(draft).toMatchObject({turns:1200,maxStacks:8,value:.35});
  turns.value='-1';turns.dispatchEvent(new Event('input'));cap.value='0';cap.dispatchEvent(new Event('input'));await nextTick();
  expect(draft).toMatchObject({turns:-1,maxStacks:0});
});

it('旧 DOT 仍明确显示固定伤害，主动重选状态才改用默认倍率',async()=>{
  const {draft,field}=mount({type:'apply_debuff',debuff:'burn',value:35,turns:5,maxStacks:6});
  expect(field('每跳固定值（减伤前）')!.querySelector('input')!.value).toBe('35');
  expect(field('可叠加上限（0 为不设上限）')).toBeDefined();
  const selector=field('减益')!.querySelector('select')!;selector.value='poison';selector.dispatchEvent(new Event('change'));await nextTick();
  expect(draft).toMatchObject({nativeStatus:true,value:.35,turns:5,maxStacks:6});expect(field('每跳攻击倍率（0.35 = 35%）')).toBeDefined();
});

it('百分比增益的输入按小数倍率标注，保留固定值增益的单位',async()=>{
  const {draft,field}=mount({type:'apply_buff',nativeStatus:true,buff:'attack_up',value:.2,turns:3});
  expect(field('效果倍率（0.2 = 20%）')).toBeDefined();draft.buff='strength';await nextTick();expect(field('数值')).toBeDefined();
});
