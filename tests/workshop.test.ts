import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CARD_EFFECT_HITS } from '@/battle/execution-limits';
import {
  WORKSHOP_STORAGE_KEY,
  WORKSHOP_TEST_STORAGE_KEY,
  exportWorkshopPack,
  importWorkshopArtifact,
  migrateLegacyWorkshopTestPacks,
  normalizeCardEffect,
  normalizeTalentEffect,
  normalizeWorkshopCard,
  normalizeWorkshopPack,
  readWorkshopPacks,
  readWorkshopTestCandidate,
  saveWorkshopPack,
} from '@/workshop';
import {
  WORKSHOP_MECHANISM_STORAGE_KEY,
  readWorkshopMechanisms,
  saveWorkshopMechanism,
} from '@/workshop-mechanisms';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function workshopPack(id: string, damage = 1) {
  const cards = Array.from({ length: 8 }, (_, index) => ({
    id: `${id}_card_${index}`,
    name: `自制卡牌${index + 1}`,
    type: 'attack',
    cost: 0,
    rarity: index === 0 ? 'legendary' : 'common',
    effects: [{ type: 'damage', value: damage, target: 'enemy' }],
  }));
  return {
    format: 'caelian_workshop_class_pack',
    version: 1,
    packName: `${id}职业包`,
    classes: [
      {
        id,
        main: 'freelance',
        name: `${id}职业`,
        talent: { name: '自制天赋', description: '无', effects: [] },
        cards,
        cardPool: [...cards, ...cards].map((card) => card.id),
        starterDeck: Array.from(
          { length: 15 },
          (_, index) => cards[index % cards.length]!.id,
        ),
        mechanismIds: [] as string[],
      },
    ],
  };
}

function workshopMechanism(id: string) {
  return {
    format: 'caelian_workshop_mechanism',
    version: 1,
    id,
    name: `机制 ${id}`,
    resources: [
      {
        id: 'charge',
        label: '充能',
        min: 0,
        max: 10,
        initial: 0,
        visible: true,
      },
    ],
    statuses: [],
    rules: [],
  };
}

