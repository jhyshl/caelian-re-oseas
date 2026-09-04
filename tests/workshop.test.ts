import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKSHOP_STORAGE_KEY,
  WORKSHOP_TEST_STORAGE_KEY,
  cardLimit,
  cardScore,
  exportWorkshopPack,
  importWorkshopArtifact,
  normalizeWorkshopCard,
  normalizeCardEffect,
  normalizeWorkshopPack,
  readWorkshopPacks,
  readWorkshopTestCandidate,
  readWorkshopTestPacks,
  saveWorkshopPack,
  saveWorkshopTestPack,
  talentScore,
} from '@/workshop';
import { PARTY_SUPPORT_CARDS } from '@/battle/party-support-cards';
import {
  deleteWorkshopMechanism,
  readWorkshopMechanisms,
  saveWorkshopMechanism,
} from '@/workshop-mechanisms';
import {
  WORKSHOP_ASSESSMENT_VERSION,
  workshopCombatFingerprint,
} from '@/workshop-certification';

afterEach(() => {
  localStorage.clear();
});

function workshopCandidate(id: string) {
  const cards = Array.from({ length: 8 }, (_, index) => ({
    id: `${id}_card_${index}`,
    name: `候选卡牌${index + 1}`,
    type: 'attack',
    cost: 0,
    effects: [{ type: 'damage', value: 1, target: 'enemy' }],
  }));
  return {
    format: 'caelian_workshop_class_pack',
    version: 1,
    packName: `${id}测试包`,
    classes: [
      {
        id,
        main: 'freelance',
        name: `${id}测试职业`,
        talent: { name: '测试天赋', description: '无', effects: [] },
        cards,
        cardPool: [...cards, ...cards].map((card) => card.id),
        starterDeck: Array.from(
          { length: 15 },
          (_, index) => cards[index % cards.length]!.id,
        ),
      },
    ],
  };
}

