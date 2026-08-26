import type { CardDefinition, CardEffect } from '@/content/types';
import { readWorkshopPacks } from '@/workshop';
import { PARTY_SUPPORT_CARDS } from '@/battle/party-support-cards';
import { MAGICIAN_CARDS } from '@/content/catalogs/magician';

let cardCache: Record<string, CardDefinition> | undefined;
let commonMarketCache: Record<string, CardDefinition> | undefined;
const installedWorkshopCardIds = new Set<string>();

const POISON_DOUBLE_CARD_IDS = new Set([
  'wood_poison_bloom',
  'al_catalyst',
  'ap_poison_amplifier',
]);

const CARD_EFFECT_OVERLAYS: Record<string, CardEffect[]> = {
  sk_deep_ambush: [
    { type: 'trap', value: 12, target: 'enemy' },
  ],
  vh_trap: [
    { type: 'trap', value: 12, target: 'enemy' },
  ],
  wood_green_breath: [
    {
      type: 'apply_buff',
      buff: 'regen',
      value: 3,
      turns: 3,
      target: 'all_allies',
    },
  ],
};

const SUMMON_SELF_SHIELD_TEXT_OVERLAYS: Record<
  string,
  { description: string; brief: string; skillName: string }
> = {
  hk_sun_banner: {
    description: 'AP 2｜不可攻击，存在 3 回合；技能：自身获得 5 护盾 / 敌方灼烧 2',
    brief: '不可攻击，存在 3 回合；技能：自身获得 5 护盾 / 敌方灼烧 2',
    skillName: '自身获得 5 护盾',
  },
  dk_young_dragon: {
    description: 'AP 3｜可攻击，生命为玩家生命上限 45%；技能：造成 7 伤害 / 灼烧 3 / 自身获得 5 护盾',
    brief: '可攻击，生命为玩家生命上限 45%；技能：造成 7 伤害 / 灼烧 3 / 自身获得 5 护盾',
    skillName: '自身获得 5 护盾',
  },
  su_guardian_puppet: {
    description: 'AP 2 / MP 1｜可攻击，生命 45%；技能：自身获得 5 护盾',
    brief: '可攻击，生命 45%；技能：自身获得 5 护盾',
    skillName: '自身获得 5 护盾',
  },
};

function upsertBuff(
  effects: CardEffect[],
  buff: string,
  value: number,
): CardEffect[] {
  return [
    ...effects.filter(
      (effect) =>
        !(effect.type === 'apply_buff' && String(effect.buff) === buff),
    ),
    {
      type: 'apply_buff',
      buff,
      value,
      turns: 1,
      target: 'self',
    },
  ];
}

function applyCardEffectOverlay(
  cardId: string,
  effects: CardEffect[],
): CardEffect[] {
  const replacement = CARD_EFFECT_OVERLAYS[cardId];
  if (replacement) return replacement.map((effect) => ({ ...effect }));

  if (cardId === 'bs_core_overheat') {
    return upsertBuff(effects, 'attack_amp_percent', 35);
  }
  if (cardId === 'pr_devotion') {
    return upsertBuff(effects, 'healing_amp_percent', 35);
  }
  if (cardId === 'mc_shock_mine') {
    return [
      { type: 'trap', value: 10, target: 'enemy' },
      ...effects.filter((effect) => effect.type !== 'trap'),
    ];
  }
  if (cardId === 'wm_ice_wave') {
    return effects.flatMap((effect) =>
      effect.type === 'apply_debuff' && effect.debuff === 'freeze'
        ? [
            {
              type: 'conditional_group',
              conditions: [
                { type: 'enemy_has_specific_debuff', debuff: 'wet' },
              ],
              then_effects: [{ ...effect }],
            },
          ]
        : [effect],
    );
  }
  return effects;
}

/**
 * The legacy card database encoded "double poison" as `apply_debuff +2`.
 * Normalize by card identity rather than by the old numeric payload so stale
 * card instances and future catalog refreshes cannot fall back to addition.
 */
