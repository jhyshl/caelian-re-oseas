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