describe('创意工坊自由创作规则', () => {
  it('保存与导入职业后立即进入正式目录', () => {
    saveWorkshopPack(workshopPack('custom_class_direct'));
    const imported = importWorkshopArtifact(
      workshopPack('custom_class_imported'),
    );

    expect(imported.kind).toBe('class-pack');
    expect(
      readWorkshopPacks()
        .flatMap((pack) => pack.classes)
        .map((profession) => profession.id),
    ).toEqual(['custom_class_direct', 'custom_class_imported']);
    expect(readWorkshopTestCandidate('custom_class_imported')?.profession.id)
      .toBe('custom_class_imported');
  });

  it('把上一版测试候选迁移为正式职业且保留最新修改和随包机制', () => {
    const classId = 'custom_class_legacy_candidate';
    const mechanismId = 'author.legacy-resource';
    const installed = workshopPack(classId, 2);
    saveWorkshopPack(installed);
    const candidate = workshopPack(classId, 777);
    const legacyCandidate = {
      ...candidate,
      classes: candidate.classes.map((profession) => ({
        ...profession,
        mechanismIds: [mechanismId],
        cards: profession.cards.map((card, index) =>
          index === 0
            ? {
                ...card,
                powerScore: 777,
                effects: [
                  {
                    type: 'damage',
                    value: 777,
                    target: 'enemy',
                    discount: 0.5,
                  },
                ],
              }
            : card,
        ),
      })),
    };
    localStorage.setItem('caelian_workshop_assessments_v1', '{"obsolete":true}');
    localStorage.setItem(
      WORKSHOP_TEST_STORAGE_KEY,
      JSON.stringify([
        {
          ...legacyCandidate,
          certifications: {
            [classId]: { evaluatorVersion: 'obsolete', combatHash: 'deadbeef' },
          },
          mechanisms: [
            {
              format: 'caelian_workshop_mechanism',
              version: 1,
              id: mechanismId,
              name: '旧候选资源',
              resources: [
                {
                  id: 'charge',
                  label: '充能',
                  min: 0,
                  max: 99,
                  initial: 7,
                  visible: true,
                },
              ],
              statuses: [],
              rules: [],
            },
          ],
        },
      ]),
    );

    expect(migrateLegacyWorkshopTestPacks()).toBe(1);
    expect(migrateLegacyWorkshopTestPacks()).toBe(0);
    expect(localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('caelian_workshop_assessments_v1')).toBeNull();
    expect(
      readWorkshopPacks()[0]?.classes[0]?.cards[0]?.effects[0]?.value,
    ).toBe(777);
    expect(readWorkshopMechanisms()[0]?.id).toBe(mechanismId);
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).not.toContain(
      'certifications',
    );
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).not.toContain(
      'powerScore',
    );
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).not.toContain(
      'discount',
    );
  });

  it('机制容量不足时不留下半迁移或半保存状态', () => {
    for (let index = 0; index < 39; index += 1) {
      saveWorkshopMechanism(workshopMechanism(`author.existing-${index}`));
    }
    const originalMechanisms = localStorage.getItem(
      WORKSHOP_MECHANISM_STORAGE_KEY,
    );
    const overflowing = {
      ...workshopPack('custom_class_atomic_migration'),
      mechanisms: [
        workshopMechanism('author.overflow-a'),
        workshopMechanism('author.overflow-b'),
      ],
    };

    expect(() => saveWorkshopPack(overflowing)).toThrow(
      '自定义状态与资源已达到 40 个',
    );
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY))
      .toBe(originalMechanisms);

    localStorage.setItem(
      WORKSHOP_TEST_STORAGE_KEY,
      JSON.stringify([overflowing]),
    );
    expect(migrateLegacyWorkshopTestPacks()).toBe(0);
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY))
      .toBe(originalMechanisms);
    expect(localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)).toContain(
      'custom_class_atomic_migration',
    );
  });

  it('职业存储写入失败时回滚已写入的随包机制', () => {
    const mechanism = workshopMechanism('author.rollback-save');
    const value = {
      ...workshopPack('custom_class_rollback_save'),
      mechanisms: [mechanism],
    };
    value.classes[0]!.mechanismIds = [mechanism.id];
    const nativeSetItem = Storage.prototype.setItem;
    let rejected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      storedValue: string,
    ) {
      if (!rejected && key === WORKSHOP_STORAGE_KEY) {
        rejected = true;
        throw new Error('模拟职业存储写入失败');
      }
      nativeSetItem.call(this, key, storedValue);
    });

    expect(() => saveWorkshopPack(value)).toThrow('模拟职业存储写入失败');
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY)).toBeNull();
  });

  it('旧候选正式写入失败时恢复候选并回滚随包机制', () => {
    const mechanism = workshopMechanism('author.rollback-migration');
    const value = {
      ...workshopPack('custom_class_rollback_migration'),
      mechanisms: [mechanism],
    };
    value.classes[0]!.mechanismIds = [mechanism.id];
    const legacyValue = JSON.stringify([value]);
    localStorage.setItem(WORKSHOP_TEST_STORAGE_KEY, legacyValue);
    const nativeSetItem = Storage.prototype.setItem;
    let rejected = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      storedValue: string,
    ) {
      if (!rejected && key === WORKSHOP_STORAGE_KEY) {
        rejected = true;
        throw new Error('模拟迁移存储写入失败');
      }
      nativeSetItem.call(this, key, storedValue);
    });

    expect(migrateLegacyWorkshopTestPacks()).toBe(0);
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)).toBe(legacyValue);
  });

  it('不再计算强度分数、自动稀有度或按旧数值上限钳制', () => {
    const card = normalizeWorkshopCard(
      {
        name: '自由试作',
        type: 'attack',
        cost: 999,
        rarity: 'legendary',
        effects: [
          {
            type: 'damage',
            value: 500_000,
            lifesteal_ratio: 2,
            target: 'enemy',
            scaling: { stat: 'attack', percent: 500 },
          },
        ],
      },
      'custom_class_free',
    );
    expect(card).toMatchObject({
      cost: 999,
      rarity: 'legendary',
      effects: [
        expect.objectContaining({
          value: 500_000,
          lifesteal_ratio: 2,
          scaling: { stat: 'attack', percent: 500 },
        }),
      ],
    });
    expect(card).not.toHaveProperty('powerScore');

    expect(
      normalizeCardEffect({
        type: 'damage_from_shield',
        ratio: 3,
        target: 'enemy',
      }),
    ).toMatchObject({ ratio: 3 });
    expect(
      normalizeCardEffect({ type: 'thorns', value: 100, target: 'self' }),
    ).toMatchObject({ value: 100 });
    expect(
      normalizeCardEffect({
        type: 'summon',
        attackable: true,
        hp_ratio: 500,
        duration: 12,
        skills: [
          {
            name: '冲撞',
            weight: 1,
            effects: [{ type: 'damage', value: 1, target: 'enemy' }],
          },
        ],
      }),
    ).toMatchObject({ hp_ratio: 500, duration: 12 });
    expect(
      normalizeTalentEffect({ type: 'extra_draw', value: 99 }),
    ).toMatchObject({ value: 99 });
    expect(
      normalizeCardEffect({
        type: 'damage',
        value: 1,
        hits: 999_999,
        target: 'enemy',
      }),
    ).toMatchObject({ hits: MAX_CARD_EFFECT_HITS });
  });

  it('条件积木只保留执行语义，不写入平衡折扣', () => {
    const normalized = normalizeCardEffect({
      type: 'conditional_group',
      logic: 'and',
      conditions: [
        { type: 'spend_mp', amount: 40 },
        { type: 'spend_hp', amount: 100 },
      ],
      then_effects: [{ type: 'damage', value: 200, target: 'enemy' }],
    });
    const conditions = normalized?.conditions as Array<Record<string, unknown>>;
    expect(conditions).toEqual([
      expect.objectContaining({ type: 'spend_mp', amount: 40 }),
      expect.objectContaining({ type: 'spend_hp', amount: 100 }),
    ]);
    expect(normalized).not.toHaveProperty('discount');
    expect(conditions[0]).not.toHaveProperty('discount');
  });

  it('仍拒绝重复效果并验证卡组与机制引用结构', () => {
    expect(() =>
      normalizeWorkshopCard(
        {
          name: '重复攻击',
          type: 'attack',
          cost: 3,
          effects: [
            { type: 'damage', value: 4, target: 'enemy' },
            { type: 'damage', value: 5, target: 'enemy' },
          ],
        },
        'custom_class_test',
      ),
    ).toThrow('同类效果只能添加一次');

    const raw = workshopPack('custom_class_missing_mechanism');
    raw.classes[0]!.mechanismIds = ['author.missing'];
    expect(() => normalizeWorkshopPack(raw)).toThrow('不存在的底层机制');
  });

  it('固定十五张基础构筑不再限制同名卡最多三张', () => {
    const raw = workshopPack('custom_class_unlimited_copies');
    const cards = raw.classes[0]!.cards;
    raw.classes[0]!.cardPool = [
      ...Array.from({ length: 15 }, () => cards[0]!.id),
      ...cards.slice(1).map((card) => card.id),
    ];
    raw.classes[0]!.starterDeck = Array.from(
      { length: 15 },
      () => cards[0]!.id,
    );

    const normalized = normalizeWorkshopPack(raw);
    expect(normalized.classes[0]?.starterDeck).toHaveLength(15);
    expect(new Set(normalized.classes[0]?.starterDeck)).toEqual(
      new Set([cards[0]!.id]),
    );
  });

  it('规范化召唤技能权重并随职业包导出依赖机制', () => {
    const summon = normalizeWorkshopCard(
      {
        name: '双生使魔',
        type: 'summon',
        cost: 5,
        rarity: 'epic',
        effects: [
          {
            type: 'summon',
            name: '使魔',
            attackable: false,
            duration: 2,
            skills: [
              {
                name: '啄击',
                weight: 1,
                effects: [{ type: 'damage', value: 4, target: 'enemy' }],
              },
              {
                name: '护主',
                weight: 3,
                effects: [{ type: 'shield', value: 3, target: 'self' }],
              },
            ],
          },
        ],
      },
      'custom_class_test',
    );
    const skills = summon.effects[0]?.skills as Array<{ weight: number }>;
    expect(skills.map((skill) => skill.weight)).toEqual([0.25, 0.75]);

    const mechanism = saveWorkshopMechanism({
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: 'author.exported',
      name: '导出机制',
      resources: [],
      statuses: [],
      rules: [
        {
          id: 'author.exported.log',
          trigger: 'battle_start',
          once: 'battle',
          actions: [{ type: 'log', message: '已加载' }],
        },
      ],
    });
    const raw = workshopPack('custom_class_export');
    raw.classes[0]!.mechanismIds = [mechanism.id];
    expect(exportWorkshopPack(raw).mechanisms?.[0]?.id).toBe(mechanism.id);
  });
});