describe('旧版创意工坊规则', () => {
  it('测试候选与导入职业只进入隔离存储，不会提前变成可用职业', () => {
    saveWorkshopTestPack(workshopCandidate('custom_class_direct_candidate'));

    const imported = importWorkshopArtifact(
      workshopCandidate('custom_class_import_candidate'),
    );

    expect(imported.kind).toBe('class-pack');
    expect(readWorkshopPacks()).toEqual([]);
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).toBeNull();
    expect(
      readWorkshopTestPacks().flatMap((pack) =>
        pack.classes.map((profession) => profession.id),
      ),
    ).toEqual([
      'custom_class_direct_candidate',
      'custom_class_import_candidate',
    ]);
  });

  it('正式多职业包只替换重合职业并保留兄弟职业与对应认证', () => {
    const first = workshopCandidate('custom_class_formal_sibling_a');
    const second = workshopCandidate('custom_class_formal_sibling_b');
    const combined = normalizeWorkshopPack({
      ...first,
      packName: '正式多职业包',
      classes: [...first.classes, ...second.classes],
    });
    const certifications = Object.fromEntries(
      combined.classes.map((profession) => [
        profession.id,
        {
          evaluatorVersion: WORKSHOP_ASSESSMENT_VERSION,
          combatHash: workshopCombatFingerprint(profession),
        },
      ]),
    );
    saveWorkshopPack({ ...combined, certifications });

    saveWorkshopPack(first);

    const raw = JSON.parse(
      localStorage.getItem(WORKSHOP_STORAGE_KEY) ?? '[]',
    ) as Array<{
      classes: Array<{ id: string }>;
      certifications?: Record<string, unknown>;
    }>;
    const siblingPack = raw.find((pack) =>
      pack.classes.some(
        (profession) => profession.id === 'custom_class_formal_sibling_b',
      ),
    );
    expect(siblingPack?.classes.map((profession) => profession.id)).toEqual([
      'custom_class_formal_sibling_b',
    ]);
    expect(Object.keys(siblingPack?.certifications ?? {})).toEqual([
      'custom_class_formal_sibling_b',
    ]);
    expect(
      readWorkshopPacks()
        .flatMap((pack) => pack.classes.map((profession) => profession.id))
        .sort(),
    ).toEqual([
      'custom_class_formal_sibling_a',
      'custom_class_formal_sibling_b',
    ]);
  });

  it('测试多职业包只替换重合职业并保留兄弟职业与对应认证', () => {
    const first = workshopCandidate('custom_class_test_sibling_a');
    const second = workshopCandidate('custom_class_test_sibling_b');
    const combined = normalizeWorkshopPack({
      ...first,
      packName: '测试多职业包',
      classes: [...first.classes, ...second.classes],
    });
    const certifications = Object.fromEntries(
      combined.classes.map((profession) => [
        profession.id,
        {
          evaluatorVersion: WORKSHOP_ASSESSMENT_VERSION,
          combatHash: workshopCombatFingerprint(profession),
        },
      ]),
    );
    saveWorkshopTestPack({ ...combined, certifications });

    saveWorkshopTestPack(first);

    const raw = JSON.parse(
      localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY) ?? '[]',
    ) as Array<{
      classes: Array<{ id: string }>;
      certifications?: Record<string, unknown>;
    }>;
    const siblingPack = raw.find((pack) =>
      pack.classes.some(
        (profession) => profession.id === 'custom_class_test_sibling_b',
      ),
    );
    expect(siblingPack?.classes.map((profession) => profession.id)).toEqual([
      'custom_class_test_sibling_b',
    ]);
    expect(Object.keys(siblingPack?.certifications ?? {})).toEqual([
      'custom_class_test_sibling_b',
    ]);
    expect(
      readWorkshopTestPacks()
        .flatMap((pack) => pack.classes.map((profession) => profession.id))
        .sort(),
    ).toEqual([
      'custom_class_test_sibling_a',
      'custom_class_test_sibling_b',
    ]);
  });

  it('同 ID 候选职业和随包机制不会覆盖已发布版本', () => {
    const classId = 'custom_class_isolated_revision';
    const mechanismId = 'test.isolated-revision-resource';
    const mechanism = (maximum: number) => ({
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: mechanismId,
      name: '候选隔离资源',
      resources: [
        {
          id: 'charge',
          label: '充能',
          min: 0,
          max: maximum,
          initial: 0,
          visible: true,
        },
      ],
      statuses: [],
      rules: [],
    });
    const base = workshopCandidate(classId);
    const published = {
      ...base,
      mechanisms: [mechanism(3)],
      classes: base.classes.map((profession) => ({
        ...profession,
        name: '已发布旧版',
        mechanismIds: [mechanismId],
      })),
    };
    saveWorkshopPack(published);
    const publishedHash = workshopCombatFingerprint(
      readWorkshopPacks()[0]!.classes[0]!,
    );

    const candidate = structuredClone(published);
    candidate.classes[0]!.name = '隔离候选新版';
    candidate.classes[0]!.cards[0]!.effects[0]!.value = 7;
    candidate.mechanisms[0]!.resources[0]!.max = 9;
    saveWorkshopTestPack(candidate);

    expect(readWorkshopPacks()[0]?.classes[0]).toMatchObject({
      id: classId,
      name: '已发布旧版',
    });
    expect(
      readWorkshopPacks()[0]?.classes[0]?.cards[0]?.effects[0]?.value,
    ).toBe(1);
    expect(
      readWorkshopMechanisms().find((entry) => entry.id === mechanismId)
        ?.resources[0]?.max,
    ).toBe(3);
    expect(readWorkshopTestCandidate(classId)?.profession.name).toBe(
      '隔离候选新版',
    );
    expect(readWorkshopTestCandidate(classId)?.mechanisms[0]?.resources[0]?.max)
      .toBe(9);

    const candidateHash = workshopCombatFingerprint(
      readWorkshopTestCandidate(classId)!.profession,
    );
    expect(candidateHash).not.toBe(publishedHash);
    expect(workshopCombatFingerprint(readWorkshopPacks()[0]!.classes[0]!))
      .toBe(publishedHash);

    saveWorkshopMechanism(mechanism(4));
    expect(workshopCombatFingerprint(readWorkshopPacks()[0]!.classes[0]!))
      .not.toBe(publishedHash);
    expect(
      workshopCombatFingerprint(
        readWorkshopTestCandidate(classId)!.profession,
      ),
    ).toBe(candidateHash);
  });

  it('候选未捆绑机制时，指纹会跟随当前全局机制变化', () => {
    const classId = 'custom_class_global_mechanism_candidate';
    const mechanismId = 'test.global-mechanism-fingerprint';
    const mechanism = (maximum: number) => ({
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: mechanismId,
      name: '全局机制指纹',
      resources: [
        {
          id: 'charge',
          label: '充能',
          min: 0,
          max: maximum,
          initial: 0,
          visible: true,
        },
      ],
      statuses: [],
      rules: [],
    });
    saveWorkshopMechanism(mechanism(3));
    const raw = workshopCandidate(classId);
    const candidate = saveWorkshopTestPack({
      ...raw,
      classes: raw.classes.map((profession) => ({
        ...profession,
        mechanismIds: [mechanismId],
      })),
    }).classes[0]!;
    const before = workshopCombatFingerprint(candidate);

    saveWorkshopMechanism(mechanism(4));

    expect(workshopCombatFingerprint(candidate)).not.toBe(before);
  });

  it('没有认证标记的历史正式职业继续兼容可用', () => {
    const classId = 'custom_class_grandfathered_install';
    const mechanismId = 'test.grandfathered-mechanism';
    const mechanism = (maximum: number) => ({
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: mechanismId,
      name: '历史职业机制',
      resources: [
        {
          id: 'charge',
          label: '充能',
          min: 0,
          max: maximum,
          initial: 0,
          visible: true,
        },
      ],
      statuses: [],
      rules: [],
    });
    const raw = workshopCandidate(classId);
    saveWorkshopPack({
      ...raw,
      mechanisms: [mechanism(3)],
      classes: raw.classes.map((profession) => ({
        ...profession,
        mechanismIds: [mechanismId],
      })),
    });
    const stored = JSON.parse(
      localStorage.getItem(WORKSHOP_STORAGE_KEY) ?? '[]',
    ) as Array<Record<string, unknown>>;
    expect(stored[0]?.certifications).toBeUndefined();

    saveWorkshopMechanism(mechanism(9));

    expect(readWorkshopPacks()[0]?.classes[0]?.id).toBe(classId);
    expect(readWorkshopTestCandidate(classId)?.profession.id).toBe(classId);
  });

  it('依赖缺失的测试候选保留原始数据并提示恢复路径', () => {
    const classId = 'custom_class_recoverable_missing_candidate';
    const mechanismId = 'test.recoverable-missing-candidate';
    const mechanism = {
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: mechanismId,
      name: '可恢复候选机制',
      resources: [
        {
          id: 'charge',
          label: '充能',
          min: 0,
          max: 3,
          initial: 0,
          visible: true,
        },
      ],
      statuses: [],
      rules: [],
    };
    saveWorkshopMechanism(mechanism);
    const raw = workshopCandidate(classId);
    saveWorkshopTestPack({
      ...raw,
      classes: raw.classes.map((profession) => ({
        ...profession,
        mechanismIds: [mechanismId],
      })),
    });
    const storedCandidate = localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY);

    expect(deleteWorkshopMechanism(mechanismId)).toBe(true);
    expect(readWorkshopTestPacks()).toEqual([]);
    expect(localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)).toBe(storedCandidate);
    expect(() => readWorkshopTestCandidate(classId)).toThrow(
      '测试候选仍保存在本机',
    );
    expect(() => readWorkshopTestCandidate(classId)).toThrow(
      '重新导入或恢复它依赖的底层机制、资源或状态',
    );

    saveWorkshopMechanism(mechanism);
    expect(readWorkshopTestCandidate(classId)?.profession.id).toBe(classId);
    expect(localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)).toBe(storedCandidate);
  });

  it('全部职业群体支援牌都不超过旧版强度控制器', () => {
    expect(Object.keys(PARTY_SUPPORT_CARDS)).toHaveLength(24);
    for (const card of Object.values(PARTY_SUPPORT_CARDS)) {
      expect(cardScore(card), card.name).toBeLessThanOrEqual(
        cardLimit(card.cost),
      );
    }
  });

  it('使用旧版 AP 强度上限并自动判定稀有度', () => {
    expect(cardLimit(0)).toBe(10);
    expect(cardLimit(10)).toBe(206);

    const card = normalizeWorkshopCard(
      {
        name: '传说试作',
        type: 'attack',
        cost: 10,
        description: '测试',
        effects: [{ type: 'damage', value: 130, target: 'enemy' }],
      },
      'custom_class_test',
    );
    expect(card.powerScore).toBe(130);
    expect(card.rarity).toBe('legendary');

    expect(() =>
      normalizeWorkshopCard(
        {
          name: '零费越界',
          type: 'attack',
          cost: 0,
          effects: [{ type: 'damage', value: 11, target: 'enemy' }],
        },
        'custom_class_test',
      ),
    ).toThrow('强度过高');
  });

  it('把支付 MP 与支付 HP 规范化为降低强度占用的条件积木', () => {
    const mpCondition = normalizeCardEffect({
      type: 'conditional_group',
      logic: 'and',
      conditions: [{ type: 'spend_mp', amount: 4 }],
      then_effects: [{ type: 'damage', value: 20, target: 'enemy' }],
    });
    const hpCondition = normalizeCardEffect({
      type: 'conditional_group',
      logic: 'and',
      conditions: [{ type: 'spend_hp', amount: 10 }],
      then_effects: [{ type: 'damage', value: 20, target: 'enemy' }],
    });

    expect(mpCondition?.conditions).toEqual([
      expect.objectContaining({ type: 'spend_mp', amount: 4, discount: 0.74 }),
    ]);
    expect(hpCondition?.conditions).toEqual([
      expect.objectContaining({ type: 'spend_hp', amount: 10, discount: 0.68 }),
    ]);
    expect(cardScore({ effects: [mpCondition!] })).toBeLessThan(20);
    expect(cardScore({ effects: [hpCondition!] })).toBeLessThan(20);
  });

  it('保留两种同名卡牌历史条件并纳入强度折扣', () => {
    const normalized = normalizeCardEffect({
      type: 'conditional_group',
      logic: 'and',
      conditions: [
        { type: 'same_card_played_this_turn' },
        { type: 'previous_card_same_name' },
      ],
      then_effects: [{ type: 'damage', value: 20, target: 'enemy' }],
      else_effects: [{ type: 'shield', value: 2, target: 'self' }],
    });

    expect(normalized?.conditions).toEqual([
      expect.objectContaining({
        type: 'same_card_played_this_turn',
        discount: 0.78,
      }),
      expect.objectContaining({
        type: 'previous_card_same_name',
        discount: 0.72,
      }),
    ]);
    expect(cardScore({ effects: [normalized!] })).toBeCloseTo(11.232);
  });

  it('拒绝同一卡牌的重复同类效果', () => {
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
  });

  it('保留移除护盾的己方/召唤物目标与 x+y% 属性公式', () => {
    expect(
      normalizeCardEffect({ type: 'strip_shield', target: 'self' }),
    ).toMatchObject({ type: 'strip_shield', target: 'self' });
    expect(
      normalizeCardEffect({ type: 'strip_shield', target: 'all_summons' }),
    ).toMatchObject({ type: 'strip_shield', target: 'all_summons' });
    expect(
      normalizeCardEffect({
        type: 'damage',
        target: 'enemy',
        value: 8,
        scaling: { stat: 'attack', percent: 25 },
      }),
    ).toMatchObject({
      value: 8,
      scaling: { stat: 'attack', percent: 25 },
    });
    expect(
      normalizeCardEffect({
        type: 'shield',
        target: 'self',
        value: 3,
        scaling: { stat: 'unknown', percent: 50 },
      }),
    ).not.toHaveProperty('scaling');
  });

  it('开放防反、反击与烧血积木并保持布尔天赋强度', () => {
    expect(
      normalizeCardEffect({
        type: 'apply_buff',
        buff: 'defense_reflect',
        value: 99,
        turns: 3,
        target: 'self',
      }),
    ).toMatchObject({ buff: 'defense_reflect', value: 1, turns: 3 });
    expect(
      normalizeCardEffect({
        type: 'apply_buff',
        buff: 'counterattack',
        turns: 2,
        target: 'self',
      }),
    ).toMatchObject({ buff: 'counterattack', value: 1, turns: 2 });
    expect(
      normalizeCardEffect({
        type: 'apply_buff',
        buff: 'blood_burn',
        value: 20,
        turns: 4,
        target: 'self',
      }),
    ).toMatchObject({ buff: 'blood_burn', value: 20, turns: 4 });
    expect(
      talentScore([
        { type: 'defense_reflect' },
        { type: 'counterattack' },
      ]),
    ).toBe(24);
  });

  it('按官方公式校验空白牌生成、持续生成、揭晓伤害与手牌上限', () => {
    expect(
      cardScore({
        effects: [{ type: 'generate_blank_to_draw', value: 2, target: 'self' }],
      }),
    ).toBe(12);
    expect(
      cardScore({
        effects: [{ type: 'blank_regen', value: 1, turns: 3, target: 'self' }],
      }),
    ).toBe(13.5);
    expect(
      cardScore({
        effects: [{ type: 'discard_blank_damage', value: 12, target: 'enemy' }],
      }),
    ).toBe(60);
    expect(
      talentScore([
        { type: 'extra_draw', value: 1 },
        { type: 'hand_limit_bonus', value: 5 },
      ]),
    ).toBe(24);
  });

  it('规范化召唤技能权重并要求召唤牌包含召唤物', () => {
    const card = normalizeWorkshopCard(
      {
        name: '双生使魔',
        type: 'summon',
        cost: 5,
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
    const summon = card.effects[0];
    const skills = summon?.skills as Array<{ weight: number }>;
    expect(skills.map((skill) => skill.weight)).toEqual([0.25, 0.75]);

    expect(() =>
      normalizeWorkshopCard(
        {
          name: '空召唤',
          type: 'summon',
          cost: 1,
          effects: [{ type: 'draw', value: 1 }],
        },
        'custom_class_test',
      ),
    ).toThrow('必须创建一个召唤物');
  });

  it('校验 16–32 张职业卡池和固定 15 张基础构筑', () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `card_${index}`,
      name: `卡牌${index}`,
      type: 'skill',
      cost: 1,
      effects: [{ type: 'draw', value: 1 }],
    }));
    const value = {
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '测试职业包',
      classes: [
        {
          id: 'custom_class_test',
          main: 'mage',
          name: '测试职业',
          talent: {
            name: '测试天赋',
            description: '测试说明',
            effects: [{ type: 'extra_draw', value: 1 }],
          },
          cards,
          cardPool: [...cards, ...cards].map((card) => card.id),
          starterDeck: Array.from(
            { length: 15 },
            (_, index) => cards[index % cards.length]!.id,
          ),
          mechanismIds: ['author.test-mechanism'],
        },
      ],
      mechanisms: [
        {
          format: 'caelian_workshop_mechanism',
          version: 1,
          id: 'author.test-mechanism',
          name: '测试机制',
          resources: [],
          rules: [
            {
              id: 'author.test-mechanism.log',
              trigger: 'battle_start',
              once: 'battle',
              actions: [{ type: 'log', message: '测试机制已加载' }],
            },
          ],
        },
      ],
    };
    const normalized = normalizeWorkshopPack(value);
    expect(normalized.format).toBe('caelian_workshop_class_pack');
    expect(normalized.classes[0]?.cards).toHaveLength(8);
    expect(normalized.classes[0]?.cardPool).toHaveLength(16);
    expect(normalized.classes[0]?.starterDeck).toHaveLength(15);

    saveWorkshopPack(value);
    expect(localStorage.getItem(WORKSHOP_STORAGE_KEY)).toContain(
      'custom_class_test',
    );
    expect(readWorkshopPacks()[0]?.classes[0]?.name).toBe('测试职业');
    expect(readWorkshopMechanisms()[0]?.id).toBe('author.test-mechanism');
    expect(exportWorkshopPack(value).mechanisms?.[0]?.id).toBe(
      'author.test-mechanism',
    );
  });

  it('拒绝少于 8 种不同名称的职业卡牌', () => {
    const cards = Array.from({ length: 7 }, (_, index) => ({
      id: `short_card_${index}`,
      name: `不足卡牌${index}`,
      type: 'skill',
      cost: 1,
      effects: [{ type: 'draw', value: 1 }],
    }));
    expect(() =>
      normalizeWorkshopPack({
        classes: [
          {
            id: 'custom_class_short',
            main: 'mage',
            name: '不足职业',
            talent: { name: '天赋', effects: [] },
            cards,
            cardPool: [...cards, ...cards].map((card) => card.id),
            starterDeck: Array.from(
              { length: 15 },
              (_, index) => cards[index % cards.length]!.id,
            ),
          },
        ],
      }),
    ).toThrow('8–16 种');
  });

  it('不兼容缺少职业卡池或非 15 张基础构筑的旧职业包', () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `strict_card_${index}`,
      name: `严格卡牌${index}`,
      type: 'skill',
      cost: 1,
      effects: [{ type: 'draw', value: 1 }],
    }));
    const profession = {
      id: 'custom_class_strict',
      main: 'mage',
      name: '严格职业',
      talent: { name: '天赋', effects: [] },
      cards,
      starterDeck: Array.from(
        { length: 15 },
        (_, index) => cards[index % cards.length]!.id,
      ),
    };
    expect(() => normalizeWorkshopPack({ classes: [profession] })).toThrow(
      '必须为 16–32 张',
    );
    expect(() =>
      normalizeWorkshopPack({
        classes: [
          {
            ...profession,
            cardPool: [...cards, ...cards].map((card) => card.id),
            starterDeck: profession.starterDeck.slice(0, 14),
          },
        ],
      }),
    ).toThrow('必须正好 15 张');
  });

  it('自制职业的固定 15 张基础构筑仍限制同名卡最多 3 张', () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `limited_card_${index}`,
      name: `限制卡牌${index}`,
      type: 'skill',
      cost: 1,
      effects: [{ type: 'draw', value: 1 }],
    }));
    expect(() =>
      normalizeWorkshopPack({
        classes: [
          {
            id: 'custom_class_copy_limit',
            main: 'mage',
            name: '重复限制职业',
            talent: { name: '天赋', effects: [] },
            cards,
            cardPool: [
              ...Array.from({ length: 4 }, () => cards[0]!.id),
              ...cards.slice(1).flatMap((card) => [card.id, card.id]),
            ],
            starterDeck: [
              ...Array.from({ length: 4 }, () => cards[0]!.id),
              ...Array.from({ length: 11 }, (_, index) =>
                cards[(index % 7) + 1]!.id,
              ),
            ],
          },
        ],
      }),
    ).toThrow('同名卡牌最多放入 3 张');
  });
});
