import { describe, expect, it } from 'vitest';
import {
  isWorkshopScriptMechanism,
  normalizeWorkshopMechanism,
  normalizeWorkshopScriptResult,
} from '@/workshop-mechanisms';
import {
  executeWorkshopScriptMechanism,
  prepareWorkshopScriptRuntime,
  validateWorkshopScriptMechanism,
  type WorkshopScriptInput,
} from '@/workshop-script-runtime';
import { normalizeWorkshopCard } from '@/workshop';

function input(
  overrides: Partial<WorkshopScriptInput> = {},
): WorkshopScriptInput {
  return {
    trigger: 'before_damage',
    battle: {
      turn: 1,
      phase: 'player',
      selectedTarget: 0,
      player: { hp: 100, hpMax: 100 },
      enemies: [{ id: 'enemy:1', hp: 100, hpMax: 100 }],
    },
    event: { amount: 7, cardTags: ['melee'] },
    resources: { combo: 1 },
    random: 0.25,
    ...overrides,
  };
}

describe('创意工坊代码机制沙箱', () => {
  it('执行玩家编写的算法并只接收受控结果', async () => {
    const mechanism = normalizeWorkshopMechanism({
      format: 'caelian_workshop_script_mechanism',
      version: 1,
      id: 'author.melee-combo',
      name: '近战连击',
      triggers: ['before_damage'],
      resources: [
        {
          id: 'combo',
          label: '连击',
          min: 0,
          max: 5,
          initial: 0,
          visible: true,
        },
      ],
      source: `
        function handle(ctx) {
          if (!ctx.event.cardTags.includes('melee')) return {};
          const combo = Math.min(5, ctx.resources.combo + 1);
          return {
            resources: { combo },
            event: { amount: ctx.event.amount * (1 + combo / 10) },
            actions: [{ type: 'log', message: '近战连击生效' }]
          };
        }
      `,
    });
    expect(isWorkshopScriptMechanism(mechanism)).toBe(true);
    await validateWorkshopScriptMechanism(mechanism);
    const raw = executeWorkshopScriptMechanism(mechanism, input());
    const result = normalizeWorkshopScriptResult(
      raw,
      mechanism,
      'before_damage',
    );
    expect(result.resources.combo).toBe(2);
    expect(result.event.amount).toBeCloseTo(8.4);
    expect(result.actions[0]).toMatchObject({
      type: 'log',
      message: '近战连击生效',
    });
  });

  it('沙箱中不存在页面、网络和浏览器存储对象', async () => {
    const mechanism = normalizeWorkshopMechanism({
      format: 'caelian_workshop_script_mechanism',
      version: 1,
      id: 'author.isolation-check',
      name: '隔离检查',
      triggers: ['before_damage'],
      source: `
        function handle() {
          const exposed = ['document', 'window', 'fetch', 'localStorage']
            .filter((name) => typeof globalThis[name] !== 'undefined');
          return { event: { amount: exposed.length } };
        }
      `,
    });
    await prepareWorkshopScriptRuntime();
    const result = normalizeWorkshopScriptResult(
      executeWorkshopScriptMechanism(mechanism, input()),
      mechanism,
      'before_damage',
    );
    expect(result.event.amount).toBe(0);
  });

  it('中断无限循环并限制代码和返回值', async () => {
    const mechanism = normalizeWorkshopMechanism({
      format: 'caelian_workshop_script_mechanism',
      version: 1,
      id: 'author.loop',
      name: '无限循环测试',
      triggers: ['turn_start'],
      source: 'function handle() { while (true) {} }',
    });
    await prepareWorkshopScriptRuntime();
    expect(() =>
      executeWorkshopScriptMechanism(
        mechanism,
        input({ trigger: 'turn_start', event: {} }),
      ),
    ).toThrow(/interrupted/i);
    expect(() =>
      normalizeWorkshopMechanism({
        ...mechanism,
        source: `function handle() {}${'x'.repeat(24_000)}`,
      }),
    ).toThrow('24000');
  });

  it('为自制卡牌保留近战、远程或任意玩家标签', () => {
    const card = normalizeWorkshopCard(
      {
        name: '自定义武技',
        type: 'attack',
        cost: 1,
        tags: ['melee', 'weapon', 'melee', '自定义'],
        effects: [{ type: 'damage', value: 5 }],
      },
      'custom_class_tag_test',
    );
    expect(card.tags).toEqual(['melee', 'weapon', '自定义']);
  });
});
