<script setup lang="ts">
/* global Document, HTMLElement, DOMRect, PointerEvent, setTimeout, requestAnimationFrame, cancelAnimationFrame */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  loadMonsterCatalog,
  type MonsterDefinition,
} from '@/content/catalogs/battle';
import { loadCardCatalog } from '@/content/catalogs/cards';
import {
  loadBattleItems,
  loadEquipmentDefinitions,
  loadRelics,
} from '@/content/catalogs/inventory';
import type {
  BattleItemDefinition,
  CardDefinition,
  CardEffect,
  EquipmentDefinition,
  RelicDefinition,
} from '@/content/types';
import {
  canApplyBattleConsumable,
  isBattleUsableItem,
} from '@/battle/consumables';
import { previewBattleCard } from '@/battle/card-preview';
import { bloodBurnCardUnavailableReason } from '@/battle/blood-burn';
import type {
  BattleAnimationEvent,
  BattleEnemyState,
  BattleFriendlyTargetId,
  BattleSummonState,
  GameSnapshot,
  LocalBattleState,
} from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import {
  cardRewardEffect,
  cardRewardMeta,
  equipmentRewardEffect,
  equipmentRewardMeta,
  relicRewardEffect,
  rewardRarityName,
} from '@/rewards/reward-display';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';
import MeterBar from '@/ui/adventurer/MeterBar.vue';
import {
  readWorkshopMechanisms,
  workshopStatusKey,
  type WorkshopMechanismStatus,
} from '@/workshop-mechanisms';
import {
  type BattleCardFaceType,
  battleCardFaceType,
  battleCardFaceUrl,
  loadBattleCardFaceUrls,
} from '@/modules/battle/card-face';
import {
  MAGICIAN_BLANK_CARD_ID,
  MAGICIAN_BLANK_LIMIT,
  MAGICIAN_SUBCLASS_ID,
} from '@/content/catalogs/magician';
import cardBuffNamesJson from '@/content/generated/battle/card-buff-names.json';
import cardDebuffNamesJson from '@/content/generated/battle/card-debuff-names.json';
import cardStatusDescriptionsJson from '@/content/generated/battle/card-status-descriptions.json';
import worldBuffNamesJson from '@/content/generated/battle/world-buff-names.json';
import worldDebuffNamesJson from '@/content/generated/battle/world-debuff-names.json';
import worldStatusDescriptionsJson from '@/content/generated/battle/world-status-descriptions.json';

type GeneratedStatusDescriptions = {
  buff: Record<string, string>;
  debuff: Record<string, string>;
} & Record<string, string | Record<string, string>>;

const generatedBuffNames = cardBuffNamesJson as Record<string, string>;
const generatedDebuffNames = cardDebuffNamesJson as Record<string, string>;
const generatedStatusDescriptions =
  cardStatusDescriptionsJson as GeneratedStatusDescriptions;
const worldBuffNames = worldBuffNamesJson as Record<string, string>;
const worldDebuffNames = worldDebuffNamesJson as Record<string, string>;
const worldStatusDescriptions =
  worldStatusDescriptionsJson as GeneratedStatusDescriptions;

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const monsters = ref<Record<string, MonsterDefinition>>({});
const cards = ref<Record<string, CardDefinition>>({});
const battleItems = ref<Record<string, BattleItemDefinition>>({});
const equipmentRewards = ref<Record<string, EquipmentDefinition>>({});
const relicRewards = ref<Record<string, RelicDefinition>>({});
const selectedTarget = ref(0);
const selectedAllyTarget = ref<BattleFriendlyTargetId | null>(null);
const selectedHandIndex = ref<number | null>(null);
const previewHandIndex = ref<number | null>(null);
const dragPreviewTargetIndex = ref<number | null>(null);
const dragPreviewAllyTarget = ref<BattleFriendlyTargetId | null>(null);
const showBattleInfo = ref(false);
const showBattleInventory = ref(false);
const showPileDetails = ref(false);
const notice = ref('');
const busy = ref(false);
const animationPlaying = ref(false);
const activeActorKey = ref('');
const hitTargetKey = ref('');
const glowTargetKey = ref('');
const animationCaption = ref('');
const floatingEffects = ref<FloatingEffect[]>([]);
const localCardFaceUrls = ref<Readonly<Record<BattleCardFaceType, string>>>();
let disposeStateListener: (() => void) | undefined;
let dragSession: CardDragSession | null = null;
let suppressCardClick = false;
let floatingSequence = 0;

interface FloatingEffect {
  id: string;
  targetKey: string;
  kind: 'damage' | 'heal' | 'shield' | 'mp' | 'ap' | 'status' | 'draw';
  text: string;
}

interface BattleInventoryRow {
  itemId: string;
  name: string;
  quantity: number;
  definition: BattleItemDefinition;
}

interface BattlePileRow {
  cardId: string;
  quantity: number;
  definition?: CardDefinition;
}

type BattlePlayerUiState = LocalBattleState['player'] & {
  manualDiscardTurn?: number;
  cardsPlayedThisTurn?: Record<string, number>;
};

interface ProfessionStatusEntry {
  id: string;
  label: string;
  value: string;
  description: string;
}

type ProfessionStatusDefinition = Omit<ProfessionStatusEntry, 'value'>;

interface CardDragSession {
  document: Document;
  source: HTMLElement;
  handIndex: number;
  cardId: string;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  origin: DOMRect;
  clone: HTMLElement | null;
  dropTarget: HTMLElement | null;
  frame: number | null;
  moved: boolean;
}

