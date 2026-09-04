import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repositories/game-repository';
import {
  assessWorkshopProfession,
} from '@/workshop-assessment';
import {
  saveWorkshopTestPack,
  type WorkshopClass,
} from '@/workshop';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  localStorage.clear();
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

async function realAssessmentApi(profession: WorkshopClass, key: string) {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-workshop-assessment-${key}-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:workshop-assessment-${key}`);
  await game.execute(profile.id, {
    id: `assessment-${key}-player-create`,
    type: 'player.create',
    payload: {
      name: '评定玩家',
      classMain: 'knight',
      subclass: 'holy_knight',
    },
  });
  const api = {
    getRuntimeInfo: () => ({
      channel: 'alpha',
      version: 'assessment-test',
      buildId: 'assessment-test',
      databaseName: database.name,
      databaseVersion: 10,
      status: 'ready',
      profileId: profile.id,
      mvuAvailable: false,
    }),
    execute: (command: unknown) => game.execute(profile.id, command),
    query: async (name: string) => {
      if (name !== 'state') throw new Error(`不支持的测试查询：${name}`);
      return game.snapshot(profile.id);
    },
  } as Parameters<typeof assessWorkshopProfession>[0];
  return { api, database, game, profile };
}

describe('创意工坊真实战斗评定', () => {
  it('会通过正式战斗结算识别静态低分但脚本改写成极高伤害的职业', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id:
        index === 7
          ? 'aaa_hidden_runtime_card'
          : `custom_assessment_runtime_card_${index}`,
      name: `伪装伤害${index + 1}`,
      type: 'skill',
      tags: index === 7 ? ['runtime-overwrite'] : [],
      cost: index === 7 ? 0 : 5,
      effects:
        index === 7
          ? [{ type: 'damage', value: 1, target: 'enemy' }]
          : [{ type: 'shield', value: 8, target: 'self' }],
    }));
    const starterDeck = [
      cards[0]!.id,
      cards[0]!.id,
      cards[0]!.id,
      ...cards.slice(1, 7).flatMap((card) => [card.id, card.id]),
    ];
    const pack = saveWorkshopTestPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '实战评定脚本职业包',
      mechanisms: [
        {
          format: 'caelian_workshop_script_mechanism',
          version: 1,
          id: 'test.assessment-runtime-overwrite',
          name: '实战伤害覆写',
          triggers: ['before_damage'],
          resources: [],
          source: `
            function handle(ctx) {
              if (!ctx.event.cardTags.includes('runtime-overwrite')) return {};
              return { event: { amount: 1000 } };
            }
          `,
        },
      ],
      classes: [
        {
          id: 'custom_class_assessment_runtime',
          main: 'freelance',
          name: '实战覆写师',
          description: '卡面数值很低，但脚本会改写真实伤害。',
          talent: { name: '无', description: '无', effects: [] },
          cards,
          cardPool: [
            ...starterDeck,
            cards[7]!.id,
            cards[7]!.id,
            cards[7]!.id,
          ],
          starterDeck,
          mechanismIds: ['test.assessment-runtime-overwrite'],
        },
      ],
    });
    const profession = pack.classes[0]!;
    const hiddenCard = profession.cards[7]!;
    expect(hiddenCard.powerScore).toBe(1);
    expect(profession.cards.slice(0, 7).every(
      (card) => card.powerScore > hiddenCard.powerScore,
    )).toBe(true);
    expect(profession.starterDeck).not.toContain(hiddenCard.id);

    const { api, database, game, profile } = await realAssessmentApi(
      profession,
      'runtime',
    );
    const playerBefore = await database.playerStates.get(profile.id);

    const report = await assessWorkshopProfession(api, profession);

    expect(report.rounds).toHaveLength(3);
    expect(report.unsafeReason).toBeUndefined();
    expect(report.rounds[2]).toMatchObject({ passed: true });
    expect(report).toMatchObject({ status: 'overpowered', passed: false });
    expect(report.deckStrategies).toContain('coverage-1');
    expect(report.successfulCardIds).toContain(hiddenCard.id);
    expect((await game.snapshot(profile.id)).battle).toBeNull();
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: playerBefore?.hp,
      mp: playerBefore?.mp,
      gold: playerBefore?.gold,
      subclass: playerBefore?.subclass,
    });
  }, 90_000);

  it('防御单轴超过500才触发的隐藏爆发会被边界属性模板捕获', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `custom_assessment_defense_card_${index}`,
      name: `防御阈值卡${index + 1}`,
      type: 'skill',
      tags: ['defense-threshold'],
      cost: 0,
      effects: [{ type: 'damage', value: 1, target: 'enemy' }],
    }));
    const pack = saveWorkshopTestPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '防御边界评定包',
      mechanisms: [
        {
          format: 'caelian_workshop_script_mechanism',
          version: 1,
          id: 'test.assessment-defense-threshold',
          name: '防御阈值爆发',
          triggers: ['before_damage'],
          resources: [],
          source: `
            function handle(ctx) {
              if (!ctx.event.cardTags.includes('defense-threshold')) return {};
              if (ctx.battle.player.defense <= 500) return {};
              return { event: { amount: 1000 } };
            }
          `,
        },
      ],
      classes: [
        {
          id: 'custom_class_assessment_defense_threshold',
          main: 'freelance',
          name: '防御阈值师',
          description: '只有防御单轴超过500才会爆发。',
          talent: { name: '无', description: '无', effects: [] },
          cards,
          cardPool: [...cards, ...cards].map((card) => card.id),
          starterDeck: Array.from(
            { length: 15 },
            (_, index) => cards[index % cards.length]!.id,
          ),
          mechanismIds: ['test.assessment-defense-threshold'],
        },
      ],
    });
    const profession = pack.classes[0]!;
    const { api } = await realAssessmentApi(profession, 'defense-threshold');

    const report = await assessWorkshopProfession(api, profession);

    expect(report.attributeProfiles).toContainEqual(
      expect.objectContaining({
        id: 'defense-boundary',
        spent: 990,
        attributes: expect.objectContaining({ defense: 990 }),
      }),
    );
    const topHighScenarios = report.rounds[2]!.scenarios.filter(
      (scenario) => scenario.tier === 'high',
    );
    expect(topHighScenarios).toHaveLength(2);
    expect(
      topHighScenarios.every((scenario) =>
        scenario.burstVictoriousAttributeProfiles.includes('defense-boundary'),
      ),
    ).toBe(true);
    expect(report).toMatchObject({ status: 'overpowered', passed: false });
  }, 90_000);

  it('16卡零费攻击可倾泻整手且攻击边界缩放时会被判定为滥用', async () => {
    const cards = Array.from({ length: 16 }, (_, index) => ({
      id: `custom_assessment_baseline_card_${String(index).padStart(2, '0')}`,
      name: `普通低强卡${index + 1}`,
      type: 'attack',
      cost: 0,
      effects: [{ type: 'damage', value: 1, target: 'enemy' }],
    }));
    const pack = saveWorkshopTestPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '零费攻击滥用评定包',
      mechanisms: [],
      classes: [
        {
          id: 'custom_class_assessment_zero_cost_attack_abuse',
          main: 'freelance',
          name: '零费攻击滥用职业',
          description: '零行动点攻击牌可受攻击属性缩放并倾泻整手。',
          talent: { name: '无', description: '无', effects: [] },
          cards,
          cardPool: cards.map((card) => card.id),
          starterDeck: cards.slice(0, 15).map((card) => card.id),
          mechanismIds: [],
        },
      ],
    });
    const profession = pack.classes[0]!;
    const { api } = await realAssessmentApi(profession, 'zero-cost-attack-abuse');
    const startedAt = performance.now();

    const report = await assessWorkshopProfession(api, profession);
    const elapsedMs = performance.now() - startedAt;

    expect(report.successfulCardIds).toEqual(
      cards.map((card) => card.id).sort(),
    );
    expect(report).toMatchObject({ status: 'overpowered', passed: false });
    expect(elapsedMs).toBeLessThan(90_000);
  }, 100_000);

  it('16卡一费纯技能低强度对照不会被边界属性误判为超标', async () => {
    const cards = Array.from({ length: 16 }, (_, index) => ({
      id: `custom_assessment_low_skill_card_${String(index).padStart(2, '0')}`,
      name: `一费低强技能${index + 1}`,
      type: 'skill',
      cost: 1,
      effects: [{ type: 'damage', value: 1, target: 'enemy' }],
    }));
    const pack = saveWorkshopTestPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '一费纯技能低强对照包',
      mechanisms: [],
      classes: [
        {
          id: 'custom_class_assessment_true_low_control',
          main: 'freelance',
          name: '一费低强对照职业',
          description: '每张技能牌消耗1行动点并只造成1点固定伤害。',
          talent: { name: '无', description: '无', effects: [] },
          cards,
          cardPool: cards.map((card) => card.id),
          starterDeck: cards.slice(0, 15).map((card) => card.id),
          mechanismIds: [],
        },
      ],
    });
    const profession = pack.classes[0]!;
    const { api } = await realAssessmentApi(profession, 'true-low-control');
    const startedAt = performance.now();

    const report = await assessWorkshopProfession(api, profession);
    const elapsedMs = performance.now() - startedAt;

    expect(report.successfulCardIds).toEqual(
      cards.map((card) => card.id).sort(),
    );
    expect(report.status).not.toBe('overpowered');
    expect(report.passed).toBe(true);
    expect(report.unsafeReason).toBeUndefined();
    expect(elapsedMs).toBeLessThan(90_000);
  }, 100_000);
});