export function normalizeBuiltInCardEffect(
  cardId: string,
  effect: CardEffect,
): CardEffect {
  if (
    !POISON_DOUBLE_CARD_IDS.has(cardId) ||
    effect.debuff !== 'poison' ||
    (effect.type !== 'apply_debuff' && effect.type !== 'double_debuff')
  ) {
    return effect;
  }
  const normalized = { ...effect };
  delete normalized.value;
  delete normalized.turns;
  delete normalized.chance;
  return {
    ...normalized,
    type: 'double_debuff',
    debuff: 'poison',
    target: effect.target ?? 'enemy',
  };
}

function applyLegacyCardCompatibility(
  catalog: Record<string, CardDefinition>,
): Record<string, CardDefinition> {
  const compatible = { ...catalog };
  const overlayCardIds = new Set([
    ...POISON_DOUBLE_CARD_IDS,
    ...Object.keys(CARD_EFFECT_OVERLAYS),
    'bs_core_overheat',
    'pr_devotion',
    'mc_shock_mine',
    'wm_ice_wave',
    ...Object.keys(SUMMON_SELF_SHIELD_TEXT_OVERLAYS),
  ]);
  for (const cardId of overlayCardIds) {
    const card = compatible[cardId];
    if (!card) continue;
    const textOverlay = SUMMON_SELF_SHIELD_TEXT_OVERLAYS[cardId];
    const effects = applyCardEffectOverlay(
      cardId,
      (card.effects ?? []).map((effect) =>
        normalizeBuiltInCardEffect(cardId, effect),
      ),
    ).map((effect) => {
      if (!textOverlay || effect.type !== 'summon' || !Array.isArray(effect.skills)) {
        return effect;
      }
      return {
        ...effect,
        skills: effect.skills.map((rawSkill) => {
          if (typeof rawSkill !== 'object' || rawSkill === null) return rawSkill;
          const skill = rawSkill as Record<string, unknown>;
          const skillEffects = Array.isArray(skill.effects)
            ? (skill.effects as CardEffect[])
            : [];
          const shieldsSelf = skillEffects.some(
            (skillEffect) =>
              skillEffect.type === 'shield' && skillEffect.target === 'self',
          );
          return shieldsSelf
            ? { ...skill, name: textOverlay.skillName }
            : skill;
        }),
      };
    });
    compatible[cardId] = {
      ...card,
      ...(textOverlay
        ? { description: textOverlay.description, brief: textOverlay.brief }
        : {}),
      effects,
    };
  }
  return compatible;
}

export function refreshWorkshopCardCatalog(): void {
  if (!cardCache) return;
  for (const cardId of installedWorkshopCardIds) delete cardCache[cardId];
  installedWorkshopCardIds.clear();
  for (const pack of readWorkshopPacks()) {
    for (const profession of pack.classes) {
      for (const card of profession.cards) {
        cardCache[card.id] = card;
        installedWorkshopCardIds.add(card.id);
      }
    }
  }
}

export async function loadCommonMarketCards(): Promise<
  Record<string, CardDefinition>
> {
  if (!commonMarketCache) {
    const module = await import(
      '@/content/generated/cards/common-market.json'
    );
    commonMarketCache = module.default as Record<string, CardDefinition>;
  }
  return commonMarketCache;
}

export async function loadCardCatalog(): Promise<
  Record<string, CardDefinition>
> {
  if (!cardCache) {
    const [module, commonMarket] = await Promise.all([
      import('@/content/generated/cards/cards.json'),
      loadCommonMarketCards(),
    ]);
    cardCache = {
      ...applyLegacyCardCompatibility(
        module.default as Record<string, CardDefinition>,
      ),
      ...commonMarket,
      ...PARTY_SUPPORT_CARDS,
      ...MAGICIAN_CARDS,
    };
  }
  refreshWorkshopCardCatalog();
  return cardCache;
}

export async function loadCards(
  cardIds: string[],
): Promise<Array<{ id: string; definition: CardDefinition }>> {
  const catalog = await loadCardCatalog();
  return cardIds.flatMap((id) => {
    const definition = catalog[id];
    return definition ? [{ id, definition }] : [];
  });
}