const activeDeck = computed(() =>
  snapshot.value?.decks.find((deck) => deck.active),
);
const battle = computed(() => snapshot.value?.battle ?? null);
const state = computed<LocalBattleState | null>(
  () => battle.value?.state ?? null,
);
const aliveEnemies = computed(
  () => state.value?.enemies.filter((enemy) => enemy.hp > 0) ?? [],
);
const recentLog = computed(() =>
  [...(state.value?.log ?? [])].slice(-20).reverse(),
);
const battleInventory = computed<BattleInventoryRow[]>(() =>
  (snapshot.value?.inventory ?? [])
    .flatMap((stack) => {
      const definition =
        battleItems.value[stack.itemId] ?? battleItems.value[stack.name];
      if (!isBattleUsableItem(definition)) return [];
      return [
        {
          itemId: stack.itemId,
          name: definition?.name ?? stack.name,
          quantity: stack.quantity,
          definition: definition!,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
);
const battleInventoryCount = computed(() =>
  battleInventory.value.reduce((total, item) => total + item.quantity, 0),
);
function pileRows(
  instances: LocalBattleState['player']['drawPile'],
): BattlePileRow[] {
  const grouped = new Map<string, number>();
  for (const instance of instances) {
    grouped.set(instance.cardId, (grouped.get(instance.cardId) ?? 0) + 1);
  }
  return [...grouped.entries()].map(([cardId, quantity]) => ({
    cardId,
    quantity,
    definition: cards.value[cardId],
  }));
}
const drawPileRows = computed(() => pileRows(state.value?.player.drawPile ?? []));
const discardPileRows = computed(() =>
  pileRows(state.value?.player.discardPile ?? []),
);
const discardableHandCount = computed(
  () =>
    state.value?.player.hand.filter(
      (instance) => instance.cardId !== MAGICIAN_BLANK_CARD_ID,
    ).length ?? 0,
);
const battlePlayerUi = computed(
  () => state.value?.player as BattlePlayerUiState | undefined,
);
const manualDiscardUsed = computed(
  () => battlePlayerUi.value?.manualDiscardTurn === state.value?.turn,
);
const discardUnavailableReason = computed(() => {
  const current = state.value;
  if (!current || current.phase !== 'player') return '当前不是玩家行动阶段。';
  if (manualDiscardUsed.value) return '本回合已使用过一次主动弃牌。';
  if (current.player.ap < 1) return '行动点不足。';
  if (discardableHandCount.value === 0) return '当前没有可弃置的非空白手牌。';
  return '';
});
const classResourceDefinitions = {
  holy_knight: {
    id: 'holy_sigil',
    label: '圣印',
    description: '圣辉誓约的可消耗层数。',
  },
  dragon_knight: {
    id: 'dragon_soul',
    label: '龙魂',
    description: '达到阈值后强化下一张攻击牌。',
  },
  elementalist: {
    id: 'element_resonance',
    label: '元素共鸣',
    description: '轮换不同元素法术时积累。',
  },
  fire_mage: {
    id: 'ember_echo',
    label: '余烬',
    description: '施加灼烧或点燃火种时积累。',
  },
  wind_mage: {
    id: 'wind_mark',
    label: '风痕',
    description: '风系连击可消耗的增伤层数。',
  },
  thunder_mage: {
    id: 'thunder_charge',
    label: '雷荷充能',
    description: '雷系牌积累的可消耗充能。',
  },
  wood_mage: {
    id: 'growth',
    label: '生长',
    description: '治疗与召唤积累的职业资源。',
  },
  blacksmith: {
    id: 'furnace_heat',
    label: '炉温',
    description: '攻击牌可消耗炉温获得额外伤害。',
  },
  mechanic: {
    id: 'parts',
    label: '零件',
    description: '召唤与功能牌积累的机械资源。',
  },
  dark_mage: {
    id: 'abyss_echo',
    label: '深渊回声',
    description: '自身失去生命时获得，分批按回合过期。',
  },
} as const;
const classResourceDefinitionsById = Object.fromEntries(
  Object.values(classResourceDefinitions).map((resource) => [
    resource.id,
    resource,
  ]),
) as Record<string, ProfessionStatusDefinition>;
classResourceDefinitionsById.hunter_prepare = {
  id: 'hunter_prepare',
  label: '猎杀准备',
  description: '吸血鬼猎人的血月准备层数。',
};

function formatClassResourceLabel(id: string): string {
  return id
    .split(/[_-]+/u)
    .filter(Boolean)
    .join(' ')
    .trim() || id;
}

function formatClassResourceValue(value: unknown): string {
  const numeric = Number(value);
  return String(Number.isFinite(numeric) ? Math.max(0, numeric) : 0);
}

const elementLabels: Record<string, string> = {
  fire: '火',
  water: '水',
  thunder: '雷',
  wind: '风',
  wood: '木',
  light: '光',
  dark: '暗',
  arcane: '奥术',
};

function elementLabel(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase();
  return key ? (elementLabels[key] ?? key) : '尚未锚定';
}

function activeAbyssEchoBatches(player: BattlePlayerUiState) {
  const turn = Math.max(1, Number(state.value?.turn) || 1);
  return (player.abyssEchoBatches ?? []).filter((batch) => {
    const value = Math.max(0, Math.floor(Number(batch.value) || 0));
    const gainedTurn = Math.max(1, Math.floor(Number(batch.turn) || turn));
    return value > 0 && turn - gainedTurn < 2;
  });
}

function weaponMasterNextComboBonus(
  playedBefore: number,
  player: BattlePlayerUiState,
): number {
  if (playedBefore <= 0 || player.buffs.weapon_master_no_combo) return 0;
  const base = playedBefore === 1 ? 2 : 4;
  const extra = battleEffectValue(player.buffs.weapon_master_bonus_extra);
  const cap = 4 + battleEffectValue(player.buffs.weapon_master_combo_cap);
  return Math.max(0, Math.min(cap, base + extra));
}

const professionStatusEntries = computed<ProfessionStatusEntry[]>(() => {
  const player = battlePlayerUi.value;
  if (!player) return [];
  const subclass = player.subclass ?? snapshot.value?.player.subclass ?? '';
  const entries: ProfessionStatusEntry[] = [];
  const displayedResourceIds = new Set<string>();
  const resource =
    classResourceDefinitions[
      subclass as keyof typeof classResourceDefinitions
    ];
  if (resource) {
    const value =
      resource.id === 'abyss_echo'
        ? (player.classResources?.[resource.id] ?? player.abyssEcho ?? 0)
        : (player.classResources?.[resource.id] ?? 0);
    const abyssBatches = resource.id === 'abyss_echo'
      ? activeAbyssEchoBatches(player)
      : [];
    entries.push({
      ...resource,
      value: resource.id === 'abyss_echo'
        ? `${formatClassResourceValue(value)} 层 · ${abyssBatches.length} 批`
        : formatClassResourceValue(value),
      description: statusDescription(resource.id, 'buff', resource.description),
    });
    displayedResourceIds.add(resource.id);
  }
  if (subclass === 'elementalist') {
    entries.push({
      id: 'elementalist_anchor',
      label: '元素锚点',
      value: elementLabel(player.lastElementalistElement),
      description: '记录上一张元素法术的元素；改用不同元素时会获得元素共鸣。',
    });
  }
  if (subclass === 'dark_mage') {
    const currentTurn = Math.max(1, Number(state.value?.turn) || 1);
    activeAbyssEchoBatches(player).forEach((batch, index) => {
      const gainedTurn = Math.max(
        1,
        Math.floor(Number(batch.turn) || currentTurn),
      );
      const expiresIn = Math.max(1, 2 - (currentTurn - gainedTurn));
      entries.push({
        id: `abyss_echo_batch:${gainedTurn}:${index}`,
        label: `回声分批 ${index + 1}`,
        value: `${formatClassResourceValue(batch.value)} 层 · ${expiresIn === 1 ? '下回合过期' : `${expiresIn} 回合后过期`}`,
        description: '深渊回声按获得批次独立保留 2 回合；到期时只移除该批。',
      });
    });
  }
  if (subclass === 'dark_priest') {
    entries.push({
      id: 'sanity',
      label: '理智',
      value: `${Math.max(0, player.sanity ?? 100)} / 100`,
      description: statusDescription(
        'sanity',
        'buff',
        '理智越低，暗黑牧师伤害越高；归零后攻击可能反噬自身。',
      ),
    });
  }
  if (subclass === 'arcane_mage') {
    entries.push({
      id: 'chants',
      label: '吟诵队列',
      value: `${player.chants.length} / 3`,
      description: statusDescription(
        'chanting',
        'buff',
        '等待指定回合结算的法术。',
      ),
    });
    player.chants.forEach((chant, index) => {
      entries.push({
        id: `chant:${chant.id}:${index}`,
        label: chant.name || '吟诵法术',
        value: `剩余 ${Math.max(0, Number(chant.turns) || 0)} 回合`,
        description: statusDescription(
          'chanting',
          'buff',
          '吟诵法术会在倒计归零时自动结算。',
        ),
      });
    });
  }
  if (subclass === 'summoner') {
    entries.push({
      id: 'summon_contracts',
      label: '契约召唤',
      value: String(player.summons.length),
      description: '当前在场的玩家召唤物数量。',
    });
  }
  if (subclass === 'vampire_hunter') {
    const bloodMoon = player.buffs.blood_moon;
    const hunterPrepare = formatClassResourceValue(
      player.classResources?.hunter_prepare ?? 0,
    );
    entries.push({
      id: bloodMoon ? 'blood_moon' : 'hunter_prepare',
      label: bloodMoon ? '血月猎杀' : '猎杀准备',
      value: bloodMoon
        ? '已触发'
        : `回合 ${Math.min(5, Math.max(1, state.value?.turn ?? 1))} / 5 · ${hunterPrepare} 层`,
      description: bloodMoon
        ? '攻击牌额外造成至少 3 点、或最大生命 8% 的伤害（取较高者）；每打出 1 张攻击牌会直接失去最大生命 6% 的生命。'
        : '第 5 回合会进入血月猎杀。',
    });
    displayedResourceIds.add('hunter_prepare');
  }
  if (subclass === 'weapon_master') {
    const combos = Object.entries(player.cardsPlayedThisTurn ?? {})
      .map(([cardId, rawCount]) => ({
        cardId,
        count: Math.max(0, Math.floor(Number(rawCount) || 0)),
        definition: cards.value[cardId],
      }))
      .filter(
        ({ count, definition }) =>
          count > 0 && (!definition || definition.type === 'attack'),
      )
      .sort((left, right) =>
        (left.definition?.name ?? left.cardId).localeCompare(
          right.definition?.name ?? right.cardId,
          'zh-CN',
        ),
      );
    if (combos.length === 0) {
      entries.push({
        id: 'weapon_master_combo',
        label: '武器精通',
        value: '本回合尚未使用攻击牌',
        description: '再次使用本回合已打出的同名攻击牌时会获得额外伤害。',
      });
    } else {
      combos.forEach(({ cardId, count, definition }) => {
        entries.push({
          id: `weapon_master_combo:${cardId}`,
          label: definition?.name ?? cardId,
          value: `已用 ${count} 次 · 下次 +${weaponMasterNextComboBonus(count, player)} 伤害`,
          description: '本回合同名攻击牌的使用次数，以及再次使用该牌时追加的伤害。',
        });
      });
    }
  }
  if (subclass === MAGICIAN_SUBCLASS_ID) {
    const blankCount = [
      ...player.drawPile,
      ...player.discardPile,
      ...player.hand,
    ].filter((card) => card.cardId === MAGICIAN_BLANK_CARD_ID).length;
    entries.push({
      id: 'magician_blanks',
      label: '空白牌',
      value: `${blankCount} / ${MAGICIAN_BLANK_LIMIT}`,
      description: '当前手牌、抽牌堆与弃牌堆中的空白牌总数。',
    });
  }
  for (const [id, value] of Object.entries(player.classResources ?? {})) {
    if (displayedResourceIds.has(id)) continue;
    const known = classResourceDefinitionsById[id];
    // Built-in class resources are owned by exactly one profession. Old battle
    // saves can contain a stale zero-valued key, but that must never make a
    // different profession appear to have the resource.
    if (known) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    entries.push({
      id: `class-resource:${id}`,
      label: formatClassResourceLabel(id),
      value: formatClassResourceValue(value),
      description: `动态识别的职业资源（${id}）。`,
    });
  }
  return entries;
});
const mechanismResources = computed(() => {
  const runtime = state.value?.workshopMechanisms;
  if (!runtime) return [];
  const manifests = readWorkshopMechanisms().filter((entry) =>
    runtime.ids.includes(entry.id),
  );
  return manifests.flatMap((manifest) =>
    manifest.resources
      .filter((resource) => resource.visible)
      .map((resource) => ({
        id: `${manifest.id}:${resource.id}`,
        label: resource.label,
        description: resource.description,
        value:
          runtime.resources[`${manifest.id}:${resource.id}`] ??
          resource.initial,
        min: resource.min,
        max: resource.max,
      })),
  );
});
const regionalMonsterCount = computed(() => {
  const region = snapshot.value?.world.region;
  const regional = Object.values(monsters.value).filter((monster) =>
    monster.regions?.includes(region ?? ''),
  );
  return regional.length || Object.keys(monsters.value).length;
});
const difficultyLabel = computed(() => {
  const key = snapshot.value?.settings.battleDifficulty ?? 'normal';
  return (
    {
      easy: '简单 · ×0.8',
      normal: '普通 · ×1.0',
      hard: '困难 · ×1.5',
      hell: '地狱 · ×2.0',
    }[key] ?? key
  );
});
const selectedCard = computed(() => {
  if (selectedHandIndex.value === null) return null;
  return state.value?.player.hand[selectedHandIndex.value] ?? null;
});
const selectedCardDefinition = computed(() =>
  selectedCard.value ? cards.value[selectedCard.value.cardId] : undefined,
);
const selectedCardUnavailableReason = computed(() => {
  const card = selectedCard.value;
  const index = selectedHandIndex.value;
  return card && index !== null
    ? cardUnavailableReason(card.cardId, index)
    : '';
});
const activePreviewHandIndex = computed(
  () => previewHandIndex.value ?? selectedHandIndex.value,
);
const activePreviewCardDefinition = computed(() => {
  const index = activePreviewHandIndex.value;
  if (index === null) return undefined;
  const card = state.value?.player.hand[index];
  return card ? cards.value[card.cardId] : undefined;
});
const friendlyEffectTypes = new Set([
  'shield',
  'heal',
  'heal_overflow_shield',
  'spend_mp_shield',
  'apply_buff',
  'thorns',
  'thorns_debuff',
  'cleanse',
  'cleanse_heal_per',
  'cleanse_specific',
  'shield_from_shield',
  'strip_shield',
]);

function cardFriendlyTargetMode(definition?: CardDefinition) {
  let mode: 'none' | 'single' | 'all' = 'none';
  const visit = (effects: CardDefinition['effects']) => {
    for (const effect of effects ?? []) {
      if (
        friendlyEffectTypes.has(effect.type) &&
        effect.target !== 'enemy' &&
        effect.target !== 'all_enemies'
      ) {
        mode = effect.target === 'all_allies' ? 'all' : mode === 'all' ? 'all' : 'single';
      }
      for (const key of ['effects', 'then_effects', 'else_effects']) {
        if (Array.isArray(effect[key])) visit(effect[key] as CardDefinition['effects']);
      }
    }
  };
  visit(definition?.effects ?? []);
  return mode;
}

const selectedCardFriendlyMode = computed(() =>
  cardFriendlyTargetMode(selectedCardDefinition.value),
);
const activeCardPreview = computed(() => {
  const current = state.value;
  const definition = activePreviewCardDefinition.value;
  if (!current || !definition) {
    return {
      enemyDamage: current?.enemies.map(() => 0) ?? [],
      playerHp: 0,
      playerHpCost: 0,
      companionHp: 0,
      playerMp: 0,
      playerMpCost: 0,
    };
  }
  return previewBattleCard(
    current,
    definition,
    dragPreviewTargetIndex.value ?? selectedTarget.value,
    dragPreviewAllyTarget.value ?? selectedAllyTarget.value ?? 'player',
  );
});
const activePlayerHpDelta = computed(
  () => activeCardPreview.value.playerHp - activeCardPreview.value.playerHpCost,
);
const activePlayerMpDelta = computed(
  () => activeCardPreview.value.playerMp - activeCardPreview.value.playerMpCost,
);
const resultTitle = computed(() => {
  if (state.value?.workshopTest) return '测试结束';
  if (state.value?.status === 'victory') return '战斗胜利';
  if (state.value?.status === 'defeat') return '战斗失败';
  if (state.value?.status === 'surrendered') return '已从战斗撤退';
  return '';
});

const statusNames: Record<string, string> = {
  strength: '力量',
  weak: '虚弱',
  vulnerable: '易伤',
  burn: '灼烧',
  poison: '中毒',
  freeze: '冻结',
  thorns: '荆棘',
  death_save: '不屈',
  fortitude: '坚韧',
  agility: '敏捷',
  damage_resist: '减伤',
  damage_immune: '伤害免疫',
  damage_halve: '伤害减半',
  monster_frenzy: '狂暴',
  blood_burn: '燃血',
  defense_reflect: '防反',
  counterattack: '反击',
  curse_mark: '诅咒印记',
  abyss_mark: '深渊印记',
  regen: '再生',
  heal_regen: '持续治疗',
  shield_regen: '护盾再生',
  ap_regen: '行动力再生',
  mp_regen: '魔力再生',
  draw_regen: '持续抽牌',
  damage_bonus: '伤害强化',
  spell_damage_bonus: '法术强化',
  damage_reduce: '固定减伤',
  empower: '蓄力',
  cost_reduction: '减费',
  poison_coat: '淬毒',
  spell_double: '攻击翻倍',
  on_hit_draw: '受击抽牌',
  thorns_debuff: '反制荆棘',
  entangle: '缠绕',
  bleed: '流血',
  corrosion: '腐蚀',
  heal_block: '禁疗',
  trap: '陷阱',
  blood_moon: '血月猎杀',
  purified_power: '净化回响',
  next_attack_bonus: '下次攻击强化',
  weapon_master_combo_cap: '连击上限提升',
  weapon_master_bonus_extra: '连击额外强化',
  weapon_master_force_combo: '强制连击',
  weapon_master_no_combo: '连击封锁',
  weapon_master_attack_amp: '攻击增幅',
  attack_amp_percent: '攻击增幅',
  healing_amp_percent: '治疗增幅',
};
const localStatusDescriptions: Record<string, string> = {
  attack_amp_percent:
    '攻击增幅：状态持续期间，攻击牌造成的伤害按显示百分比提高。',
  healing_amp_percent:
    '治疗增幅：状态持续期间，造成的治疗量按显示百分比提高。',
  empower: '蓄力：下一次造成伤害时追加显示数值的伤害，触发后消耗 1 次。',
  purified_power:
    '净化增伤：本回合攻击牌造成的伤害按显示数值提高。',
  damage_reduce: '固定减伤：受到伤害时减去显示数值，最低仍会受到 1 点伤害。',
  defense_reflect: '防反：有护盾时，受攻击前先按80%当前护盾×防御力百分比反伤，防御力倍率最高150%。',
  counterattack: '反击：受到敌方攻击后造成一次攻击力10%的反击伤害。',
  spell_double: '攻击翻倍：下一张攻击牌造成的伤害翻倍，触发后消耗 1 次。',
  wet: '湿润：当前作为特定卡牌的条件标记；不会自行增加雷系伤害或冻结回合。',
  abyss_echo: '自身失去生命时获得；每批深渊回声独立保留 2 回合并分别过期。',
};
const typeNames: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  skill: '技能',
  spell: '法术',
  summon: '召唤',
  status: '状态',
};

function cardDefinition(cardId: string) {
  return cards.value[cardId];
}

function requiredDiscardCount(definition?: CardDefinition) {
  return (definition?.effects ?? []).reduce((sum, effect) => {
    if (effect.type !== 'discard' || effect.amount === 'all') return sum;
    return sum + Math.max(0, Number(effect.amount ?? effect.value) || 0);
  }, 0);
}

function cardContainsEffect(
  definition: CardDefinition,
  predicate: (effect: CardEffect) => boolean,
): boolean {
  let found = false;
  const visit = (effects: CardDefinition['effects']) => {
    for (const effect of effects ?? []) {
      if (predicate(effect)) {
        found = true;
        return;
      }
      for (const key of ['effects', 'then_effects', 'else_effects']) {
        if (Array.isArray(effect[key])) {
          visit(effect[key] as CardDefinition['effects']);
          if (found) return;
        }
      }
    }
  };
  visit(definition.effects ?? []);
  return found;
}

function cardContainsEffectTypes(
  definition: CardDefinition,
  types: ReadonlySet<string>,
): boolean {
  return cardContainsEffect(definition, (effect) =>
    types.has(String(effect.type ?? '')),
  );
}

function battleEffectValue(
  effect: LocalBattleState['player']['buffs'][string] | undefined,
): number {
  const numeric = Number(effect?.value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isSpellCard(definition: CardDefinition): boolean {
  return definition.type === 'spell';
}

function cardElement(definition: CardDefinition): string {
  const direct = String(
    (definition as CardDefinition & { element?: unknown }).element ?? '',
  );
  if (direct) return direct;
  return String(
    definition.effects?.find((effect) => effect.element)?.element ?? '',
  );
}

function isSummonCard(definition: CardDefinition): boolean {
  return (
    definition.type === 'summon' ||
    cardContainsEffect(definition, (effect) => effect.type === 'summon')
  );
}

function isMechanicalSummonCard(definition: CardDefinition): boolean {
  if (!isSummonCard(definition)) return false;
  if (
    cardContainsEffect(
      definition,
      (effect) =>
        effect.type === 'summon' &&
        (effect.mechanical === true || effect.attackable === false),
    )
  ) {
    return true;
  }
  return /机械|齿轮|装填|无人机|机器人|核心|炮台|机械臂|锻锤/u.test(
    `${definition.name}${definition.description}${String(definition.brief ?? '')}${String(definition.cat ?? '')}`,
  );
}

function summonCanBeDestroyed(summon: BattleSummonState): boolean {
  if (summonIsAttackable(summon)) return (Number(summon.hp) || 0) > 0;
  return (Number(summon.duration) || 0) > 0;
}

function destroySummonUnavailableReason(
  definition: CardDefinition,
  player: BattlePlayerUiState,
): string {
  let reason = '';
  cardContainsEffect(definition, (effect) => {
    if (effect.type !== 'destroy_summon_damage_per') return false;
    const mechanicalOnly = effect.mechanicalOnly === true;
    const hasTarget = player.summons.some(
      (summon) =>
        summonCanBeDestroyed(summon) &&
        (!mechanicalOnly || summonIsMechanical(summon)),
    );
    if (hasTarget) return false;
    reason = mechanicalOnly
      ? '场上没有可摧毁的机械召唤物。'
      : '场上没有可摧毁的召唤物。';
    return true;
  });
  return reason;
}

function selectedEnemyMatchesCostCondition(effect: CardEffect): boolean {
  const current = state.value;
  const target = current?.enemies[selectedTarget.value];
  if (!current || !target) return false;
  const condition = String(effect.condition ?? effect.type ?? '');
  switch (condition) {
    case 'enemy_has_specific_debuff':
      return Boolean(target.debuffs[String(effect.debuff ?? '')]);
    case 'enemy_has_debuff':
      return Object.keys(target.debuffs).length > 0;
    case 'enemy_no_debuff':
      return Object.keys(target.debuffs).length === 0;
    case 'enemy_has_shield':
      return target.shield > 0;
    case 'enemy_no_shield':
      return target.shield <= 0;
    case 'self_has_shield':
    case 'has_shield':
      return current.player.shield > 0;
    case 'self_no_shield':
      return current.player.shield <= 0;
    default:
      return false;
  }
}

function conditionalCardApReduction(definition: CardDefinition): number {
  let reduction = 0;
  const visit = (effects: CardDefinition['effects']) => {
    for (const effect of effects ?? []) {
      if (
        effect.type === 'conditional_cost_reduction' &&
        selectedEnemyMatchesCostCondition(effect)
      ) {
        reduction += Math.max(0, Number(effect.value) || 0);
      }
      for (const key of ['effects', 'then_effects', 'else_effects']) {
        if (Array.isArray(effect[key])) {
          visit(effect[key] as CardDefinition['effects']);
        }
      }
    }
  };
  visit(definition.effects ?? []);
  return reduction;
}

function effectiveCardApCost(definition: CardDefinition): number {
  const buffs = state.value?.player.buffs;
  let cost = Math.max(0, Number(definition.cost) || 0);
  if (!buffs) return cost;
  if (definition.type === 'attack') {
    cost -= battleEffectValue(buffs.cost_reduction);
  }
  if (isSpellCard(definition)) {
    if (buffs.next_spell_ap_free) cost = 0;
    cost -= battleEffectValue(buffs.next_spell_ap_reduce);
  }
  if (isSummonCard(definition)) {
    cost -= battleEffectValue(buffs.next_summon_ap_reduce);
  }
  if (isMechanicalSummonCard(definition)) {
    cost -= battleEffectValue(buffs.next_mech_summon_ap_reduce);
  }
  cost -= conditionalCardApReduction(definition);
  return Math.max(0, cost);
}

function effectiveCardMpCost(definition: CardDefinition): number {
  const buffs = state.value?.player.buffs;
  let cost = Math.max(0, Number(definition.mpCost) || 0);
  if (!buffs || !isSpellCard(definition)) return cost;
  cost -= battleEffectValue(buffs.next_spell_mp_reduce);
  if (cardElement(definition) === 'water') {
    cost -= battleEffectValue(buffs.next_water_spell_mp_reduce);
  }
  return Math.max(0, Math.round(cost));
}

function displayedCardApCost(cardId: string): number {
  const definition = cardDefinition(cardId);
  return definition ? effectiveCardApCost(definition) : 0;
}

function displayedCardMpCost(cardId: string): number {
  const definition = cardDefinition(cardId);
  return definition ? effectiveCardMpCost(definition) : 0;
}

function cardUnavailableReason(cardId: string, handIndex?: number) {
  const definition = cardDefinition(cardId);
  const player = state.value?.player;
  if (!definition || !player) return '卡牌数据不存在。';
  if (state.value?.phase !== 'player') return '当前不是玩家行动阶段。';
  if (definition.unplayable === true) {
    return '空白牌无法打出，只有「真相揭晓」可以将其揭晓。';
  }
  const summonRequirement = destroySummonUnavailableReason(definition, player);
  if (summonRequirement) return summonRequirement;
  if (player.ap < effectiveCardApCost(definition)) {
    return '行动点不足。';
  }
  if (player.mp < effectiveCardMpCost(definition)) {
    return '魔力不足。';
  }
  const bloodBurnUnavailable = bloodBurnCardUnavailableReason(
    player,
    definition,
    selectedAllyTarget.value ?? 'player',
  );
  if (bloodBurnUnavailable) return bloodBurnUnavailable;
  if (
    player.chants.length >= 3 &&
    cardContainsEffectTypes(definition, new Set(['chant', 'copy_chant']))
  ) {
    return '吟诵队列已满（3 / 3），无法开始或复写新的吟诵。';
  }
  const required = requiredDiscardCount(definition);
  const available = player.hand.filter(
    (instance, index) =>
      index !== handIndex && instance.cardId !== MAGICIAN_BLANK_CARD_ID,
  ).length;
  if (required > available) return `需要 ${required} 张可弃置的非空白手牌。`;
  return '';
}

function cardUnavailable(cardId: string, handIndex?: number) {
  return Boolean(cardUnavailableReason(cardId, handIndex));
}

function selectEnemy(index: number, enemy: BattleEnemyState) {
  if (busy.value || enemy.hp <= 0) return;
  selectedTarget.value = index;
}

function toggleAllyTarget(target: BattleFriendlyTargetId) {
  if (busy.value) return;
  selectedAllyTarget.value =
    target === 'player' || selectedAllyTarget.value === target ? null : target;
}

function selectCard(index: number, cardId: string) {
  if (busy.value) return;
  if (cardUnavailable(cardId, index)) {
    notice.value = cardUnavailableReason(cardId, index);
    return;
  }
  selectedHandIndex.value =
    selectedHandIndex.value === index ? null : index;
  previewHandIndex.value = null;
  notice.value = '';
}

function handleCardClick(index: number, cardId: string) {
  if (suppressCardClick) {
    suppressCardClick = false;
    return;
  }
  selectCard(index, cardId);
}

function cardStyle(index: number, total: number, cardId: string) {
  const offset = index - (total - 1) / 2;
  const compactStep = total > 1 ? Math.min(35, 250 / (total - 1)) : 0;
  const narrowStep = total > 1 ? Math.min(35, 130 / (total - 1)) : 0;
  const definition = cardDefinition(cardId);
  const faceUrl = localCardFaceUrls.value
    ? battleCardFaceUrl(definition?.type, localCardFaceUrls.value)
    : undefined;
  return {
    '--card-x': `${offset * 54}px`,
    '--card-x-mobile': `${offset * 35}px`,
    '--card-x-compact': `${offset * compactStep}px`,
    '--card-x-narrow': `${offset * narrowStep}px`,
    '--card-rot': `${offset * 1.8}deg`,
    '--card-rot-mobile': `${offset * 2.1}deg`,
    '--card-z': String(20 + index),
    '--card-face': faceUrl ? `url("${faceUrl}")` : 'none',
  };
}

interface StatusDisplayEntry {
  key: string;
  name: string;
  effect: LocalBattleState['player']['buffs'][string];
}

function effectEntries(
  effects: LocalBattleState['player']['buffs'],
): StatusDisplayEntry[] {
  return Object.entries(effects).flatMap(([name, aggregate]) => {
    const instances = Array.isArray(aggregate.instances)
      ? aggregate.instances
      : [];
    if (instances.length === 0) {
      return [{ key: name, name, effect: aggregate }];
    }
    return instances.map((instance, index) => ({
      key: `${name}:${index}`,
      name,
      effect: { ...instance },
    }));
  });
}

function statusDisplayName(name: string, kind: 'buff' | 'debuff'): string {
  const custom = customWorkshopStatus(name, kind);
  if (custom) return custom.label;
  const world = kind === 'buff' ? worldBuffNames : worldDebuffNames;
  const generated = kind === 'buff' ? generatedBuffNames : generatedDebuffNames;
  return statusNames[name] ?? world[name] ?? generated[name] ?? name;
}

function customWorkshopStatus(
  name: string,
  kind: 'buff' | 'debuff',
): WorkshopMechanismStatus | undefined {
  for (const mechanism of readWorkshopMechanisms()) {
    const status = mechanism.statuses.find(
      (entry) =>
        entry.polarity === kind &&
        workshopStatusKey(mechanism.id, entry.id) === name,
    );
    if (status) return status;
  }
  return undefined;
}

function customWorkshopStatusDescription(
  status: WorkshopMechanismStatus,
): string {
  const effects = status.effects.map((effect) => {
    const value = formatStatusNumber(effect.value);
    switch (effect.type) {
      case 'damage_reduction':
        return `受到伤害降低 ${value}%`;
      case 'debuff_immunity':
        return '免疫减益状态';
      case 'turn_heal':
        return `每回合恢复 ${value} 点生命`;
      case 'turn_shield':
        return `每回合获得 ${value} 点护盾`;
      case 'turn_damage':
        return `每回合失去 ${value} 点生命`;
      case 'damage_bonus':
        return `造成伤害提高 ${value}%`;
    }
  });
  return [status.description, effects.join('；')].filter(Boolean).join('｜');
}

function statusDescription(
  name: string,
  kind: 'buff' | 'debuff',
  fallback = '',
): string {
  const custom = customWorkshopStatus(name, kind);
  if (custom) return customWorkshopStatusDescription(custom);
  if (localStatusDescriptions[name]) return localStatusDescriptions[name];
  const worldGlobalDescription = worldStatusDescriptions[name];
  if (typeof worldGlobalDescription === 'string') return worldGlobalDescription;
  const generatedGlobalDescription = generatedStatusDescriptions[name];
  if (typeof generatedGlobalDescription === 'string') {
    return generatedGlobalDescription;
  }
  return (
    worldStatusDescriptions[kind]?.[name] ??
    generatedStatusDescriptions[kind]?.[name] ??
    fallback
  );
}

function formatStatusNumber(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toFixed(2).replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1');
}

function statusEffectSummary(
  name: string,
  effect: LocalBattleState['player']['buffs'][string],
): string {
  const custom =
    customWorkshopStatus(name, 'buff') ?? customWorkshopStatus(name, 'debuff');
  const parts = [
    `${custom ? '层数' : '数值'} ${formatStatusNumber(effect.value)}`,
  ];
  if (effect.stacks !== undefined) {
    parts.push(`层数 ${formatStatusNumber(effect.stacks)}`);
  }
  if (effect.charges !== undefined) {
    parts.push(`可触发 ${formatStatusNumber(effect.charges)} 次`);
  }
  parts.push(`剩余 ${formatStatusNumber(effect.turns)} 回合`);
  return parts.join(' · ');
}

const playerBuffEntries = computed(() => {
  const entries = effectEntries(state.value?.player.buffs ?? {});
  const bloodMoonShownAsProfessionStatus = professionStatusEntries.value.some(
    (entry) => entry.id === 'blood_moon',
  );
  return bloodMoonShownAsProfessionStatus
    ? entries.filter((entry) => entry.name !== 'blood_moon')
    : entries;
});

function summonIsAttackable(summon: BattleSummonState): boolean {
  return summon.attackable ?? summon.hp !== null;
}

function summonIsMechanical(summon: BattleSummonState): boolean {
  return summon.mechanical ?? !summonIsAttackable(summon);
}

function summonHealthLabel(summon: BattleSummonState): string {
  const hp = Math.max(0, Number(summon.hp) || 0);
  const hpMax = Math.max(1, Number(summon.hpMax) || hp || 1);
  const shield = Math.max(0, Number(summon.shield) || 0);
  return `HP ${hp}/${hpMax} · 盾 ${shield}`;
}

function canUseBattleItem(definition: BattleItemDefinition) {
  const current = state.value;
  if (
    !definition.effect ||
    !current ||
    current.status !== 'ongoing' ||
    current.phase !== 'player'
  ) {
    return false;
  }
  return canApplyBattleConsumable(definition.effect, {
    player: current.player,
    hasLivingEnemy: aliveEnemies.value.length > 0,
  });
}

function normalizeSelection() {
  selectedHandIndex.value = null;
  previewHandIndex.value = null;
  if (!state.value) return;
  selectedTarget.value =
    state.value.enemies[selectedTarget.value]?.hp &&
    state.value.enemies[selectedTarget.value]!.hp > 0
      ? selectedTarget.value
      : Math.max(
          0,
          state.value.enemies.findIndex((enemy) => enemy.hp > 0),
        );
}

async function refresh() {
  if (busy.value || animationPlaying.value) return;
  snapshot.value = await props.context.api.query('state');
  normalizeSelection();
}

async function execute(command: unknown, success = '') {
  if (busy.value) return false;
  busy.value = true;
  notice.value = '';
  try {
    const result = await props.context.api.execute(command);
    if (result.status === 'rejected') {
      notice.value = result.message ?? '操作没有成功';
      return false;
    }
    snapshot.value = await props.context.api.query('state');
    normalizeSelection();
    notice.value = success;
    return true;
  } finally {
    busy.value = false;
  }
}

function eventsAfter(
  finalState: LocalBattleState | null,
  previousEventId: string | undefined,
) {
  const events = finalState?.animations ?? [];
  if (!previousEventId) return events;
  const previousIndex = events.findIndex((event) => event.id === previousEventId);
  return previousIndex >= 0 ? events.slice(previousIndex + 1) : events;
}

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const window = props.context.document.defaultView;
    if (window) window.setTimeout(resolve, milliseconds);
    else setTimeout(resolve, milliseconds);
  });
}

function targetKey(event: BattleAnimationEvent) {
  if (event.targetSide === 'enemy' && event.targetId) return `enemy:${event.targetId}`;
  if (event.targetSide === 'companion') return 'companion:caelian';
  if (event.targetSide === 'summon' && event.targetId) return `summon:${event.targetId}`;
  return 'player';
}

function actorKey(event: BattleAnimationEvent) {
  if (event.sourceSide === 'enemy' && event.sourceId) return `enemy:${event.sourceId}`;
  if (event.sourceSide === 'companion') return 'companion:caelian';
  if (event.sourceSide === 'summon' && event.sourceId) return `summon:${event.sourceId}`;
  return event.sourceSide === 'player' ? 'player' : '';
}

function visibleTarget(event: BattleAnimationEvent) {
  const current = state.value;
  if (!current) return null;
  if (event.targetSide === 'enemy') {
    return current.enemies.find((enemy) => enemy.id === event.targetId) ?? null;
  }
  if (event.targetSide === 'companion') return current.companion ?? null;
  if (event.targetSide === 'summon') {
    return (
      current.player.summons.find((summon) => summon.id === event.targetId) ??
      current.companion?.summons.find((summon) => summon.id === event.targetId) ??
      null
    );
  }
  return current.player;
}

function addFloat(
  event: BattleAnimationEvent,
  kind: FloatingEffect['kind'],
  text: string,
) {
  const effect: FloatingEffect = {
    id: `float:${Date.now()}:${floatingSequence++}`,
    targetKey: targetKey(event),
    kind,
    text,
  };
  floatingEffects.value.push(effect);
  return effect.id;
}

function removeFloat(id: string) {
  floatingEffects.value = floatingEffects.value.filter(
    (effect) => effect.id !== id,
  );
}

function floatsFor(key: string) {
  return floatingEffects.value.filter((effect) => effect.targetKey === key);
}

async function playAnimation(event: BattleAnimationEvent) {
  const current = state.value;
  if (!current) return;
  animationCaption.value = event.label;

  if (event.kind === 'card') {
    activeActorKey.value = 'player';
    if (event.apAfter !== undefined) current.player.ap = event.apAfter;
    if (event.mpAfter !== undefined) current.player.mp = event.mpAfter;
    const cardIndex = current.player.hand.findIndex(
      (card) => card.instanceId === event.cardInstanceId,
    );
    if (cardIndex >= 0) current.player.hand.splice(cardIndex, 1);
    selectedHandIndex.value = null;
    await pause(180);
    return;
  }

  if (event.kind === 'enemy-action' || event.kind === 'companion-action') {
    activeActorKey.value = actorKey(event);
    if (event.apAfter !== undefined) current.player.ap = event.apAfter;
    await pause(210);
    return;
  }

  if (event.kind === 'turn') {
    if (event.phaseAfter) current.phase = event.phaseAfter;
    if (event.turnAfter !== undefined) current.turn = event.turnAfter;
    if (event.mpAfter !== undefined) current.player.mp = event.mpAfter;
    if (event.apAfter !== undefined) current.player.ap = event.apAfter;
    const floatId =
      event.targetSide === 'player' && event.mpAfter !== undefined
        ? addFloat(event, 'mp', 'MP 回复')
        : '';
    await pause(300);
    if (floatId) removeFloat(floatId);
    activeActorKey.value = '';
    return;
  }

  const target = visibleTarget(event);
  if (!target) {
    await pause(120);
    return;
  }
  if (event.kind === 'damage') {
    hitTargetKey.value = targetKey(event);
  } else {
    glowTargetKey.value = targetKey(event);
  }
  let floatId = '';
  if (event.kind === 'damage') {
    if (event.hpAfter !== undefined) target.hp = event.hpAfter;
    if (event.shieldAfter !== undefined) target.shield = event.shieldAfter;
    floatId = addFloat(event, 'damage', `−${event.amount ?? 0}`);
  } else if (event.kind === 'heal') {
    if (event.hpAfter !== undefined) target.hp = event.hpAfter;
    floatId = addFloat(event, 'heal', `+${event.amount ?? 0} HP`);
  } else if (event.kind === 'shield') {
    if (event.shieldAfter !== undefined) target.shield = event.shieldAfter;
    const amount = event.amount ?? 0;
    floatId = addFloat(
      event,
      'shield',
      `${amount >= 0 ? '+' : ''}${amount} 护盾`,
    );
  } else if (event.kind === 'mp') {
    if (event.mpAfter !== undefined && target === current.player) {
      current.player.mp = event.mpAfter;
    }
    floatId = addFloat(event, 'mp', `+${event.amount ?? 0} MP`);
  } else if (event.kind === 'ap') {
    if (event.apAfter !== undefined && target === current.player) {
      current.player.ap = event.apAfter;
    }
    floatId = addFloat(event, 'ap', `+${event.amount ?? 0} AP`);
  } else if (event.kind === 'status') {
    floatId = addFloat(
      event,
      'status',
      statusNames[event.label] ?? event.label,
    );
  } else if (event.kind === 'draw') {
    floatId = addFloat(event, 'draw', event.label);
  }
  await pause(event.kind === 'damage' ? 440 : 360);
  if (floatId) removeFloat(floatId);
  hitTargetKey.value = '';
  glowTargetKey.value = '';
  activeActorKey.value = '';
}

async function playAnimationQueue(events: BattleAnimationEvent[]) {
  for (const event of events) {
    await playAnimation(event);
  }
}

async function executeAnimated(command: unknown, success = '') {
  if (busy.value) return false;
  const previousEventId = state.value?.animations?.at(-1)?.id;
  busy.value = true;
  animationPlaying.value = true;
  notice.value = '';
  try {
    const result = await props.context.api.execute(command);
    if (result.status === 'rejected') {
      notice.value = result.message ?? '操作没有成功';
      return false;
    }
    const finalSnapshot = await props.context.api.query('state');
    const finalState = finalSnapshot.battle?.state ?? null;
    await playAnimationQueue(eventsAfter(finalState, previousEventId));
    snapshot.value = finalSnapshot;
    normalizeSelection();
    notice.value = success;
    return true;
  } finally {
    animationPlaying.value = false;
    busy.value = false;
    activeActorKey.value = '';
    hitTargetKey.value = '';
    glowTargetKey.value = '';
    animationCaption.value = '';
    floatingEffects.value = [];
  }
}

function setDropTarget(
  session: CardDragSession,
  target: HTMLElement | null,
) {
  if (session.dropTarget === target) return;
  session.dropTarget?.classList.remove('drag-over');
  session.dropTarget = target;
  session.dropTarget?.classList.add('drag-over');
}

function scheduleClonePosition(session: CardDragSession) {
  if (session.frame !== null) return;
  const window = session.document.defaultView;
  const update = () => {
    session.frame = null;
    if (!session.clone) return;
    const offsetX = session.currentX - session.startX;
    const offsetY = session.currentY - session.startY;
    session.clone.style.transform =
      `translate3d(${offsetX}px, ${offsetY}px, 0) scale(1.035) rotate(0deg)`;
  };
  session.frame = window
    ? window.requestAnimationFrame(update)
    : requestAnimationFrame(update);
}

function createDragClone(session: CardDragSession) {
  const clone = session.source.cloneNode(true) as HTMLElement;
  clone.classList.add('battle-drag-clone');
  clone.classList.remove('selected', 'unavailable');
  clone.removeAttribute('id');
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: `${session.origin.left}px`,
    top: `${session.origin.top}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${session.origin.width}px`,
    height: `${session.origin.height}px`,
    margin: '0',
    opacity: '0.96',
    pointerEvents: 'none',
    transform: 'translate3d(0, 0, 0) scale(1.035) rotate(0deg)',
    transition: 'none',
  });
  session.document.body.append(clone);
  session.document.body.classList.add('caelian-card-dragging');
  session.source.style.opacity = '0.2';
  session.clone = clone;
}

function battleDropTarget(
  document: Document,
  clientX: number,
  clientY: number,
  cardId: string,
) {
  const element = document.elementFromPoint(clientX, clientY);
  const target = element?.closest<HTMLElement>(
    '[data-enemy-index], [data-ally-target]',
  );
  if (!target || target.hasAttribute('disabled')) return null;
  const allyTarget = target.dataset.allyTarget;
  if (allyTarget) {
    if (cardFriendlyTargetMode(cardDefinition(cardId)) === 'none') return null;
    if (allyTarget === 'caelian' && !state.value?.companion) return null;
    return target;
  }
  const index = Number(target.dataset.enemyIndex);
  return state.value?.enemies[index]?.hp && state.value.enemies[index]!.hp > 0
    ? target
    : null;
}

function updateDragPreview(target: HTMLElement | null) {
  const enemyIndex = target?.dataset.enemyIndex;
  dragPreviewTargetIndex.value =
    enemyIndex === undefined ? null : Number(enemyIndex);
  const allyTarget = target?.dataset.allyTarget;
  dragPreviewAllyTarget.value =
    allyTarget === 'player' || allyTarget === 'caelian' ? allyTarget : null;
}

function handleDragMove(event: PointerEvent) {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  session.currentX = event.clientX;
  session.currentY = event.clientY;
  const distance = Math.hypot(
    event.clientX - session.startX,
    event.clientY - session.startY,
  );
  if (!session.moved && distance > 7) {
    session.moved = true;
    createDragClone(session);
  }
  if (!session.moved) return;
  event.preventDefault();
  scheduleClonePosition(session);
  const target = battleDropTarget(
    session.document,
    event.clientX,
    event.clientY,
    session.cardId,
  );
  setDropTarget(session, target);
  updateDragPreview(target);
}

function detachDragListeners(session: CardDragSession) {
  session.document.removeEventListener('pointermove', handleDragMove);
  session.document.removeEventListener('pointerup', handleDragEnd);
  session.document.removeEventListener('pointercancel', handleDragCancel);
}

function cleanupDrag(session: CardDragSession) {
  detachDragListeners(session);
  if (session.frame !== null) {
    const window = session.document.defaultView;
    if (window) window.cancelAnimationFrame(session.frame);
    else cancelAnimationFrame(session.frame);
  }
  session.dropTarget?.classList.remove('drag-over');
  session.source.style.opacity = '';
  session.clone?.remove();
  session.document.body.classList.remove('caelian-card-dragging');
  previewHandIndex.value = null;
  dragPreviewTargetIndex.value = null;
  dragPreviewAllyTarget.value = null;
  if (dragSession === session) dragSession = null;
}

async function settleDragClone(
  session: CardDragSession,
  target: HTMLElement | null,
) {
  if (!session.clone) return;
  const clone = session.clone;
  clone.style.transition =
    'transform 180ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease';
  if (target) {
    const targetRect = target.getBoundingClientRect();
    const offsetX =
      targetRect.left +
      targetRect.width / 2 -
      (session.origin.left + session.origin.width / 2);
    const offsetY =
      targetRect.top +
      targetRect.height / 2 -
      (session.origin.top + session.origin.height / 2);
    clone.style.transform =
      `translate3d(${offsetX}px, ${offsetY}px, 0) scale(.28) rotate(0deg)`;
    clone.style.opacity = '0';
  } else {
    clone.style.transform = 'translate3d(0, 0, 0) scale(1) rotate(0deg)';
    clone.style.opacity = '0.72';
  }
  await pause(190);
}

function suppressGeneratedClick(document: Document) {
  suppressCardClick = true;
  document.defaultView?.setTimeout(() => {
    suppressCardClick = false;
  }, 0);
}

async function handleDragEnd(event: PointerEvent) {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  suppressGeneratedClick(session.document);
  if (!session.moved) {
    cleanupDrag(session);
    selectCard(session.handIndex, session.cardId);
    return;
  }
  event.preventDefault();
  const target =
    battleDropTarget(
      session.document,
      event.clientX,
      event.clientY,
      session.cardId,
    ) ??
    session.dropTarget;
  const targetIndex = target ? Number(target.dataset.enemyIndex) : -1;
  const allyTarget = target?.dataset.allyTarget;
  await settleDragClone(session, target);
  cleanupDrag(session);
  if (allyTarget === 'player' || allyTarget === 'caelian') {
    selectedAllyTarget.value = allyTarget === 'caelian' ? 'caelian' : null;
    await playCardAt(session.handIndex, selectedTarget.value, allyTarget);
  } else if (targetIndex >= 0) {
    selectedTarget.value = targetIndex;
    await playCardAt(session.handIndex, targetIndex);
  } else {
    notice.value = '把卡牌拖到有效的敌方或己方目标身上即可打出。';
  }
}

function handleDragCancel(event: PointerEvent) {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  suppressGeneratedClick(session.document);
  void settleDragClone(session, null).finally(() => cleanupDrag(session));
}

function beginCardPointer(
  event: PointerEvent,
  handIndex: number,
  cardId: string,
) {
  if (
    event.button !== 0 ||
    busy.value ||
    animationPlaying.value ||
    cardUnavailable(cardId, handIndex)
  ) {
    return;
  }
  if (dragSession) cleanupDrag(dragSession);
  previewHandIndex.value = handIndex;
  const source = event.currentTarget as HTMLElement;
  const document = source.ownerDocument;
  dragSession = {
    document,
    source,
    handIndex,
    cardId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    origin: source.getBoundingClientRect(),
    clone: null,
    dropTarget: null,
    frame: null,
    moved: false,
  };
  source.setPointerCapture?.(event.pointerId);
  document.addEventListener('pointermove', handleDragMove, { passive: false });
  document.addEventListener('pointerup', handleDragEnd);
  document.addEventListener('pointercancel', handleDragCancel);
}

async function exploreBattle() {
  await execute(
    {
      id: commandId('battle.explore'),
      type: 'battle.explore',
      payload: {},
    },
    '已经从当前地区生成本地遭遇。',
  );
}

async function playSelectedCard() {
  if (!battle.value || selectedHandIndex.value === null) return;
  if (selectedCardUnavailableReason.value) {
    notice.value = selectedCardUnavailableReason.value;
    return;
  }
  await playCardAt(selectedHandIndex.value, selectedTarget.value);
}

async function playCardAt(
  handIndex: number,
  targetIndex: number,
  requestedAllyTarget = selectedAllyTarget.value ?? 'player',
) {
  if (!battle.value) return;
  const allyTargetId: BattleFriendlyTargetId = requestedAllyTarget;
  const card = state.value?.player.hand[handIndex];
  const targetsCaelian =
    allyTargetId === 'caelian' &&
    cardFriendlyTargetMode(card ? cards.value[card.cardId] : undefined) !== 'none';
  const applied = await executeAnimated({
    id: commandId('battle.play-card'),
    type: 'battle.play-card',
    payload: {
      battleId: battle.value.id,
      handIndex,
      targetIndex,
      allyTargetId,
    },
  });
  if (applied && targetsCaelian) selectedAllyTarget.value = null;
}

async function endTurn() {
  if (!battle.value) return;
  await executeAnimated({
    id: commandId('battle.end-turn'),
    type: 'battle.end-turn',
    payload: { battleId: battle.value.id },
  });
}

async function discardHand() {
  if (!battle.value) return;
  if (discardUnavailableReason.value) {
    notice.value = discardUnavailableReason.value;
    return;
  }
  await execute({
    id: commandId('battle.discard-hand'),
    type: 'battle.discard-hand',
    payload: { battleId: battle.value.id },
  });
}

async function chooseAstrologyCard(choiceIndex: number) {
  if (!battle.value) return;
  await execute({
    id: commandId('battle.choose-astrology-card'),
    type: 'battle.choose-astrology-card',
    payload: { battleId: battle.value.id, choiceIndex },
  });
}

async function useBattleItem(item: BattleInventoryRow) {
  if (!battle.value) return;
  await executeAnimated(
    {
      id: commandId('battle.use-item'),
      type: 'battle.use-item',
      payload: {
        battleId: battle.value.id,
        itemId: item.itemId,
        targetIndex: selectedTarget.value,
      },
    },
    `已使用「${item.name}」`,
  );
}

async function surrender() {
  if (!battle.value) return;
  const testing = Boolean(state.value?.workshopTest);
  const confirmed = await props.context.api.confirm({
    title: testing ? '确认结束创意工坊测试？' : '确认从战斗中撤退？',
    description: testing
      ? '测试将立即结束，正式角色、背包、任务和奖励都不会改变。'
      : '撤退会损失当前生命与一部分金币，本轮战斗也会立即结束。',
    confirmText: testing ? '结束测试' : '确认撤退',
    cancelText: '继续战斗',
    tone: 'danger',
  });
  if (!confirmed) return;
  await execute({
    id: commandId('battle.surrender'),
    type: 'battle.surrender',
    payload: { battleId: battle.value.id },
  });
}

async function closeResult() {
  if (!battle.value) return;
  await execute({
    id: commandId('battle.finish'),
    type: 'battle.finish',
    payload: { battleId: battle.value.id },
  });
}

async function claimReward(
  kind: 'card' | 'equipment' | 'relic',
  choiceId?: string,
) {
  if (!battle.value) return;
  await execute(
    {
      id: commandId('battle.claim-reward'),
      type: 'battle.claim-reward',
      payload: { battleId: battle.value.id, kind, choiceId },
    },
    choiceId ? '额外奖励已放入本地背包。' : '已跳过该项额外奖励。',
  );
}

onMounted(async () => {
  void loadBattleCardFaceUrls(
    props.context.document.defaultView ?? globalThis.window,
  ).then((urls) => {
    localCardFaceUrls.value = urls;
  });
  [
    snapshot.value,
    monsters.value,
    cards.value,
    battleItems.value,
    equipmentRewards.value,
    relicRewards.value,
  ] =
    await Promise.all([
    props.context.api.query('state'),
    loadMonsterCatalog(),
    loadCardCatalog(),
    loadBattleItems(),
    loadEquipmentDefinitions(),
    loadRelics(),
  ]);
  selectedTarget.value = state.value?.selectedTarget ?? 0;
  selectedAllyTarget.value = null;
  disposeStateListener = props.context.api.on('state.changed', refresh);
});

onUnmounted(() => {
  disposeStateListener?.();
  if (dragSession) cleanupDrag(dragSession);
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="battle"
    :date="snapshot?.world.location"
    page-mode="battle"
  >
    <div v-if="!snapshot" class="ca-empty">正在装载本地战斗引擎……</div>

    <template v-else-if="state && battle">
      <section v-if="state.status !== 'ongoing'" class="battle-result">
        <span>LOCAL BATTLE RESULT</span>
        <h1>{{ resultTitle }}</h1>
        <p v-if="state.workshopTest">隔离测试已完成，没有修改正式角色、背包、任务与奖励。</p>
        <p v-else>本次战斗已经在浏览器本地完成结算。</p>
        <div v-if="state.rewards" class="reward-grid">
          <article>
            <small>经验</small>
            <strong>+{{ state.rewards.experience }}</strong>
          </article>
          <article>
            <small>金币</small>
            <strong>+{{ state.rewards.gold }}</strong>
          </article>
          <article>
            <small>协会经验</small>
            <strong>+{{ state.rewards.guildExperience }}</strong>
          </article>
          <article>
            <small>战利品</small>
            <strong>{{ state.rewards.items.length }}</strong>
          </article>
        </div>
        <ul v-if="state.rewards?.items.length" class="reward-items">
          <li v-for="item in state.rewards.items" :key="item.id">
            {{ item.name }} ×{{ item.quantity }}
          </li>
        </ul>
        <div v-if="state.rewardChoices" class="reward-choices">
          <section v-if="!state.rewardChoices.cardClaimed">
            <strong>胜利卡牌 · 选择一张</strong>
            <div>
              <button
                v-for="cardId in state.rewardChoices.cardIds"
                :key="cardId"
                class="reward-option"
                type="button"
                @click="claimReward('card', cardId)"
              >
                <b>{{ cards[cardId]?.name ?? cardId }}</b>
                <small>{{ cardRewardMeta(cards[cardId]) }}</small>
                <p>{{ cardRewardEffect(cards[cardId]) }}</p>
              </button>
              <button class="reward-skip" type="button" @click="claimReward('card')">跳过</button>
            </div>
          </section>
          <section v-if="!state.rewardChoices.equipmentClaimed">
            <strong>装备奖励 · 选择一件</strong>
            <div>
              <button
                v-for="equipmentId in state.rewardChoices.equipmentIds"
                :key="equipmentId"
                class="reward-option"
                type="button"
                @click="claimReward('equipment', equipmentId)"
              >
                <b>{{ equipmentRewards[equipmentId]?.name ?? equipmentId }}</b>
                <small>
                  {{
                    equipmentRewardMeta(
                      equipmentRewards[equipmentId],
                      state.rewardChoices.levelsGained > 0 ? 2 : 1,
                    )
                  }}
                </small>
                <p>
                  {{
                    equipmentRewardEffect(
                      equipmentRewards[equipmentId],
                      state.rewardChoices.levelsGained > 0 ? 2 : 1,
                    )
                  }}
                </p>
              </button>
              <button class="reward-skip" type="button" @click="claimReward('equipment')">跳过</button>
            </div>
          </section>
          <section v-if="!state.rewardChoices.relicClaimed">
            <strong>升级藏品 · 选择一件</strong>
            <div>
              <button
                v-for="relicId in state.rewardChoices.relicIds"
                :key="relicId"
                class="reward-option"
                type="button"
                @click="claimReward('relic', relicId)"
              >
                <b>{{ relicRewards[relicId]?.name ?? relicId }}</b>
                <small>{{ rewardRarityName(String(relicRewards[relicId]?.rarity ?? 'level')) }} · 藏品</small>
                <p>{{ relicRewardEffect(relicRewards[relicId]) }}</p>
              </button>
              <button class="reward-skip" type="button" @click="claimReward('relic')">跳过</button>
            </div>
          </section>
        </div>
        <button
          type="button"
          class="battle-main-button"
          :disabled="busy"
          @click="closeResult"
        >
          返回探索
        </button>
      </section>

      <div v-else class="legacy-battle-shell">
        <header class="battle-topbar">
          <div>
            <strong>
              <template v-if="state.workshopTest">
                创意工坊测试 · 木桩复活 {{ state.workshopTest.respawns }} 次 ·
              </template>
              第 {{ state.turn }} 回合 ·
              {{
                state.phase === 'player'
                  ? '玩家行动'
                  : state.phase === 'companion'
                    ? '凯利安行动'
                    : '敌方行动'
              }}
              <em v-if="animationPlaying"> · 动画结算中</em>
            </strong>
            <span>{{ battle.source }}</span>
          </div>
          <div>
            <button type="button" @click="showBattleInfo = !showBattleInfo">
              战况
            </button>
            <button type="button" class="escape" :disabled="busy" @click="surrender">
              {{ state.workshopTest ? '结束测试' : '逃跑' }}
            </button>
          </div>
        </header>

        <section
          class="enemy-zone"
          :data-count="Math.min(state.enemies.length, 6)"
        >
          <div class="enemy-layout">
            <button
              v-for="(enemy, index) in state.enemies"
              :key="enemy.id"
              type="button"
              class="enemy-card"
              :class="{
                selected: index === selectedTarget,
                defeated: enemy.hp <= 0,
                acting: activeActorKey === `enemy:${enemy.id}`,
                hit: hitTargetKey === `enemy:${enemy.id}`,
                glow: glowTargetKey === `enemy:${enemy.id}`,
              }"
              :data-enemy-index="index"
              :disabled="enemy.hp <= 0"
              @click="selectEnemy(index, enemy)"
            >
              <div class="enemy-card-title">
                <strong>{{ enemy.name }}</strong>
                <span v-if="index === selectedTarget">锁定</span>
              </div>
              <small>
                攻 {{ enemy.attack }} · 防 {{ enemy.defense }} · 盾 {{ enemy.shield }}
              </small>
              <MeterBar
                label="怪物生命"
                :value="enemy.hp"
                :max="enemy.hpMax"
                :preview-delta="-(activeCardPreview.enemyDamage[index] ?? 0)"
                color="var(--ca-red)"
              />
              <div v-if="enemy.intent" class="intent">
                <b>{{ enemy.intent.kind }} · {{ enemy.intent.name }}</b>
                <span v-if="enemy.intent.amount">
                  预计 {{ enemy.intent.amount
                  }}{{ enemy.intent.hits > 1 ? ` × ${enemy.intent.hits}` : '' }}
                </span>
              </div>
              <div class="status-row">
                <span v-if="enemy.shield">护盾 {{ enemy.shield }}</span>
                <span
                  v-for="entry in effectEntries(enemy.buffs)"
                  :key="`eb:${entry.key}`"
                  :title="statusDescription(entry.name, 'buff')"
                >
                  {{ statusDisplayName(entry.name, 'buff') }}
                  {{ statusEffectSummary(entry.name, entry.effect) }}
                </span>
                <span
                  v-for="entry in effectEntries(enemy.debuffs)"
                  :key="`ed:${entry.key}`"
                  class="negative"
                  :title="statusDescription(entry.name, 'debuff')"
                >
                  {{ statusDisplayName(entry.name, 'debuff') }}
                  {{ statusEffectSummary(entry.name, entry.effect) }}
                </span>
              </div>
              <div class="battle-float-layer" aria-hidden="true">
                <span
                  v-for="effect in floatsFor(`enemy:${enemy.id}`)"
                  :key="effect.id"
                  :data-kind="effect.kind"
                >
                  {{ effect.text }}
                </span>
              </div>
            </button>
          </div>
        </section>

        <section
          class="battle-mid"
          :class="{
            acting: activeActorKey === 'player',
            hit: hitTargetKey === 'player',
            glow: glowTargetKey === 'player',
            'drag-over': dragPreviewAllyTarget === 'player',
          }"
        >
          <div v-if="state.companion" class="companion-party">
            <button
              type="button"
              class="companion-unit"
              data-ally-target="caelian"
              :class="{
                selected: selectedAllyTarget === 'caelian',
                injured: state.companion.injured,
                'drag-over': dragPreviewAllyTarget === 'caelian',
                acting: activeActorKey === 'companion:caelian',
                hit: hitTargetKey === 'companion:caelian',
                glow: glowTargetKey === 'companion:caelian',
              }"
              @click="toggleAllyTarget('caelian')"
            >
              <span>圣辉龙骑</span>
              <strong>{{ state.companion.name }}</strong>
              <small v-if="state.companion.injured">重伤 · 无法行动/治疗/获得护盾</small>
              <small v-else>
                HP {{ state.companion.hp }}/{{ state.companion.hpMax }} · 盾 {{ state.companion.shield }}
              </small>
              <MeterBar
                label="凯利安生命"
                :value="state.companion.hp"
                :max="state.companion.hpMax"
                :preview-delta="activeCardPreview.companionHp"
                color="#f6d36a"
              />
              <div class="battle-float-layer" aria-hidden="true">
                <span
                  v-for="effect in floatsFor('companion:caelian')"
                  :key="effect.id"
                  :data-kind="effect.kind"
                >
                  {{ effect.text }}
                </span>
              </div>
            </button>

            <article
              v-for="summon in state.companion.summons"
              :key="summon.id"
              class="companion-summon"
              :class="{
                defeated: summon.hp <= 0,
                acting: activeActorKey === `summon:${summon.id}`,
                hit: hitTargetKey === `summon:${summon.id}`,
                glow: glowTargetKey === `summon:${summon.id}`,
              }"
            >
              <span>纯血光明圣龙 · 召唤物</span>
              <strong>{{ summon.name }}</strong>
              <small>HP {{ summon.hp }}/{{ summon.hpMax }} · 盾 {{ summon.shield }}</small>
              <MeterBar
                label="特莱奥生命"
                :value="summon.hp"
                :max="summon.hpMax"
                color="#fff0a4"
              />
              <div class="battle-float-layer" aria-hidden="true">
                <span
                  v-for="effect in floatsFor(`summon:${summon.id}`)"
                  :key="effect.id"
                  :data-kind="effect.kind"
                >
                  {{ effect.text }}
                </span>
              </div>
            </article>

            <div class="companion-sequence">
              <span>本场固定行动序列</span>
              <ol>
                <li
                  v-for="(skill, index) in state.companion.actionSequence"
                  :key="skill.id"
                  :class="{ current: index === state.companion.actionIndex }"
                  :title="skill.description"
                >
                  {{ skill.name }} · {{ skill.apCost }}AP
                </li>
              </ol>
            </div>
          </div>

          <div class="summon-strip">
            <template v-if="state.player.summons.length">
              <article
                v-for="summon in state.player.summons"
                :key="summon.id"
                class="player-summon"
                :class="{
                  defeated:
                    summonIsAttackable(summon) &&
                    (Number(summon.hp) || 0) <= 0,
                  acting: activeActorKey === `summon:${summon.id}`,
                  hit: hitTargetKey === `summon:${summon.id}`,
                  glow: glowTargetKey === `summon:${summon.id}`,
                }"
              >
                <small>
                  {{ summonIsMechanical(summon) ? '机械召唤物' : '可攻击召唤物' }}
                </small>
                <strong>{{ summon.name }}</strong>
                <span v-if="summonIsAttackable(summon)">
                  {{ summonHealthLabel(summon) }}
                </span>
                <span v-if="summonIsMechanical(summon)">
                  剩余 {{ Math.max(0, Number(summon.duration) || 0) }} 回合
                </span>
                <div
                  v-if="
                    Object.keys(summon.buffs ?? {}).length ||
                      Object.keys(summon.debuffs ?? {}).length
                  "
                  class="summon-statuses"
                >
                  <span
                    v-for="entry in effectEntries(summon.buffs ?? {})"
                    :key="`sb:${summon.id}:${entry.key}`"
                    :title="statusDescription(entry.name, 'buff')"
                  >
                    {{ statusDisplayName(entry.name, 'buff') }} ·
                    {{ statusEffectSummary(entry.name, entry.effect) }}
                  </span>
                  <span
                    v-for="entry in effectEntries(summon.debuffs ?? {})"
                    :key="`sd:${summon.id}:${entry.key}`"
                    class="negative"
                    :title="statusDescription(entry.name, 'debuff')"
                  >
                    {{ statusDisplayName(entry.name, 'debuff') }} ·
                    {{ statusEffectSummary(entry.name, entry.effect) }}
                  </span>
                </div>
                <div class="battle-float-layer" aria-hidden="true">
                  <span
                    v-for="effect in floatsFor(`summon:${summon.id}`)"
                    :key="effect.id"
                    :data-kind="effect.kind"
                  >
                    {{ effect.text }}
                  </span>
                </div>
              </article>
            </template>
            <span v-else>暂无召唤物</span>
          </div>

          <div v-if="mechanismResources.length" class="mechanism-resource-strip">
            <span
              v-for="resource in mechanismResources"
              :key="resource.id"
              :title="[
                '自定义资源',
                `${resource.min}–${resource.max}`,
                resource.description,
              ].filter(Boolean).join(' · ')"
            >
              {{ resource.label }} <b>{{ resource.value }}</b>
            </span>
          </div>

          <div class="battle-field-row">
            <b>场上状态</b>
            <div class="status-row">
              <span
                v-for="entry in professionStatusEntries"
                :key="`profession:${entry.id}`"
                class="special profession-status"
                :title="entry.description"
              >
                {{ entry.label }} · {{ entry.value }}
              </span>
              <span
                v-for="entry in playerBuffEntries"
                :key="`pb:${entry.key}`"
                :title="statusDescription(entry.name, 'buff')"
              >
                {{ statusDisplayName(entry.name, 'buff') }}
                {{ statusEffectSummary(entry.name, entry.effect) }}
              </span>
              <span
                v-for="entry in effectEntries(state.player.debuffs)"
                :key="`pd:${entry.key}`"
                class="negative"
                :title="statusDescription(entry.name, 'debuff')"
              >
                {{ statusDisplayName(entry.name, 'debuff') }}
                {{ statusEffectSummary(entry.name, entry.effect) }}
              </span>
              <span
                v-for="generator in state.player.blankGenerators ?? []"
                :key="generator.id"
                class="special"
                :title="'每回合将 ' + generator.amount + ' 张空白牌洗入抽牌堆'"
              >
                不竭牌匣 · {{ generator.turns }}回合
              </span>
              <span
                v-if="
                  !Object.keys(state.player.buffs).length &&
                    !Object.keys(state.player.debuffs).length &&
                    !(state.player.blankGenerators?.length ?? 0) &&
                    !professionStatusEntries.length
                "
              >
                暂无状态
              </span>
            </div>
            <small>
              攻 {{ state.player.attack }} · 防 {{ state.player.defense }} · 速 {{ state.player.speed }}
            </small>
          </div>

          <div class="player-bars" data-ally-target="player">
            <MeterBar
              label="玩家生命"
              :value="state.player.hp"
              :max="state.player.hpMax"
              :preview-delta="activePlayerHpDelta"
              color="var(--ca-red)"
            />
            <MeterBar
              label="玩家魔力"
              :value="state.player.mp"
              :max="state.player.mpMax"
              :preview-delta="activePlayerMpDelta"
              color="var(--ca-blue)"
            />
            <div
              class="player-shield-meter"
              :class="{ active: state.player.shield > 0 }"
              :aria-label="`玩家护盾 ${state.player.shield}`"
            >
              <span>玩家护盾</span>
              <strong>🛡 {{ state.player.shield }}</strong>
            </div>
          </div>
          <div class="battle-float-layer player-floats" aria-hidden="true">
            <span
              v-for="effect in floatsFor('player')"
              :key="effect.id"
              :data-kind="effect.kind"
            >
              {{ effect.text }}
            </span>
          </div>
        </section>

        <div
          v-if="state.companion && selectedCardFriendlyMode !== 'none'"
          class="friendly-target-picker"
        >
          <template v-if="selectedCardFriendlyMode === 'all'">
            <strong>己方全体</strong>
            <span>玩家 + 凯利安（重伤时跳过治疗与护盾）</span>
          </template>
          <template v-else>
            <strong>选择己方目标</strong>
            <button
              type="button"
              :class="{ selected: selectedAllyTarget === null }"
              @click="toggleAllyTarget('player')"
            >
              玩家（默认）
            </button>
            <button
              type="button"
              :class="{ selected: selectedAllyTarget === 'caelian' }"
              @click="toggleAllyTarget('caelian')"
            >
              凯利安
            </button>
          </template>
        </div>

        <section
          class="hand-zone"
          :class="{ 'card-raised': selectedHandIndex !== null }"
        >
          <div class="ap-orb">
            <strong>{{ state.player.ap }}</strong>
            <span>/{{ state.player.apMax }} AP</span>
          </div>

          <div class="hand-actions">
            <button
              type="button"
              class="inventory-toggle"
              :aria-expanded="showBattleInventory"
              @click="showBattleInventory = !showBattleInventory"
            >
              背包 {{ battleInventoryCount }}
            </button>
            <button
              type="button"
              class="discard"
              :disabled="busy || Boolean(discardUnavailableReason)"
              :title="discardUnavailableReason || '每回合可花费 1 AP 主动弃牌一次'"
              @click="discardHand"
            >
              {{ manualDiscardUsed ? '本回合已弃牌' : '弃牌 1AP' }}
            </button>
            <button
              type="button"
              class="end-turn"
              :disabled="busy || aliveEnemies.length === 0"
              @click="endTurn"
            >
              结束回合
            </button>
          </div>

          <button
            type="button"
            class="pile-button"
            @click="showPileDetails = !showPileDetails"
          >
            手牌 {{ state.player.hand.length }}/{{ state.player.handLimit }}<br>
            牌堆 {{ state.player.drawPile.length }} · 弃牌 {{ state.player.discardPile.length }}
          </button>

          <div class="fan-hand">
            <button
              v-for="(card, index) in state.player.hand"
              :key="card.instanceId"
              type="button"
              class="fan-card"
              :class="{
                selected: selectedHandIndex === index,
                unavailable: cardUnavailable(card.cardId, index),
                'blank-card': card.cardId === MAGICIAN_BLANK_CARD_ID,
              }"
              :data-rarity="cardDefinition(card.cardId)?.rarity"
              :data-card-type="battleCardFaceType(cardDefinition(card.cardId)?.type)"
              :style="cardStyle(index, state.player.hand.length, card.cardId)"
              @pointerdown="beginCardPointer($event, index, card.cardId)"
              @click="handleCardClick(index, card.cardId)"
            >
              <div class="fan-cost">
                <span class="ap">
                  <small>AP</small>
                  <b>{{ displayedCardApCost(card.cardId) }}</b>
                </span>
                <span class="mp">
                  <small>MP</small>
                  <b>{{ displayedCardMpCost(card.cardId) }}</b>
                </span>
              </div>
              <strong class="fan-card-name">
                {{ cardDefinition(card.cardId)?.name ?? card.cardId }}
              </strong>
              <small class="fan-card-meta">
                {{ typeNames[cardDefinition(card.cardId)?.type ?? ''] ?? '卡牌' }}
                · {{ cardDefinition(card.cardId)?.rarity ?? 'common' }}
              </small>
              <p class="fan-card-effect">
                {{ cardDefinition(card.cardId)?.description ?? '卡牌数据缺失' }}
              </p>
            </button>
          </div>
        </section>

        <button
          type="button"
          class="play-selected-floating"
          :disabled="busy || !selectedCard || Boolean(selectedCardUnavailableReason)"
          :title="selectedCardUnavailableReason || undefined"
          @click="playSelectedCard"
        >
          <span>打出</span>
          <strong>
            {{ selectedCardDefinition?.name ?? '选择手牌' }}
          </strong>
        </button>

        <aside v-if="showBattleInfo" class="battle-info">
          <header>
            <div>
              <strong>战斗记录</strong>
              <span>
                抽牌 {{ state.player.drawPile.length }} · 弃牌 {{ state.player.discardPile.length }}
                · 吟诵 {{ state.player.chants.length }}
              </span>
            </div>
            <button type="button" @click="showBattleInfo = false">×</button>
          </header>
          <ol>
            <li
              v-for="entry in recentLog"
              :key="entry.id"
              :data-kind="entry.kind"
            >
              <span>T{{ entry.turn }}</span>{{ entry.text }}
            </li>
          </ol>
        </aside>

        <aside v-if="showPileDetails" class="battle-pile-details">
          <header>
            <div>
              <strong>牌堆 / 弃牌堆</strong>
              <span>
                抽牌 {{ state.player.drawPile.length }} · 弃牌
                {{ state.player.discardPile.length }}
              </span>
            </div>
            <button
              type="button"
              aria-label="关闭牌堆详情"
              @click="showPileDetails = false"
            >
              ×
            </button>
          </header>
          <div class="pile-detail-columns">
            <section>
              <h3>抽牌堆（{{ state.player.drawPile.length }}）</h3>
              <p v-if="!drawPileRows.length" class="pile-empty">空</p>
              <article v-for="row in drawPileRows" :key="'draw:' + row.cardId">
                <div>
                  <strong>{{ row.definition?.name ?? row.cardId }}</strong>
                  <span>
                    {{ typeNames[row.definition?.type ?? ''] ?? '卡牌' }} ·
                    {{ row.definition?.cost ?? 0 }}AP
                  </span>
                  <p>{{ row.definition?.description ?? '卡牌数据缺失' }}</p>
                </div>
                <b>×{{ row.quantity }}</b>
              </article>
            </section>
            <section>
              <h3>弃牌堆（{{ state.player.discardPile.length }}）</h3>
              <p v-if="!discardPileRows.length" class="pile-empty">空</p>
              <article
                v-for="row in discardPileRows"
                :key="'discard:' + row.cardId"
              >
                <div>
                  <strong>{{ row.definition?.name ?? row.cardId }}</strong>
                  <span>
                    {{ typeNames[row.definition?.type ?? ''] ?? '卡牌' }} ·
                    {{ row.definition?.cost ?? 0 }}AP
                  </span>
                  <p>{{ row.definition?.description ?? '卡牌数据缺失' }}</p>
                </div>
                <b>×{{ row.quantity }}</b>
              </article>
            </section>
          </div>
        </aside>

        <aside v-if="showBattleInventory" class="battle-inventory">
          <header>
            <div>
              <strong>战斗背包</strong>
              <span>
                HP {{ state.player.hp }}/{{ state.player.hpMax }} · MP
                {{ state.player.mp }}/{{ state.player.mpMax }}
              </span>
            </div>
            <button
              type="button"
              aria-label="关闭战斗背包"
              @click="showBattleInventory = false"
            >
              ×
            </button>
          </header>
          <p v-if="state.phase !== 'player'" class="inventory-hint">
            敌方行动阶段只能查看，回到玩家行动后才能使用物品。
          </p>
          <p v-else-if="!battleInventory.length" class="inventory-empty">
            背包里没有可在当前战斗即时使用的药剂或道具。
          </p>
          <div v-else class="battle-inventory-list">
            <article v-for="item in battleInventory" :key="item.itemId">
              <div>
                <strong>{{ item.name }}</strong>
                <span>持有 ×{{ item.quantity }}</span>
                <p>{{ item.definition.desc }}</p>
              </div>
              <button
                type="button"
                :disabled="busy || !canUseBattleItem(item.definition)"
                @click="useBattleItem(item)"
              >
                {{ canUseBattleItem(item.definition) ? '使用' : '当前无效' }}
              </button>
            </article>
          </div>
          <small>
            攻击道具会作用于当前锁定目标；标注“下一场战斗”的药剂不会显示在这里。
          </small>
        </aside>

        <div
          v-if="state.player.pendingCardChoice"
          class="battle-choice-overlay"
          role="dialog"
          aria-modal="true"
          :aria-label="state.player.pendingCardChoice.title"
        >
          <section class="battle-choice-panel">
            <header>
              <span>ASTRAL DISCOVERY</span>
              <h2>✦ {{ state.player.pendingCardChoice.title }}</h2>
              <p>
                从 {{ state.player.pendingCardChoice.choices.length }} 张牌中选择
                {{ state.player.pendingCardChoice.pick }} 张临时加入本场手牌 · 已选择
                {{ state.player.pendingCardChoice.picked.length }} /
                {{ state.player.pendingCardChoice.pick }}
              </p>
            </header>
            <div class="battle-choice-list">
              <button
                v-for="(cardId, index) in state.player.pendingCardChoice.choices"
                :key="'astrology:' + index + ':' + cardId"
                type="button"
                :class="{
                  picked: state.player.pendingCardChoice.picked.includes(index),
                }"
                :disabled="
                  busy || state.player.pendingCardChoice.picked.includes(index)
                "
                @click="chooseAstrologyCard(index)"
              >
                <strong>
                  {{ cardDefinition(cardId)?.name ?? cardId }}
                  <em
                    v-if="state.player.pendingCardChoice.picked.includes(index)"
                  >
                    ✓
                  </em>
                </strong>
                <span>
                  {{ cardDefinition(cardId)?.cost ?? 0 }}AP ·
                  {{ typeNames[cardDefinition(cardId)?.type ?? ''] ?? '卡牌' }} ·
                  {{ cardDefinition(cardId)?.rarity ?? 'common' }}
                </span>
                <p>{{ cardDefinition(cardId)?.description ?? '卡牌数据缺失' }}</p>
              </button>
            </div>
          </section>
        </div>

        <div v-if="animationPlaying && animationCaption" class="animation-caption">
          {{ animationCaption }}
        </div>
      </div>
    </template>

    <section v-else class="exploration-ready">
      <div class="exploration-copy">
        <span>AUTOMATIC LOCAL ENCOUNTER</span>
        <h1>{{ snapshot.world.region }} · 探索战斗</h1>
        <p>
          点击后脚本会从当前地区自动抽取一个或一组怪物。怪物会按玩家等级、当前装备战力、地区系数和冒险难度实时缩放。
        </p>
      </div>

      <div class="exploration-stats">
        <article>
          <small>玩家等级</small>
          <strong>Lv.{{ snapshot.player.level }}</strong>
        </article>
        <article>
          <small>冒险难度</small>
          <strong>{{ difficultyLabel }}</strong>
        </article>
        <article>
          <small>地区怪物池</small>
          <strong>{{ regionalMonsterCount }} 种</strong>
        </article>
        <article>
          <small>出战牌组</small>
          <strong>{{ activeDeck?.cardIds.length ?? 0 }} 张</strong>
        </article>
      </div>

      <div class="encounter-rule">
        <strong>本次遭遇由脚本自动决定</strong>
        <p>
          低等级怪物权重更高，但不会硬性排除高等级怪物；困难与地狱难度更容易出现群体战。群怪会应用旧版的数量补正，避免简单叠加成数值墙。
        </p>
      </div>

      <button
        type="button"
        class="explore-button"
        :disabled="busy || !activeDeck?.cardIds.length"
        @click="exploreBattle"
      >
        <span>⚔</span>
        <strong>{{ busy ? '正在生成遭遇……' : '探索战斗' }}</strong>
        <small>从 {{ snapshot.world.region }} 自动抽取敌人</small>
      </button>
    </section>

    <p v-if="notice" class="battle-notice">{{ notice }}</p>
  </AdventurerFrame>
</template>

<style scoped>
.legacy-battle-shell {
  --battle-line: rgba(217, 180, 98, 0.38);
  position: relative;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(100px, 0.88fr) minmax(104px, 0.72fr) minmax(215px, 1.18fr);
  gap: 6px;
  overflow: hidden;
  padding: 7px;
  border: 1px solid rgba(217, 180, 98, 0.3);
  border-radius: 15px;
  color: #f7ead0;
  background:
    radial-gradient(circle at 50% -10%, rgba(217, 180, 98, 0.2), transparent 35%),
    linear-gradient(180deg, #2c2119, #111a28 38%, #080d15);
  box-shadow: inset 0 1px rgba(255, 241, 182, 0.12);
}

.battle-topbar {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid rgba(217, 180, 98, 0.44);
  border-radius: 13px;
  background: linear-gradient(180deg, rgba(55, 40, 27, 0.96), rgba(26, 22, 20, 0.94));
}

.battle-topbar > div:first-child {
  display: grid;
  min-width: 0;
}

.battle-topbar strong {
  color: #fff2bf;
  font-size: 13px;
}

.battle-topbar strong em {
  color: #ffd868;
  font-size: 9px;
  font-style: normal;
}

.battle-topbar span {
  overflow: hidden;
  color: rgba(245, 231, 199, 0.65);
  font-size: 9px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.battle-topbar > div:last-child {
  display: flex;
  gap: 6px;
}

.battle-topbar button {
  min-height: 31px;
  padding: 6px 10px;
  border: 1px solid var(--battle-line);
  border-radius: 11px;
  color: #f7ead0;
  background: rgba(255, 255, 255, 0.06);
  font: 800 10px var(--ca-ui);
  cursor: pointer;
}

.battle-topbar button.escape {
  border-color: rgba(255, 209, 150, 0.32);
  color: #fff3d2;
  background: linear-gradient(180deg, #ff3b34, #c71414);
}

.enemy-zone,
.summon-strip,
.battle-field-row,
.hand-zone {
  border: 1px solid var(--battle-line);
  background:
    linear-gradient(180deg, rgba(255, 244, 212, 0.1), rgba(255, 244, 212, 0.03)),
    linear-gradient(180deg, rgba(27, 38, 54, 0.96), rgba(18, 25, 36, 0.98));
  box-shadow: inset 0 1px rgba(255, 241, 182, 0.1);
}

.enemy-zone {
  min-height: 0;
  overflow: hidden;
  padding: 7px;
  border-radius: 17px;
}

.enemy-layout {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  place-content: stretch center;
}

.enemy-zone[data-count="1"] .enemy-card {
  grid-column: 2;
}

.enemy-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
  border: 2px solid rgba(255, 241, 182, 0.55);
  border-radius: 14px;
  color: #2a1a0d;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 28%),
    radial-gradient(circle at 50% 18%, #fff4b6, #f5cf70 52%, #d69b35);
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 2px rgba(255, 255, 255, 0.34), 0 9px 18px rgba(0, 0, 0, 0.22);
}

.enemy-card:hover,
.enemy-card.selected {
  border-color: #fff4ad;
  box-shadow:
    inset 0 2px rgba(255, 255, 255, 0.4),
    0 0 0 3px rgba(255, 230, 128, 0.2),
    0 12px 25px rgba(0, 0, 0, 0.26);
  transform: translateY(-1px);
}

.enemy-card.drag-over {
  border-color: #92ff9e;
  box-shadow:
    inset 0 0 24px rgba(115, 255, 135, 0.34),
    0 0 0 4px rgba(115, 255, 135, 0.24),
    0 0 32px rgba(115, 255, 135, 0.42);
  transform: translateY(-3px) scale(1.025);
}

.enemy-card.acting {
  animation: enemy-attack 0.5s cubic-bezier(.2, .75, .24, 1);
}

.enemy-card.hit {
  animation: battle-hit 0.42s ease;
}

.enemy-card.glow {
  animation: battle-glow 0.48s ease;
}

.enemy-card.defeated {
  filter: grayscale(1) brightness(0.72);
  opacity: 0.46;
}

.enemy-card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.enemy-card-title strong {
  overflow: hidden;
  font: 900 clamp(11px, 1.6vw, 16px) var(--ca-serif);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.enemy-card-title span {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  color: #fff8df;
  background: #c80f0f;
  font-size: 8px;
}

.enemy-card > small {
  display: block;
  margin: 3px 0;
  color: rgba(45, 28, 12, 0.67);
  font-size: 8px;
  font-weight: 800;
}

.intent {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  margin-top: 4px;
  color: #7d170e;
  font-size: 8px;
}

.intent b,
.intent span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.battle-mid {
  position: relative;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(32px, 0.7fr) auto minmax(34px, auto);
  gap: 3px;
}

.battle-mid.drag-over,
.companion-unit.drag-over {
  outline: 3px solid rgba(115, 255, 135, 0.66);
  outline-offset: 2px;
  box-shadow: 0 0 28px rgba(115, 255, 135, 0.34);
}

.companion-party {
  min-height: 56px;
  display: grid;
  grid-template-columns: minmax(132px, 0.8fr) minmax(132px, 0.8fr) minmax(220px, 1.7fr);
  gap: 4px;
}

.companion-unit,
.companion-summon,
.companion-sequence {
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: 5px 7px;
  border: 1px solid rgba(250, 219, 117, 0.42);
  border-radius: 10px;
  color: #fff2bd;
  background: linear-gradient(135deg, rgba(91, 67, 24, 0.92), rgba(25, 35, 52, 0.96));
  text-align: left;
}

.companion-unit {
  font: inherit;
  cursor: pointer;
}

.companion-unit.selected {
  border-color: #fff2a5;
  box-shadow: 0 0 0 2px rgba(255, 235, 133, 0.18);
}

.companion-unit.injured,
.companion-summon.defeated {
  filter: grayscale(0.75);
  opacity: 0.68;
}

.companion-unit.acting,
.companion-summon.acting {
  animation: player-action 0.46s cubic-bezier(.2, .75, .24, 1);
}

.companion-unit.hit,
.companion-summon.hit {
  animation: battle-hit 0.42s ease;
}

.companion-unit.glow,
.companion-summon.glow {
  animation: battle-glow 0.48s ease;
}

.companion-unit > span,
.companion-summon > span,
.companion-sequence > span {
  display: block;
  color: rgba(255, 239, 177, 0.7);
  font-size: 7px;
}

.companion-unit > strong,
.companion-summon > strong {
  display: block;
  font: 900 11px var(--ca-serif);
}

.companion-unit > small,
.companion-summon > small {
  display: block;
  overflow: hidden;
  font-size: 7px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.companion-sequence ol {
  display: flex;
  gap: 3px;
  margin: 4px 0 0;
  padding: 0;
  overflow-x: auto;
  list-style: none;
}

.companion-sequence li {
  flex: 0 0 auto;
  padding: 3px 5px;
  border: 1px solid rgba(255, 239, 177, 0.18);
  border-radius: 999px;
  color: rgba(255, 244, 206, 0.65);
  font-size: 7px;
}

.companion-sequence li.current {
  border-color: #ffe675;
  color: #241603;
  background: #ffe675;
  font-weight: 900;
}

.friendly-target-picker {
  position: absolute;
  z-index: 170;
  right: 12px;
  bottom: 218px;
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 24px);
  padding: 5px 7px;
  border: 1px solid rgba(255, 232, 125, 0.45);
  border-radius: 11px;
  color: #fff0b2;
  background: rgba(12, 18, 28, 0.94);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.34);
}

.friendly-target-picker strong,
.friendly-target-picker span,
.friendly-target-picker button {
  font-size: 8px;
}

.friendly-target-picker button {
  padding: 4px 8px;
  border: 1px solid rgba(255, 232, 125, 0.35);
  border-radius: 999px;
  color: #fff0b2;
  background: transparent;
  cursor: pointer;
}

.friendly-target-picker button.selected {
  color: #271902;
  background: #ffe675;
}

.battle-mid.acting {
  animation: player-action 0.46s cubic-bezier(.2, .75, .24, 1);
}

.battle-mid.hit {
  animation: battle-hit 0.42s ease;
}

.battle-mid.glow {
  animation: battle-glow 0.48s ease;
}

.summon-strip {
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  padding: 5px;
  border-radius: 12px;
}

.summon-strip > span {
  width: 100%;
  color: rgba(245, 231, 199, 0.55);
  font-size: 9px;
  text-align: center;
}

.summon-strip article {
  position: relative;
  min-width: 168px;
  display: grid;
  align-content: start;
  gap: 2px;
  overflow: hidden;
  padding: 5px 7px;
  border: 1px solid rgba(125, 238, 158, 0.34);
  border-radius: 9px;
  background: rgba(73, 230, 109, 0.08);
}

.summon-strip article.acting {
  animation: player-action 0.46s cubic-bezier(.2, .75, .24, 1);
}

.summon-strip article.hit {
  animation: battle-hit 0.42s ease;
}

.summon-strip article.glow {
  animation: battle-glow 0.48s ease;
}

.summon-strip article.defeated {
  filter: grayscale(0.75);
  opacity: 0.68;
}

.summon-strip article > small {
  color: rgba(171, 240, 195, 0.64);
  font-size: 7px;
}

.summon-strip strong {
  color: #eaffdf;
  font-size: 9px;
}

.summon-strip article > span {
  color: rgba(224, 255, 225, 0.7);
  font-size: 8px;
}

.summon-statuses {
  min-width: 0;
  display: flex;
  gap: 3px;
  overflow-x: auto;
  padding-top: 2px;
}

.summon-statuses span {
  flex: 0 0 auto;
  padding: 2px 4px;
  border: 1px solid rgba(73, 230, 109, 0.32);
  border-radius: 999px;
  color: #c9f6d3;
  background: rgba(73, 230, 109, 0.12);
  font-size: 7px;
  white-space: nowrap;
}

.summon-statuses span.negative {
  border-color: rgba(255, 98, 91, 0.38);
  color: #ffb1ac;
  background: rgba(255, 55, 48, 0.13);
}

.mechanism-resource-strip {
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  overflow-x: auto;
  padding: 3px 6px;
}

.mechanism-resource-strip span {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid rgba(212, 168, 67, 0.35);
  border-radius: 999px;
  color: rgba(245, 231, 199, 0.72);
  background: rgba(212, 168, 67, 0.08);
  font-size: 8px;
}

.mechanism-resource-strip b {
  margin-left: 3px;
  color: #f3d383;
  font-size: 9px;
}

.battle-field-row {
  min-height: 27px;
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  padding: 4px 7px;
  border-radius: 10px;
}

.battle-field-row > b {
  flex: 0 0 auto;
  color: #e1c073;
  font-size: 9px;
}

.battle-field-row > .status-row {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.battle-field-row > .status-row::-webkit-scrollbar {
  display: none;
}

.battle-field-row > small {
  flex: 0 0 auto;
  color: rgba(245, 231, 199, 0.62);
  font-size: 8px;
}

.player-bars {
  display: grid;
  grid-template-columns: 1fr 1fr minmax(78px, auto);
  gap: 5px;
  min-height: 0;
}

.player-shield-meter {
  min-width: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  padding: 3px 8px;
  border: 1px solid rgba(132, 198, 255, 0.28);
  border-radius: 8px;
  color: rgba(220, 238, 255, 0.68);
  background: rgba(40, 102, 151, 0.12);
}

.player-shield-meter span {
  font-size: 7px;
}

.player-shield-meter strong {
  color: #b9ddff;
  font-size: 11px;
}

.player-shield-meter.active {
  border-color: rgba(120, 195, 255, 0.72);
  background: linear-gradient(180deg, rgba(52, 137, 204, 0.34), rgba(26, 78, 121, 0.2));
  box-shadow: inset 0 0 12px rgba(102, 184, 255, 0.16);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 15px;
  overflow: hidden;
}

.status-row span {
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid rgba(73, 230, 109, 0.3);
  border-radius: 999px;
  color: #225e30;
  background: rgba(73, 230, 109, 0.13);
  font-size: 7px;
  font-weight: 800;
}

.battle-field-row .status-row span {
  color: #bce9c7;
}

.status-row span.negative {
  border-color: rgba(201, 20, 20, 0.34);
  color: #a31212;
  background: rgba(255, 55, 48, 0.12);
}

.battle-field-row .status-row span.negative {
  color: #ffaaa5;
}

.status-row span.special {
  border-color: rgba(226, 204, 255, 0.56);
  color: #efe0ff;
  background: rgba(130, 82, 184, 0.24);
  box-shadow: inset 0 0 8px rgba(197, 151, 255, 0.12);
}

.status-row span.profession-status {
  border-color: rgba(255, 216, 104, 0.68);
  color: #fff0ad;
  background: linear-gradient(180deg, rgba(133, 88, 24, 0.44), rgba(89, 52, 18, 0.32));
  box-shadow: inset 0 0 9px rgba(255, 211, 92, 0.15);
}

.hand-zone {
  position: relative;
  z-index: 40;
  min-height: 0;
  overflow: hidden;
  border-radius: 17px;
}

.hand-zone.card-raised {
  z-index: 600;
  overflow: visible;
}

.ap-orb {
  position: absolute;
  z-index: 80;
  left: 8px;
  top: 8px;
  width: 58px;
  height: 58px;
  display: grid;
  place-content: center;
  border: 1px solid rgba(255, 246, 185, 0.68);
  border-radius: 50%;
  color: #211405;
  background: radial-gradient(circle at 35% 24%, #fff7a4, #f2cf4e 68%, #c58e23);
  box-shadow: inset 0 2px rgba(255, 255, 255, 0.45), 0 8px 18px rgba(0, 0, 0, 0.26);
  text-align: center;
}

.ap-orb strong {
  font: 900 19px/1 var(--ca-serif);
}

.ap-orb span {
  font-size: 7px;
  font-weight: 900;
}

.hand-actions {
  position: absolute;
  z-index: 80;
  top: 9px;
  left: 50%;
  display: flex;
  gap: 5px;
  max-width: calc(100% - 142px);
  transform: translateX(-50%);
}

.hand-actions button {
  min-height: 31px;
  padding: 7px 9px;
  border: 1px solid rgba(255, 241, 182, 0.28);
  border-radius: 11px;
  color: #211405;
  font: 900 9px var(--ca-ui);
  white-space: nowrap;
  cursor: pointer;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.22), 0 6px 13px rgba(0, 0, 0, 0.23);
}

.hand-actions .discard {
  color: #fff7d7;
  background: linear-gradient(180deg, #ff3b34, #cf1212);
}

.hand-actions .inventory-toggle {
  color: #ecf8ff;
  background: linear-gradient(180deg, #3d94bd, #175578);
}

.hand-actions .end-turn {
  background: linear-gradient(180deg, #fff58a, #e4bf38);
}

.hand-actions button:disabled {
  cursor: not-allowed;
  filter: grayscale(0.5);
  opacity: 0.44;
}

.pile-button {
  position: absolute;
  z-index: 80;
  left: 7px;
  bottom: 8px;
  padding: 5px 6px;
  border: 1px solid rgba(217, 180, 98, 0.28);
  border-radius: 8px;
  color: #f1ddb0;
  background: rgba(255, 241, 182, 0.07);
  font: 800 8px/1.35 var(--ca-ui);
  text-align: left;
  cursor: pointer;
}

.fan-hand {
  position: absolute;
  inset: 38px 0 0;
  min-height: 0;
}

.fan-card {
  position: absolute;
  z-index: var(--card-z);
  left: 50%;
  bottom: 5px;
  width: clamp(102px, 15.5vw, 142px);
  aspect-ratio: 9 / 16;
  padding: 0;
  overflow: hidden;
  container-type: inline-size;
  border: 3px solid #a08d72;
  border-radius: 12px;
  color: #2b2118;
  background:
    var(--card-face) center / 100% 100% no-repeat,
    linear-gradient(160deg, #f5e7c8, #d6bc8c);
  font: inherit;
  text-align: center;
  touch-action: none;
  user-select: none;
  cursor: pointer;
  box-shadow: 0 13px 22px rgba(0, 0, 0, 0.3);
  transform:
    translateX(calc(-50% + var(--card-x)))
    rotate(var(--card-rot));
  transform-origin: 50% 100%;
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.fan-card::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  content: '';
  pointer-events: none;
}

.fan-card[data-rarity="uncommon"] { border-color: #4fa36d; }
.fan-card[data-rarity="rare"] { border-color: #4f91c5; }
.fan-card[data-rarity="epic"] { border-color: #a35bb9; }
.fan-card[data-rarity="legendary"] { border-color: #d4a843; }

.fan-card:hover {
  z-index: 420;
  box-shadow: 0 19px 34px rgba(0, 0, 0, 0.4), 0 0 0 4px rgba(255, 232, 122, 0.25);
  transform:
    translateX(calc(-50% + var(--card-x)))
    translateY(-12%)
    scale(1.07)
    rotate(0);
}

.fan-card.selected {
  z-index: 700;
  box-shadow:
    0 25px 44px rgba(0, 0, 0, 0.5),
    0 0 0 4px rgba(255, 232, 122, 0.3);
  transform:
    translateX(-50%)
    translateY(-48%)
    scale(1.2)
    rotate(0);
}

.fan-card.unavailable {
  filter: saturate(0.55) brightness(0.78);
}

.fan-card.blank-card {
  border-color: #d8d8d8;
  border-style: dashed;
  background:
    linear-gradient(rgba(255, 255, 255, 0.9), rgba(226, 226, 226, 0.88)),
    var(--card-face) center / 100% 100% no-repeat;
  filter: saturate(0.12);
}

.fan-card.blank-card .fan-card-name {
  color: #383838;
}

.battle-drag-clone {
  contain: layout paint style;
  will-change: transform, opacity;
  cursor: grabbing;
  box-shadow:
    0 24px 50px rgba(0, 0, 0, 0.55),
    0 0 0 4px rgba(255, 236, 151, 0.32);
}

.play-selected-floating {
  position: absolute;
  z-index: 1000;
  right: 9px;
  bottom: 9px;
  width: min(170px, 30%);
  min-height: 42px;
  display: grid;
  gap: 1px;
  padding: 7px 12px;
  overflow: hidden;
  border: 1px solid rgba(210, 239, 255, 0.65);
  border-radius: 13px;
  color: #e8f7ff;
  background: linear-gradient(180deg, #42a9dc, #155b8d);
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.3),
    0 10px 22px rgba(0, 0, 0, 0.42),
    0 0 0 3px rgba(66, 169, 220, 0.13);
}

.play-selected-floating span {
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.play-selected-floating strong {
  overflow: hidden;
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.play-selected-floating:disabled {
  cursor: not-allowed;
  filter: grayscale(0.55);
  opacity: 0.48;
}

.battle-float-layer {
  position: absolute;
  z-index: 900;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.battle-float-layer span {
  position: absolute;
  left: 50%;
  top: 45%;
  min-width: max-content;
  color: #ff3b34;
  font: 900 clamp(14px, 2.4vw, 24px)/1 var(--ca-serif);
  text-shadow:
    0 2px 0 rgba(255, 255, 255, 0.8),
    0 4px 12px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  animation: battle-float 0.78s cubic-bezier(.16, .78, .25, 1) forwards;
}

.battle-float-layer span[data-kind="heal"] {
  color: #29cf64;
}

.battle-float-layer span[data-kind="shield"] {
  color: #d7efff;
}

.battle-float-layer span[data-kind="mp"] {
  color: #55bfff;
}

.battle-float-layer span[data-kind="ap"],
.battle-float-layer span[data-kind="draw"] {
  color: #ffe36e;
}

.battle-float-layer span[data-kind="status"] {
  color: #f2c872;
  font-size: clamp(11px, 1.8vw, 18px);
}

.player-floats {
  z-index: 160;
}

.animation-caption {
  position: absolute;
  z-index: 560;
  left: 50%;
  top: 48%;
  max-width: 78%;
  padding: 5px 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 232, 137, 0.32);
  border-radius: 999px;
  color: #fff0b0;
  background: rgba(13, 17, 24, 0.82);
  font: 900 9px var(--ca-ui);
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

@keyframes enemy-attack {
  0% { transform: translateY(0) scale(1); }
  38% { transform: translateY(11px) scale(1.045); filter: brightness(1.14); }
  62% { transform: translateY(7px) scale(1.03); }
  100% { transform: translateY(0) scale(1); }
}

@keyframes player-action {
  0% { transform: translateY(0) scale(1); filter: brightness(1); }
  42% { transform: translateY(-7px) scale(1.018); filter: brightness(1.18); }
  100% { transform: translateY(0) scale(1); filter: brightness(1); }
}

@keyframes battle-hit {
  0%, 100% { transform: translate(0, 0); filter: brightness(1); }
  18% { transform: translate(-5px, 1px); filter: brightness(1.45) saturate(1.45); }
  38% { transform: translate(5px, -1px); }
  58% { transform: translate(-3px, 0); }
  78% { transform: translate(2px, 0); }
}

@keyframes battle-glow {
  0%, 100% { filter: brightness(1); }
  45% {
    filter: brightness(1.3) saturate(1.2);
    box-shadow: 0 0 24px rgba(112, 235, 161, 0.38);
  }
}

@keyframes battle-float {
  0% { opacity: 0; transform: translate(-50%, -20%) scale(.72); }
  20% { opacity: 1; transform: translate(-50%, -60%) scale(1.14); }
  72% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -150%) scale(.96); }
}

.fan-cost {
  position: absolute;
  z-index: 2;
  left: 6.8%;
  top: 5.1%;
  width: 15%;
  display: grid;
  gap: 3px;
  line-height: 1;
  pointer-events: none;
}

.fan-cost span {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(55, 42, 28, 0.46);
  border-radius: 50%;
  background: rgba(246, 237, 206, 0.94);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.18), inset 0 1px rgba(255, 255, 255, 0.55);
  font-weight: 900;
  text-shadow: 0 1px rgba(255, 255, 255, 0.55);
}

.fan-cost small {
  font-size: clamp(4px, 5.2cqw, 7px);
  font-weight: 900;
  line-height: 0.9;
  opacity: 0.72;
}

.fan-cost b {
  font-size: clamp(8px, 12cqw, 14px);
  line-height: 0.92;
}

.fan-cost .ap { color: #5b4117; }
.fan-cost .mp { color: #15415c; }

.fan-card-name {
  position: absolute;
  left: 20%;
  right: 12%;
  top: 30.5%;
  height: 10.5%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #201409;
  font: 900 clamp(9px, 11.2cqw, 15px)/1.08 var(--ca-serif);
  text-align: center;
  text-shadow: 0 1px rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

.fan-card-meta {
  position: absolute;
  left: 20.5%;
  right: 12.5%;
  top: 41.5%;
  overflow: hidden;
  color: #6f5135;
  font-size: clamp(5px, 6.2cqw, 8px);
  font-weight: 800;
  line-height: 1.1;
  text-align: center;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}

.fan-card-effect {
  position: absolute;
  left: 20.5%;
  right: 12.5%;
  top: 47.5%;
  bottom: 17%;
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #2b2118;
  font-size: clamp(6.5px, 8.2cqw, 10px);
  font-weight: 800;
  line-height: 1.2;
  text-align: center;
  pointer-events: none;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.battle-info {
  position: absolute;
  z-index: 180;
  inset: 52px 9px 9px auto;
  width: min(360px, calc(100% - 18px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(217, 180, 98, 0.52);
  border-radius: 14px;
  background: rgba(10, 15, 24, 0.96);
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(12px);
}

.battle-inventory {
  position: absolute;
  z-index: 1250;
  inset: 50% auto auto 50%;
  width: min(520px, calc(100% - 18px));
  max-height: min(72%, 500px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid rgba(217, 180, 98, 0.62);
  border-radius: 15px;
  color: #f7ead0;
  background:
    radial-gradient(circle at 0 0, rgba(217, 180, 98, 0.14), transparent 42%),
    rgba(10, 15, 24, 0.98);
  box-shadow: 0 22px 52px rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(14px);
  transform: translate(-50%, -50%);
}

.battle-inventory header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 13px;
  border-bottom: 1px solid rgba(217, 180, 98, 0.25);
}

.battle-inventory header > div {
  display: grid;
  gap: 2px;
}

.battle-inventory header strong {
  color: #fff2bf;
  font: 900 14px var(--ca-serif);
}

.battle-inventory header span {
  color: rgba(245, 231, 199, 0.68);
  font-size: 9px;
}

.battle-inventory header button {
  border: 0;
  color: #f7ead0;
  background: transparent;
  font-size: 23px;
  cursor: pointer;
}

.inventory-hint,
.inventory-empty {
  margin: 0;
  padding: 10px 13px;
  color: rgba(245, 231, 199, 0.7);
  font-size: 9px;
}

.inventory-hint {
  color: #ffdda0;
  background: rgba(255, 185, 66, 0.08);
}

.battle-inventory-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 7px;
  padding: 10px 12px;
  overflow: auto;
}

.battle-inventory-list article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid rgba(217, 180, 98, 0.24);
  border-radius: 11px;
  background: rgba(255, 244, 212, 0.055);
}

.battle-inventory-list article > div {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
}

.battle-inventory-list strong {
  overflow: hidden;
  color: #fff2bf;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.battle-inventory-list span {
  color: #8edcff;
  font-size: 8px;
  font-weight: 900;
}

.battle-inventory-list p {
  grid-column: 1 / 3;
  margin: 0;
  color: rgba(245, 231, 199, 0.65);
  font-size: 8px;
  line-height: 1.45;
}

.battle-inventory-list button {
  min-width: 66px;
  min-height: 34px;
  border: 1px solid rgba(145, 226, 255, 0.45);
  border-radius: 10px;
  color: #eafaff;
  background: linear-gradient(180deg, #3d9dcc, #176089);
  font: 900 9px var(--ca-ui);
  cursor: pointer;
}

.battle-inventory-list button:disabled {
  cursor: not-allowed;
  filter: grayscale(0.65);
  opacity: 0.45;
}

.battle-inventory > small {
  padding: 8px 12px 10px;
  border-top: 1px solid rgba(217, 180, 98, 0.16);
  color: rgba(245, 231, 199, 0.5);
  font-size: 8px;
  line-height: 1.45;
}

.battle-info header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid rgba(217, 180, 98, 0.25);
}

.battle-info header > div {
  display: grid;
}

.battle-info header strong {
  color: #fff2bf;
  font-size: 12px;
}

.battle-info header span {
  color: rgba(245, 231, 199, 0.6);
  font-size: 8px;
}

.battle-info header button {
  border: 0;
  color: #f7ead0;
  background: transparent;
  font-size: 22px;
  cursor: pointer;
}

.battle-info ol {
  margin: 0;
  padding: 9px 12px;
  overflow: auto;
  list-style: none;
}

.battle-info li {
  padding: 4px 0;
  color: rgba(245, 231, 199, 0.65);
  font-size: 9px;
  line-height: 1.35;
}

.battle-info li span {
  margin-right: 5px;
  color: #d9b462;
  font-weight: 900;
}

.battle-info li[data-kind="player"],
.battle-info li[data-kind="reward"] { color: #b8d9c3; }
.battle-info li[data-kind="enemy"] { color: #e5a09b; }

.battle-pile-details {
  position: absolute;
  z-index: 1250;
  inset: 50% auto auto 50%;
  width: min(680px, calc(100% - 18px));
  max-height: min(78%, 560px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(217, 180, 98, 0.62);
  border-radius: 15px;
  color: #f7ead0;
  background:
    radial-gradient(circle at 0 0, rgba(217, 180, 98, 0.14), transparent 42%),
    rgba(10, 15, 24, 0.98);
  box-shadow: 0 22px 52px rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(14px);
  transform: translate(-50%, -50%);
}

.battle-pile-details > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 13px;
  border-bottom: 1px solid rgba(217, 180, 98, 0.25);
}

.battle-pile-details > header > div {
  display: grid;
  gap: 2px;
}

.battle-pile-details > header strong {
  color: #fff2bf;
  font: 900 14px var(--ca-serif);
}

.battle-pile-details > header span {
  color: rgba(245, 231, 199, 0.68);
  font-size: 9px;
}

.battle-pile-details > header button {
  border: 0;
  color: #f7ead0;
  background: transparent;
  font-size: 23px;
  cursor: pointer;
}

.pile-detail-columns {
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
}

.pile-detail-columns > section {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 7px;
  padding: 10px;
  overflow: auto;
}

.pile-detail-columns > section + section {
  border-left: 1px solid rgba(217, 180, 98, 0.2);
}

.pile-detail-columns h3 {
  position: sticky;
  z-index: 2;
  top: -10px;
  margin: -10px -10px 2px;
  padding: 9px 10px 7px;
  color: #e7c578;
  background: rgba(10, 15, 24, 0.96);
  font: 900 11px var(--ca-serif);
}

.pile-detail-columns article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid rgba(217, 180, 98, 0.2);
  border-radius: 10px;
  background: rgba(255, 244, 212, 0.045);
}

.pile-detail-columns article > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.pile-detail-columns article strong {
  color: #fff1c8;
  font-size: 10px;
}

.pile-detail-columns article span,
.pile-detail-columns article p,
.pile-empty {
  margin: 0;
  color: rgba(245, 231, 199, 0.62);
  font-size: 8px;
  line-height: 1.4;
}

.pile-detail-columns article > b {
  color: #8edcff;
  font-size: 10px;
}

.battle-choice-overlay {
  position: absolute;
  z-index: 1800;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 14px;
  background: rgba(4, 7, 13, 0.82);
  backdrop-filter: blur(9px);
}

.battle-choice-panel {
  width: min(720px, 100%);
  max-height: min(88%, 620px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(230, 199, 116, 0.72);
  border-radius: 18px;
  color: #f8edda;
  background:
    radial-gradient(circle at 50% 0, rgba(120, 86, 192, 0.3), transparent 45%),
    linear-gradient(180deg, rgba(25, 22, 45, 0.99), rgba(11, 16, 27, 0.99));
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.72), inset 0 1px rgba(255, 255, 255, 0.12);
}

.battle-choice-panel > header {
  padding: 15px 17px 12px;
  border-bottom: 1px solid rgba(230, 199, 116, 0.23);
  text-align: center;
}

.battle-choice-panel > header span {
  color: #c6a6ff;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.18em;
}

.battle-choice-panel h2 {
  margin: 3px 0 4px;
  color: #ffe69a;
  font: 950 20px var(--ca-serif);
}

.battle-choice-panel header p {
  margin: 0;
  color: rgba(245, 231, 199, 0.72);
  font-size: 9px;
}

.battle-choice-list {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 9px;
  padding: 13px;
  overflow: auto;
}

.battle-choice-list button {
  min-height: 142px;
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 12px;
  border: 1px solid rgba(225, 194, 113, 0.46);
  border-radius: 14px;
  color: #f6ead3;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 38%),
    rgba(42, 34, 61, 0.92);
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.1), 0 8px 20px rgba(0, 0, 0, 0.24);
}

.battle-choice-list button:hover:not(:disabled) {
  border-color: #ffe596;
  transform: translateY(-2px);
  box-shadow: 0 0 0 3px rgba(255, 226, 135, 0.12), 0 12px 26px rgba(0, 0, 0, 0.34);
}

.battle-choice-list button.picked,
.battle-choice-list button:disabled {
  filter: grayscale(0.45);
  opacity: 0.5;
  cursor: default;
}

.battle-choice-list strong {
  color: #fff0b6;
  font: 900 13px var(--ca-serif);
}

.battle-choice-list strong em {
  color: #86f49e;
  font-style: normal;
}

.battle-choice-list span {
  color: #c8a8ff;
  font-size: 8px;
  font-weight: 900;
}

.battle-choice-list p {
  margin: 0;
  color: rgba(245, 231, 199, 0.72);
  font-size: 9px;
  line-height: 1.5;
}

.exploration-ready,
.battle-result {
  width: min(720px, 100%);
  margin: max(12px, 4vh) auto;
  padding: clamp(18px, 4vw, 32px);
  border: 1px solid rgba(212, 168, 67, 0.38);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0 0, rgba(212, 168, 67, 0.14), transparent 38%),
    var(--ca-surface);
}

.exploration-copy > span,
.battle-result > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.16em;
}

.exploration-copy h1,
.battle-result h1 {
  margin: 6px 0;
  color: var(--ca-text-bright);
  font: 700 clamp(23px, 4vw, 34px) var(--ca-serif);
}

.exploration-copy p,
.encounter-rule p,
.battle-result p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.6;
}

.exploration-stats,
.reward-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 20px 0;
}

.exploration-stats article,
.reward-grid article {
  display: grid;
  gap: 4px;
  padding: 11px 8px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  background: var(--ca-surface-soft);
  text-align: center;
}

.exploration-stats small,
.reward-grid small {
  color: var(--ca-muted);
  font-size: 8px;
}

.exploration-stats strong,
.reward-grid strong {
  overflow: hidden;
  color: var(--ca-gold-light);
  font: 700 14px var(--ca-serif);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.encounter-rule {
  padding: 12px;
  border: 1px dashed rgba(212, 168, 67, 0.3);
  border-radius: 11px;
  background: rgba(212, 168, 67, 0.05);
}

.encounter-rule strong {
  color: var(--ca-text-bright);
  font-size: 11px;
}

.encounter-rule p {
  margin-top: 5px;
  font-size: 9px;
}

.explore-button {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  gap: 1px 10px;
  align-items: center;
  margin-top: 18px;
  padding: 13px 17px;
  border: 1px solid var(--ca-gold-dark);
  border-radius: 13px;
  color: #241a0b;
  background: linear-gradient(135deg, #f0d68a, #d4a843);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.explore-button > span {
  grid-row: 1 / 3;
  font-size: 28px;
}

.explore-button strong {
  font-size: 14px;
}

.explore-button small {
  font-size: 9px;
  opacity: 0.72;
}

.explore-button:disabled {
  cursor: not-allowed;
  filter: grayscale(0.6);
  opacity: 0.5;
}

.battle-result {
  text-align: center;
  max-height: calc(100% - max(24px, 8vh));
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.reward-items {
  margin: 0 0 15px;
  padding: 0;
  color: var(--ca-text);
  font-size: 10px;
  list-style: none;
}

.reward-choices {
  display: grid;
  gap: 9px;
  margin: 0 0 16px;
  text-align: left;
}

.reward-choices section {
  padding: 10px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  background: var(--ca-surface-soft);
}

.reward-choices strong {
  display: block;
  margin-bottom: 7px;
  color: var(--ca-gold-light);
  font-size: 10px;
}

.reward-choices div {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
}

.reward-choices button {
  padding: 6px 9px;
  border: 1px solid var(--ca-gold-dark);
  border-radius: 8px;
  color: var(--ca-text-bright);
  background: rgba(212, 168, 67, 0.1);
  font: 700 9px var(--ca-ui);
  cursor: pointer;
}

.reward-choices .reward-option {
  min-height: 92px;
  display: grid;
  align-content: start;
  gap: 4px;
  text-align: left;
}

.reward-option b {
  color: var(--ca-text-bright);
  font-size: 11px;
}

.reward-option small {
  color: var(--ca-gold-light);
  font-size: 8px;
  line-height: 1.35;
}

.reward-option p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 9px;
  font-weight: 500;
  line-height: 1.45;
}

.reward-choices .reward-skip {
  align-self: stretch;
  min-height: 38px;
}

.battle-main-button {
  min-height: 38px;
  padding: 9px 18px;
  border: 1px solid var(--ca-gold-dark);
  border-radius: 10px;
  color: #211405;
  background: linear-gradient(180deg, #fff58a, #d4a843);
  font: 900 11px var(--ca-ui);
  cursor: pointer;
}

.battle-notice {
  position: absolute;
  z-index: 220;
  left: 50%;
  bottom: 10px;
  max-width: 90%;
  margin: 0;
  padding: 7px 11px;
  border: 1px solid rgba(217, 180, 98, 0.42);
  border-radius: 999px;
  color: #fff2bf;
  background: rgba(24, 22, 18, 0.94);
  font-size: 9px;
  text-align: center;
  transform: translateX(-50%);
}

@media (max-width: 980px) {
  .legacy-battle-shell {
    grid-template-rows: auto minmax(100px, 0.9fr) minmax(100px, 0.75fr) minmax(205px, 1.15fr);
  }

  .fan-card {
    width: clamp(96px, 17vw, 128px);
  }
}

@media (max-width: 759px) {
  .legacy-battle-shell {
    height: auto;
    min-height: 100%;
    grid-template-rows: auto auto auto minmax(190px, 48dvh);
    gap: 4px;
    overflow: visible;
    padding: 4px;
    border-radius: 0;
  }

  .battle-topbar {
    min-height: 38px;
    padding: 4px 6px;
    border-radius: 10px;
  }

  .battle-topbar strong {
    font-size: 11px;
  }

  .enemy-zone {
    overflow: visible;
    padding: 4px;
    border-radius: 12px;
  }

  .enemy-layout {
    height: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: minmax(88px, auto);
    gap: 4px;
  }

  .enemy-zone[data-count="1"] .enemy-card {
    grid-column: 1 / 3;
    width: min(270px, 78%);
    justify-self: center;
  }

  .enemy-card {
    padding: 6px;
    border-radius: 10px;
  }

  .enemy-card-title strong {
    font-size: 11px;
  }

  .enemy-card > small,
  .intent {
    font-size: 7px;
  }

  .player-bars {
    grid-template-columns: 1fr 1fr minmax(68px, auto);
    gap: 2px;
  }

  .battle-mid {
    grid-template-rows: auto auto auto auto;
  }

  .companion-party {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .companion-sequence {
    grid-column: 1 / -1;
  }

  .friendly-target-picker {
    bottom: calc(max(190px, 48dvh) + 8px);
  }

  .battle-field-row > small {
    display: none;
  }

  .ap-orb {
    width: 48px;
    height: 48px;
    left: 5px;
    top: 5px;
  }

  .ap-orb strong {
    font-size: 16px;
  }

  .hand-actions {
    top: 6px;
    gap: 3px;
    max-width: calc(100% - 108px);
  }

  .hand-actions button {
    min-height: 28px;
    padding: 6px;
    border-radius: 9px;
    font-size: 8px;
  }

  .battle-inventory {
    width: calc(100% - 10px);
    max-height: 78%;
    border-radius: 12px;
  }

  .battle-pile-details {
    width: calc(100% - 10px);
    max-height: 82%;
    border-radius: 12px;
  }

  .pile-detail-columns {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .pile-detail-columns > section {
    overflow: visible;
  }

  .pile-detail-columns > section + section {
    border-top: 1px solid rgba(217, 180, 98, 0.2);
    border-left: 0;
  }

  .battle-choice-overlay {
    padding: 5px;
  }

  .battle-choice-panel {
    max-height: 96%;
    border-radius: 13px;
  }

  .battle-choice-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding: 8px;
  }

  .battle-choice-list button {
    min-height: 118px;
    padding: 8px;
  }

  .pile-button {
    left: 4px;
    bottom: 5px;
    padding: 4px;
    font-size: 7px;
  }

  .fan-hand {
    inset: 33px 0 0;
  }

  .fan-card {
    width: clamp(84px, 25vw, 110px);
    border-width: 2px;
    transform:
      translateX(calc(-50% + var(--card-x-mobile)))
      rotate(var(--card-rot-mobile));
  }

  .fan-card:hover {
    transform:
      translateX(calc(-50% + var(--card-x-mobile)))
      translateY(-12%)
      scale(1.06)
      rotate(0);
  }

  .fan-card.selected {
    transform:
      translateX(-50%)
      translateY(-48%)
      scale(1.16)
      rotate(0);
  }

  .play-selected-floating {
    right: 5px;
    bottom: 5px;
    width: min(126px, 36%);
    min-height: 38px;
    padding: 6px 9px;
    border-radius: 11px;
  }

  .fan-card-name {
    font-size: clamp(8px, 10.5cqw, 12px);
  }

  .fan-card-effect {
    font-size: clamp(6px, 7.8cqw, 8px);
    line-height: 1.16;
  }

  .fan-cost {
    gap: 2px;
  }

  .fan-cost small {
    font-size: 4px;
  }

  .battle-info {
    inset: 45px 5px 5px auto;
  }

  .exploration-ready,
  .battle-result {
    margin: 5px auto;
    max-height: calc(100% - 10px);
    padding: 16px;
    border-radius: 13px;
  }

  .exploration-stats,
  .reward-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 14px 0;
  }
}

@media (max-width: 480px) {
  .fan-card {
    transform:
      translateX(calc(-50% + var(--card-x-compact)))
      rotate(var(--card-rot-mobile));
  }

  .fan-card:hover {
    transform:
      translateX(calc(-50% + var(--card-x-compact)))
      translateY(-12%)
      scale(1.06)
      rotate(0);
  }
}

@media (max-width: 390px) {
  .hand-actions {
    right: 4px;
    left: 58px;
    justify-content: flex-end;
    gap: 2px;
    max-width: none;
    transform: none;
  }

  .hand-actions button {
    min-width: 0;
    padding-inline: 5px;
    font-size: 8px;
  }

  .hand-actions .inventory-toggle {
    max-width: 76px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fan-card {
    transform:
      translateX(calc(-50% + var(--card-x-narrow)))
      rotate(var(--card-rot-mobile));
  }

  .fan-card:hover {
    transform:
      translateX(calc(-50% + var(--card-x-narrow)))
      translateY(-12%)
      scale(1.06)
      rotate(0);
  }

  .enemy-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .status-row {
    max-height: 16px;
  }
}
</style>
