<script setup lang="ts">
/* global Blob, Event, HTMLInputElement, URL, clearTimeout, document, setTimeout, structuredClone, window */
import { computed, onBeforeUnmount, ref, toRaw, watch } from 'vue';
import { refreshWorkshopPassiveCatalog } from '@/content/catalogs/battle';
import {
  loadCardCatalog,
  refreshWorkshopCardCatalog,
} from '@/content/catalogs/cards';
import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import type { CardEffect } from '@/content/types';
import type { PanelContext } from '@/kernel/public-api';
import { commandId } from '@/kernel/ids';
import {
  LIFESTEAL_CAP,
  LIFESTEAL_STAT_POINT_COST,
  STAT_POINTS_PER_LEVEL,
} from '@/player/progression';
import WorkshopEffectEditor from '@/modules/deck/WorkshopEffectEditor.vue';
import WorkshopEffectPalette from '@/modules/deck/WorkshopEffectPalette.vue';
import WorkshopStateResourceBuilder from '@/modules/deck/WorkshopStateResourceBuilder.vue';
import {
  WORKSHOP_MECHANISM_FORMAT,
  WORKSHOP_SCRIPT_MECHANISM_FORMAT,
  deleteWorkshopMechanism,
  isWorkshopScriptMechanism,
  normalizeWorkshopMechanism,
  readWorkshopMechanisms,
  saveWorkshopMechanism,
  type WorkshopMechanismManifest,
} from '@/workshop-mechanisms';
import {
  prepareWorkshopScriptRuntime,
  validateWorkshopScriptMechanism,
} from '@/workshop-script-runtime';
import {
  WORKSHOP_MAIN_CLASSES,
  WORKSHOP_TALENT_OPTIONS,
  deleteWorkshopClass,
  deleteWorkshopExtension,
  exportWorkshopPack,
  importWorkshopArtifact,
  normalizeWorkshopCard,
  readWorkshopDrafts,
  readWorkshopExtensions,
  readWorkshopPacks,
  saveWorkshopDraft,
  saveWorkshopPack,
  type WorkshopClass,
  type WorkshopDraft,
  type WorkshopExtensionManifest,
  type WorkshopMainClass,
} from '@/workshop';

type EditableEffect = CardEffect & Record<string, any>;
interface EditableCard {
  id: string;
  name: string;
  type: string;
  cost: number;
  rarity: string;
  description: string;
  tags: string[];
  effects: EditableEffect[];
}
interface EditableClass {
  id: string;
  main: WorkshopMainClass;
  name: string;
  description: string;
  talent: {
    name: string;
    description: string;
    effects: EditableEffect[];
  };
  cards: EditableCard[];
  cardPool: string[];
  starterDeck: string[];
  mechanismIds: string[];
}

const props = defineProps<{ context: PanelContext }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const tab = ref<'library' | 'editor' | 'drafts' | 'extensions' | 'test'>('library');
const published = ref(readWorkshopPacks());
const drafts = ref(readWorkshopDrafts());
const extensions = ref(readWorkshopExtensions());
const mechanisms = ref(readWorkshopMechanisms());
const editor = ref<EditableClass>(createEditor());
const activeCardId = ref('');
const notice = ref('');
const error = ref('');
const importInput = ref<HTMLInputElement>();
const testProfessionId = ref('');
const testMechanismIds = ref<string[]>([]);
const testConfig = ref({
  opponentMode: 'dummy' as 'dummy' | 'random-single' | 'random-multi',
  randomTier: 'mixed' as 'low' | 'high' | 'mixed',
  enemyScale: 1,
  dummyCount: 1,
  dummyHp: 500,
  dummyAttack: 0,
  dummyDefense: 0,
  dummyInvincible: false,
  dummyAttackEnabled: false,
  autoRespawn: true,
  playerInvincible: true,
  attributes: {
    hpMax: 40,
    mpMax: 30,
    attack: 220,
    defense: 180,
    speed: 100,
    actionPointsPerTurn: 6,
    lifesteal: 0,
  },
});
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

const mainClassNames: Record<string, string> = {
  knight: '骑士',
  mage: '法师',
  artisan: '工匠',
  freelance: '自由职业',
};
const typeNames: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  skill: '技能',
  summon: '召唤',
};
const activeCard = computed(() =>
  editor.value.cards.find((card) => card.id === activeCardId.value),
);
const testableProfessions = computed(() => {
  const byId = new Map<string, WorkshopClass>();
  for (const pack of published.value) {
    for (const profession of pack.classes) byId.set(profession.id, profession);
  }
  return [...byId.values()];
});
const deckCounts = computed(() =>
  editor.value.starterDeck.reduce<Record<string, number>>((result, id) => {
    result[id] = (result[id] ?? 0) + 1;
    return result;
  }, {}),
);
const poolCounts = computed(() =>
  editor.value.cardPool.reduce<Record<string, number>>((result, id) => {
    result[id] = (result[id] ?? 0) + 1;
    return result;
  }, {}),
);
const effectOptions = computed(() => [
  ...extensions.value.flatMap((extension) =>
    extension.presets.map((preset) => ({
      id: `${extension.id}:${preset.id}`,
      label: `${extension.name}｜${preset.label}`,
      description: preset.description,
      cardTypes: preset.cardTypes,
      effects: preset.effects,
    })),
  ),
]);
const workshopResourceOptions = computed(() =>
  mechanisms.value.flatMap((mechanism) =>
    mechanism.resources.map((resource) => ({
      mechanismId: mechanism.id,
      resourceId: resource.id,
      label: `${mechanism.name}｜${resource.label}`,
    })),
  ),
);
const workshopStatusOptions = computed(() =>
  mechanisms.value.flatMap((mechanism) =>
    mechanism.statuses.map((status) => ({
      mechanismId: mechanism.id,
      statusId: status.id,
      label: `${mechanism.name}｜${status.label}`,
      polarity: status.polarity,
    })),
  ),
);
const maxLevelAttributeBudget = 99 * STAT_POINTS_PER_LEVEL;
const testAttributeSpent = computed(() => {
  const attributes = testConfig.value.attributes;
  const apCount = Math.max(0, Math.floor(attributes.actionPointsPerTurn));
  const apCost = Math.min(apCount, 6) * 2 + Math.max(0, apCount - 6) * 3;
  return (
    Math.max(0, attributes.hpMax) +
    Math.max(0, attributes.mpMax) +
    Math.max(0, attributes.attack) +
    Math.max(0, attributes.defense) +
    Math.max(0, attributes.speed) +
    Math.max(0, attributes.lifesteal) * LIFESTEAL_STAT_POINT_COST +
    apCost
  );
});

function supportsCardType(
  option: { cardTypes: readonly string[] },
  cardType: string,
): boolean {
  return option.cardTypes.includes(cardType);
}

function cloneData<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

watch(
  editor,
  () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      saveWorkshopDraft({
        id: editor.value.id,
        updatedAt: Date.now(),
        value: cloneData(toRaw(editor.value)) as unknown as Partial<WorkshopClass>,
      });
      drafts.value = readWorkshopDrafts();
    }, 400);
  },
  { deep: true },
);

watch(
  () => testConfig.value.opponentMode,
  (mode) => {
    if (mode === 'random-multi' && testConfig.value.dummyCount < 2) {
      testConfig.value.dummyCount = 3;
    }
  },
);

onBeforeUnmount(() => clearTimeout(autosaveTimer));

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function createEditor(): EditableClass {
  return {
    id: makeId('custom_class'),
    main: 'freelance',
    name: '',
    description: '',
    talent: {
      name: '自定义天赋',
      description: '',
      effects: [],
    },
    cards: [],
    cardPool: [],
    starterDeck: [],
    mechanismIds: [],
  };
}

function editableFromValue(value: Partial<WorkshopClass>): EditableClass {
  const fallback = createEditor();
  const source = cloneData(toRaw(value)) as Partial<EditableClass>;
  const talent = source.talent ?? fallback.talent;
  const cards = Array.isArray(source.cards)
    ? source.cards.map((card, index) => ({
        id: String(card?.id || makeId(`custom_card_${source.id || fallback.id}_${index}`)),
        name: String(card?.name || `自定义卡牌${index + 1}`),
        type: String(card?.type || 'skill'),
        cost: Number.isFinite(Number(card?.cost)) ? Number(card?.cost) : 1,
        rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(
          String(card?.rarity),
        )
          ? String(card?.rarity)
          : 'common',
        description: String(card?.description || ''),
        tags: Array.isArray(card?.tags) ? card.tags.map(String) : [],
        effects: Array.isArray(card?.effects) ? card.effects : [],
      }))
    : [];
  return {
    id: String(source.id || fallback.id),
    main: WORKSHOP_MAIN_CLASSES.includes(source.main as WorkshopMainClass)
      ? (source.main as WorkshopMainClass)
      : fallback.main,
    name: String(source.name || ''),
    description: String(source.description || ''),
    talent: {
      name: String(talent.name || fallback.talent.name),
      description: String(talent.description || ''),
      effects: Array.isArray(talent.effects) ? talent.effects : [],
    },
    cards,
    cardPool: Array.isArray(source.cardPool)
      ? source.cardPool.map(String)
      : cards.map((card) => card.id),
    starterDeck: Array.isArray(source.starterDeck)
      ? source.starterDeck.map(String)
      : [],
    mechanismIds: Array.isArray(source.mechanismIds)
      ? source.mechanismIds.map(String)
      : [],
  };
}

function editableFromClass(profession: WorkshopClass): EditableClass {
  return editableFromValue(profession);
}

function newProfession(): void {
  editor.value = createEditor();
  activeCardId.value = '';
  tab.value = 'editor';
  notice.value = '';
  error.value = '';
}

function editProfession(profession: WorkshopClass): void {
  editor.value = editableFromClass(profession);
  activeCardId.value = editor.value.cards[0]?.id ?? '';
  tab.value = 'editor';
  notice.value = '';
  error.value = '';
}

function loadDraft(draft: WorkshopDraft): void {
  error.value = '';
  notice.value = '';
  try {
    editor.value = editableFromValue(draft.value);
    activeCardId.value = editor.value.cards[0]?.id ?? '';
    tab.value = 'editor';
    notice.value = '草稿已恢复，可以继续编辑。';
  } catch (caught) {
    error.value = `草稿读取失败：${caught instanceof Error ? caught.message : String(caught)}`;
  }
}

function addTalent(type: string): void {
  if (editor.value.talent.effects.length >= 4) return;
  const customType = [
    'apply_workshop_status',
    'workshop_resource_change',
  ].includes(type);
  if (
    !customType &&
    editor.value.talent.effects.some((effect) => effect.type === type)
  ) {
    error.value = '每个天赋词条只能添加一次。';
    return;
  }
  const defaults: Record<string, number> = {
    battle_start_shield: 5,
    turn_start_heal: 1,
    attack_bonus: 1,
    shield_bonus: 0.1,
    extra_draw: 1,
    first_turn_ap: 1,
    damage_reduction: 1,
    turn_start_cleanse: 1,
    turn_start_debuff_shield: 2,
    hand_limit_bonus: 5,
  };
  const effect: EditableEffect = { type };
  if (type === 'apply_workshop_status') {
    const option = workshopStatusOptions.value[0];
    if (!option) {
      error.value = '请先在扩展中创建一个自定义状态。';
      return;
    }
    Object.assign(effect, {
      trigger: 'battle_start',
      target: option.polarity === 'debuff' ? 'all_enemies' : 'self',
      mechanismId: option.mechanismId,
      statusId: option.statusId,
      value: 1,
      turns: -1,
    });
  } else if (type === 'workshop_resource_change') {
    const option = workshopResourceOptions.value[0];
    if (!option) {
      error.value = '请先在扩展中创建一个自定义资源。';
      return;
    }
    Object.assign(effect, {
      trigger: 'battle_start',
      target: 'self',
      mechanismId: option.mechanismId,
      resourceId: option.resourceId,
      mode: 'add',
      value: 1,
    });
  } else if (
    !['always_reveal_intent', 'defense_reflect', 'counterattack'].includes(type)
  ) {
    effect.value = defaults[type] ?? 1;
  }
  editor.value.talent.effects.push(effect);
  if (
    typeof effect.mechanismId === 'string' &&
    !editor.value.mechanismIds.includes(effect.mechanismId)
  ) {
    editor.value.mechanismIds.push(effect.mechanismId);
  }
  error.value = '';
}

function talentDefinitionValue(mechanismId: unknown, definitionId: unknown): string {
  return JSON.stringify([String(mechanismId ?? ''), String(definitionId ?? '')]);
}

function setTalentDefinition(
  effect: EditableEffect,
  kind: 'status' | 'resource',
  rawValue: string,
): void {
  try {
    const [mechanismId, definitionId] = JSON.parse(rawValue) as [string, string];
    effect.mechanismId = mechanismId;
    if (kind === 'status') effect.statusId = definitionId;
    else effect.resourceId = definitionId;
    if (!editor.value.mechanismIds.includes(mechanismId)) {
      editor.value.mechanismIds.push(mechanismId);
    }
  } catch {
    error.value = '自定义状态或资源选项无效，请重新选择。';
  }
}

function talentOptionDisabled(type: string): boolean {
  if (type === 'apply_workshop_status') {
    return workshopStatusOptions.value.length === 0;
  }
  if (type === 'workshop_resource_change') {
    return workshopResourceOptions.value.length === 0;
  }
  return editor.value.talent.effects.some((effect) => effect.type === type);
}

function addCard(): void {
  if (editor.value.cards.length >= 16) return;
  const id = makeId(`custom_card_${editor.value.id}`);
  editor.value.cards.push({
    id,
    name: `自定义卡牌${editor.value.cards.length + 1}`,
    type: 'skill',
    cost: 1,
    rarity: 'common',
    description: '',
    tags: [],
    effects: [],
  });
  editor.value.cardPool.push(id);
  activeCardId.value = id;
}

function setCardTags(card: EditableCard, value: string): void {
  card.tags = [
    ...new Set(
      value
        .split(/[，,\s]+/)
        .map((tag) =>
          tag
            .normalize('NFKC')
            .trim()
            .toLocaleLowerCase('zh-CN')
            .replace(/[^\p{L}\p{N}._:-]+/gu, '-')
            .replace(/^-+|-+$/g, ''),
        )
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function deleteCard(cardId: string): void {
  editor.value.cards = editor.value.cards.filter((card) => card.id !== cardId);
  editor.value.starterDeck = editor.value.starterDeck.filter(
    (id) => id !== cardId,
  );
  editor.value.cardPool = editor.value.cardPool.filter((id) => id !== cardId);
  activeCardId.value = editor.value.cards[0]?.id ?? '';
}

function addEffect(optionId: string): void {
  const card = activeCard.value;
  const option = effectOptions.value.find((entry) => entry.id === optionId);
  if (!card || !option || card.effects.length >= 8) return;
  if (!supportsCardType(option, card.type)) {
    error.value = '这个扩展预设不支持当前卡牌类型。';
    return;
  }
  const effects = option.effects.map((entry) => {
    const effect = cloneData(entry) as EditableEffect;
    delete effect.label;
    return effect;
  });
  if (card.effects.length + effects.length > 8) {
    error.value = '添加该预设后会超过每张卡牌 8 个效果的上限。';
    return;
  }
  if (effects.some((effect) => effect.type === 'summon') && card.type !== 'summon') {
    error.value = '只有召唤类型卡牌才能创建召唤物。';
    return;
  }
  card.effects.push(...effects);
  notice.value = option.description || `已添加「${option.label}」。`;
}

function addBuiltEffect(effect: CardEffect): void {
  const card = activeCard.value;
  if (!card || card.effects.length >= 8) return;
  if (effect.type === 'summon' && card.type !== 'summon') {
    error.value = '只有召唤类型卡牌才能创建召唤物。';
    return;
  }
  if (
    effect.type === 'conditional_group' &&
    card.effects.some((entry) => entry.type === 'conditional_group')
  ) {
    error.value = '每张卡牌最多使用一个条件效果组；请在组内继续添加条件和“则/否则”效果。';
    return;
  }
  error.value = '';
  card.effects.push(cloneData(effect) as EditableEffect);
  if (
    ['workshop_resource_change', 'apply_workshop_status'].includes(
      effect.type,
    ) &&
    typeof effect.mechanismId === 'string' &&
    !editor.value.mechanismIds.includes(effect.mechanismId)
  ) {
    editor.value.mechanismIds.push(effect.mechanismId);
  }
  notice.value = '效果积木已加入卡牌，可继续调整它的参数。';
}

function collectReferencedMechanisms(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferencedMechanisms(entry, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  const source = value as Record<string, unknown>;
  if (
    [
      'workshop_resource_change',
      'spend_workshop_resource',
      'apply_workshop_status',
    ].includes(
      String(source.type ?? ''),
    ) &&
    typeof source.mechanismId === 'string'
  ) {
    result.add(source.mechanismId);
  }
  for (const child of Object.values(source)) {
    if (child && typeof child === 'object') {
      collectReferencedMechanisms(child, result);
    }
  }
  return result;
}

async function validateCard(): Promise<void> {
  const card = activeCard.value;
  if (!card) return;
  error.value = '';
  notice.value = '';
  try {
    const normalized = normalizeWorkshopCard(
      card,
      editor.value.id,
      editor.value.cards.indexOf(card),
    );
    Object.assign(card, normalized);
    notice.value = `卡牌「${normalized.name}」的结构与引用校验通过。`;
    await props.context.api.execute({
      id: makeId('achievement-workshop-card'),
      type: 'achievement.record',
      payload: {
        event: 'workshop.card',
        cardName: normalized.name,
        cardType: normalized.type,
      },
    });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function addDeckCopy(cardId: string): void {
  if (editor.value.starterDeck.length >= 15) return;
  if ((deckCounts.value[cardId] ?? 0) >= (poolCounts.value[cardId] ?? 0)) return;
  editor.value.starterDeck.push(cardId);
}

function removeDeckCopy(cardId: string): void {
  const index = editor.value.starterDeck.lastIndexOf(cardId);
  if (index >= 0) editor.value.starterDeck.splice(index, 1);
}

function addPoolCopy(cardId: string): void {
  if (editor.value.cardPool.length >= 32) return;
  editor.value.cardPool.push(cardId);
}

function removePoolCopy(cardId: string): void {
  if ((poolCounts.value[cardId] ?? 0) <= (deckCounts.value[cardId] ?? 0)) return;
  const index = editor.value.cardPool.lastIndexOf(cardId);
  if (index >= 0) editor.value.cardPool.splice(index, 1);
}

function editSelectedTestProfession(): void {
  const profession = testableProfessions.value.find(
    (entry) => entry.id === testProfessionId.value,
  );
  if (profession) editProfession(profession);
}

async function publishProfession(): Promise<void> {
  error.value = '';
  notice.value = '';
  try {
    editor.value.mechanismIds = [
      ...new Set([
        ...editor.value.mechanismIds,
        ...collectReferencedMechanisms(editor.value.cards),
        ...collectReferencedMechanisms(editor.value.talent.effects),
      ]),
    ];
    if (editor.value.cards.length < 8 || editor.value.cards.length > 16) {
      throw new Error('职业包需要 8–16 种不同名称的可配置卡牌。');
    }
    if (editor.value.cardPool.length < 16 || editor.value.cardPool.length > 32) {
      throw new Error('职业卡池总数需要保持在 16–32 张。');
    }
    if (editor.value.starterDeck.length !== 15) {
      throw new Error('基础卡组构筑必须正好为 15 张。');
    }
    if (
      Object.entries(deckCounts.value).some(
        ([cardId, count]) => count > (poolCounts.value[cardId] ?? 0),
      )
    ) {
      throw new Error('基础构筑使用的卡牌数量不能超过职业卡池中的持有数量。');
    }
    const pack = saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: `${editor.value.name || '未命名'}职业包`,
      author: '玩家自定义',
      classes: [editor.value],
    });
    refreshWorkshopProfessionCatalogs();
    await loadCardCatalog();
    refreshWorkshopCardCatalog();
    refreshWorkshopPassiveCatalog();
    published.value = readWorkshopPacks();
    testProfessionId.value = pack.classes[0]?.id ?? '';
    await props.context.api.execute({
      id: makeId('achievement-workshop-class'),
      type: 'achievement.record',
      payload: { event: 'workshop.class' },
    });
    notice.value = `职业「${pack.classes[0]?.name}」已保存并立即启用，可在新档、转职和可选测试场中选择。`;
    tab.value = 'library';
    emit('saved');
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function removeProfession(profession: WorkshopClass): void {
  if (!window.confirm(`确认删除自定义职业「${profession.name}」？`)) return;
  if (deleteWorkshopClass(profession.id)) {
    refreshWorkshopProfessionCatalogs();
    refreshWorkshopCardCatalog();
    refreshWorkshopPassiveCatalog();
    published.value = readWorkshopPacks();
    emit('saved');
  }
}

function removeExtension(extension: WorkshopExtensionManifest): void {
  if (!window.confirm(`确认删除扩展「${extension.name}」？`)) return;
  if (deleteWorkshopExtension(extension.id)) {
    extensions.value = readWorkshopExtensions();
    notice.value = `扩展「${extension.name}」已删除。`;
  }
}

function refreshPublishedAfterMechanismChange(): void {
  refreshWorkshopProfessionCatalogs();
  refreshWorkshopCardCatalog();
  refreshWorkshopPassiveCatalog();
  published.value = readWorkshopPacks();
}

function removeMechanism(mechanism: WorkshopMechanismManifest): void {
  if (!window.confirm(`确认删除底层机制「${mechanism.name}」？依赖它的职业将无法正常使用。`)) return;
  if (deleteWorkshopMechanism(mechanism.id)) {
    mechanisms.value = readWorkshopMechanisms();
    refreshPublishedAfterMechanismChange();
    notice.value = `底层机制「${mechanism.name}」已删除。`;
  }
}

function saveVisualMechanism(mechanism: WorkshopMechanismManifest): void {
  error.value = '';
  try {
    const saved = saveWorkshopMechanism(mechanism);
    mechanisms.value = readWorkshopMechanisms();
    refreshPublishedAfterMechanismChange();
    notice.value = `自定义${saved.statuses.length ? '状态' : '资源'}「${saved.name}」已保存，可在职业天赋与卡牌中启用。`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function downloadGuide(): Promise<void> {
  error.value = '';
  try {
    const buildId = encodeURIComponent(
      props.context.api.getRuntimeInfo().buildId,
    );
    const response = await (
      props.context.document.defaultView ?? window
    ).fetch(
      `https://jhyshl.github.io/caelian-re-oseas/builds/${buildId}/docs/caelian-workshop-ai-guide.md`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error(`指导手册下载失败：HTTP ${response.status}`);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '凯利安创意工坊-AI制作指导手册.md';
    anchor.click();
    URL.revokeObjectURL(url);
    notice.value = 'AI 制作指导手册已下载。';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function download(value?: unknown): void {
  try {
    const pack = exportWorkshopPack(value);
    const blob = new Blob([JSON.stringify(pack, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${pack.packName || 'caelian-workshop'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function scriptMechanismsFromArtifact(
  raw: Record<string, unknown>,
): WorkshopMechanismManifest[] {
  const candidates =
    raw.format === WORKSHOP_SCRIPT_MECHANISM_FORMAT
      ? [raw]
      : Array.isArray(raw.mechanisms)
        ? raw.mechanisms
        : [];
  return candidates.flatMap((candidate) => {
    try {
      const mechanism = normalizeWorkshopMechanism(candidate);
      return isWorkshopScriptMechanism(mechanism) ? [mechanism] : [];
    } catch {
      return [];
    }
  });
}

async function approveScriptMechanisms(
  raw: Record<string, unknown>,
): Promise<boolean> {
  const scripts = scriptMechanismsFromArtifact(raw);
  if (!scripts.length) return true;
  const accepted = window.confirm(
    `该文件包含 ${scripts.length} 个可执行代码机制：${scripts
      .map((mechanism) => mechanism.name)
      .join('、')}。代码会在隔离战斗沙箱中运行，不会获得页面、存档、变量管理器、网络或浏览器存储权限，但仍可能造成战斗数值异常或短暂卡顿。是否继续校验并安装？`,
  );
  if (!accepted) return false;
  await prepareWorkshopScriptRuntime();
  for (const mechanism of scripts) {
    await validateWorkshopScriptMechanism(mechanism);
  }
  return true;
}

async function importFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = '';
  try {
    const raw = JSON.parse(await file.text()) as Record<string, unknown>;
    if (!(await approveScriptMechanisms(raw))) return;
    if (
      raw.format === WORKSHOP_MECHANISM_FORMAT ||
      raw.format === WORKSHOP_SCRIPT_MECHANISM_FORMAT
    ) {
      const mechanism = saveWorkshopMechanism(raw);
      mechanisms.value = readWorkshopMechanisms();
      refreshPublishedAfterMechanismChange();
      notice.value = isWorkshopScriptMechanism(mechanism)
        ? `代码机制「${mechanism.name}」已通过沙箱校验并导入，可由职业声明依赖。`
        : `底层机制「${mechanism.name}」已导入，包含 ${mechanism.rules.length} 条运行规则。`;
      tab.value = 'extensions';
      return;
    }
    const result = importWorkshopArtifact(raw);
    if (result.kind === 'extension') {
      extensions.value = readWorkshopExtensions();
      notice.value = `扩展「${result.extension.name}」已导入，新增 ${result.extension.presets.length} 个效果预设。`;
      tab.value = 'extensions';
    } else {
      refreshWorkshopProfessionCatalogs();
      await loadCardCatalog();
      refreshWorkshopCardCatalog();
      refreshWorkshopPassiveCatalog();
      published.value = readWorkshopPacks();
      testProfessionId.value = result.pack.classes[0]?.id ?? '';
      notice.value = `职业包「${result.pack.packName}」已通过结构与沙箱校验并立即启用${
        result.pack.mechanisms?.length
          ? `，同时安装 ${result.pack.mechanisms.length} 个底层机制`
          : ''
      }。`;
      mechanisms.value = readWorkshopMechanisms();
      tab.value = 'library';
      emit('saved');
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    (event.target as HTMLInputElement).value = '';
  }
}

async function startWorkshopTest(): Promise<void> {
  error.value = '';
  notice.value = '';
  const profession = testableProfessions.value.find(
    (entry) => entry.id === testProfessionId.value,
  );
  if (!profession) {
    error.value = '请先选择一个已经校验并保存的自制职业。';
    return;
  }
  if (testAttributeSpent.value > maxLevelAttributeBudget) {
    error.value = `满级角色只能分配 ${maxLevelAttributeBudget} 点属性。`;
    return;
  }
  try {
    refreshWorkshopProfessionCatalogs();
    await loadCardCatalog();
    refreshWorkshopCardCatalog();
    refreshWorkshopPassiveCatalog();
    const result = await props.context.api.execute({
      id: commandId('battle.start-workshop-test'),
      type: 'battle.start',
      payload: {
        source: `创意工坊测试场 · ${profession.name}`,
        workshopTest: {
          professionId: profession.id,
          opponentMode: testConfig.value.opponentMode,
          randomTier: testConfig.value.randomTier,
          enemyScale: testConfig.value.enemyScale,
          mechanismIds: [...testMechanismIds.value],
          dummyCount: testConfig.value.dummyCount,
          dummyHp: testConfig.value.dummyHp,
          dummyAttack: testConfig.value.dummyAttack,
          dummyDefense: testConfig.value.dummyDefense,
          dummyInvincible: testConfig.value.dummyInvincible,
          dummyAttackEnabled: testConfig.value.dummyAttackEnabled,
          autoRespawn: testConfig.value.autoRespawn,
          playerInvincible: testConfig.value.playerInvincible,
          attributes: { ...testConfig.value.attributes },
        },
      },
    });
    if (result.status === 'rejected') throw new Error(result.message);
    emit('close');
    await props.context.api.openPanel('battle');
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}
</script>

<template>
  <Teleport :to="context.document.body">
    <div class="workshop-backdrop" @click.self="emit('close')">
      <section
        class="workshop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workshop-title"
      >
        <header class="workshop-header">
          <div>
            <small>CREATIVE WORKSHOP v3.2</small>
            <h2 id="workshop-title">创意工坊</h2>
            <p>支持声明式扩展，也可导入经过隔离和限时校验的代码机制。</p>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <nav class="workshop-tabs">
          <button :class="{ active: tab === 'library' }" @click="tab = 'library'">
            已发布
          </button>
          <button :class="{ active: tab === 'editor' }" @click="tab = 'editor'">
            职业编辑器
          </button>
          <button :class="{ active: tab === 'drafts' }" @click="tab = 'drafts'">
            草稿 {{ drafts.length }}
          </button>
          <button
            :class="{ active: tab === 'extensions' }"
            @click="tab = 'extensions'"
          >
            扩展 {{ extensions.length + mechanisms.length }}
          </button>
          <button :class="{ active: tab === 'test' }" @click="tab = 'test'">
            测试场
          </button>
        </nav>

        <main v-if="tab === 'library'" class="workshop-library">
          <div class="library-actions">
            <button type="button" class="ca-button primary" @click="newProfession">
              + 创建新职业
            </button>
            <button type="button" class="ca-button" @click="importInput?.click()">
              导入职业包 / 扩展
            </button>
            <button type="button" class="ca-button" @click="downloadGuide">
              下载 AI 制作指导手册
            </button>
            <button
              type="button"
              class="ca-button"
              :disabled="published.length === 0"
              @click="download()"
            >
              导出全部
            </button>
            <input
              ref="importInput"
              type="file"
              accept="application/json,.json"
              hidden
              @change="importFile"
            />
          </div>
          <div
            v-if="published.flatMap((pack) => pack.classes).length === 0"
            class="workshop-empty"
          >
            尚未发布自定义职业。创建后会出现在新建档案和转职列表中。
          </div>
          <article
            v-for="profession in published.flatMap((pack) => pack.classes)"
            :key="profession.id"
            class="published-class"
          >
            <div>
              <span>{{ mainClassNames[profession.main] }}</span>
              <h3>{{ profession.name }}</h3>
              <p>{{ profession.description }}</p>
              <small>
                {{ profession.cards.length }} 种卡牌 ·
                {{ profession.cardPool.length }} 张职业卡池 ·
                {{ profession.starterDeck.length }} 张基础构筑 ·
                {{ profession.talent.name }}
              </small>
            </div>
            <div>
              <button type="button" class="ca-button" @click="editProfession(profession)">
                编辑
              </button>
              <button
                type="button"
                class="ca-button"
                @click="download({ classes: [profession] })"
              >
                导出
              </button>
              <button
                type="button"
                class="ca-button danger"
                @click="removeProfession(profession)"
              >
                删除
              </button>
            </div>
          </article>
        </main>

        <main v-else-if="tab === 'extensions'" class="workshop-library">
          <div class="extension-intro">
            <strong>扩展与底层机制</strong>
            <p>
              普通扩展组合受支持的效果；当现有效果无法表达设计时，可导入独立代码机制。
              代码只接收本场战斗快照并返回受控战斗指令，不能读取聊天记录、存档、变量管理器、页面或网络。
            </p>
          </div>
          <WorkshopStateResourceBuilder @save="saveVisualMechanism" />
          <div v-if="extensions.length + mechanisms.length === 0" class="workshop-empty">
            尚未安装扩展。下载指导手册即可查看完整格式、示例和沙箱安全规则。
          </div>
          <article
            v-for="mechanism in mechanisms"
            :key="mechanism.id"
            class="published-class"
          >
            <div>
              <span>
                {{ isWorkshopScriptMechanism(mechanism) ? '代码机制' : '声明式机制' }}
                · {{ mechanism.author || '匿名作者' }}
              </span>
              <h3>{{ mechanism.name }}</h3>
              <p>{{ mechanism.description || '未填写机制说明' }}</p>
              <small>
                {{ mechanism.statuses.length }} 个状态 ·
                {{ mechanism.resources.length }} 个资源 ·
                <template v-if="isWorkshopScriptMechanism(mechanism)">
                  {{ mechanism.triggers?.length ?? 0 }} 个触发器 · 沙箱执行
                </template>
                <template v-else>{{ mechanism.rules.length }} 条规则</template>
                · {{ mechanism.id }}
              </small>
            </div>
            <div>
              <button
                type="button"
                class="ca-button danger"
                @click="removeMechanism(mechanism)"
              >
                删除
              </button>
            </div>
          </article>
          <article
            v-for="extension in extensions"
            :key="extension.id"
            class="published-class"
          >
            <div>
              <span>{{ extension.author || '匿名作者' }}</span>
              <h3>{{ extension.name }}</h3>
              <p>{{ extension.description || '未填写扩展说明' }}</p>
              <small>{{ extension.presets.length }} 个效果预设 · {{ extension.id }}</small>
            </div>
            <div>
              <button
                type="button"
                class="ca-button danger"
                @click="removeExtension(extension)"
              >
                删除
              </button>
            </div>
          </article>
        </main>

        <main v-else-if="tab === 'test'" class="workshop-test">
          <section class="test-intro">
            <div>
              <strong>隔离式实战测试场</strong>
              <p>可选择木桩、随机单怪或随机怪群。全部使用临时 Lv.100 角色，不消耗正式背包、不发奖励、不推进任务，也不改写角色属性。</p>
            </div>
            <output :class="{ over: testAttributeSpent > maxLevelAttributeBudget }">
              属性 {{ testAttributeSpent }} / {{ maxLevelAttributeBudget }}
            </output>
          </section>

          <section class="test-grid">
            <label class="wide">
              <span>测试职业</span>
              <select v-model="testProfessionId">
                <option value="">请选择已经保存的自制职业</option>
                <option
                  v-for="profession in testableProfessions"
                  :key="profession.id"
                  :value="profession.id"
                >
                  {{ profession.name }} · {{ profession.cardPool.length }} 张职业卡池
                </option>
              </select>
            </label>
            <label>
              <span>对手类型</span>
              <select v-model="testConfig.opponentMode">
                <option value="dummy">训练木桩</option>
                <option value="random-single">随机单个怪物</option>
                <option value="random-multi">随机多个怪物</option>
              </select>
            </label>
            <label v-if="testConfig.opponentMode !== 'dummy'">
              <span>怪物难度池</span>
              <select v-model="testConfig.randomTier">
                <option value="mixed">低、高难度混合</option>
                <option value="low">低难度（简单 / 普通）</option>
                <option value="high">高难度（困难 / 噩梦）</option>
              </select>
            </label>
            <label v-if="testConfig.opponentMode !== 'random-single'">
              <span>{{ testConfig.opponentMode === 'dummy' ? '木桩数量' : '怪物数量' }}</span>
              <input v-model.number="testConfig.dummyCount" type="number" :min="testConfig.opponentMode === 'dummy' ? 1 : 2" :max="testConfig.opponentMode === 'dummy' ? 8 : 5" />
            </label>
            <label v-if="testConfig.opponentMode !== 'dummy'"><span>敌方属性倍率</span><input v-model.number="testConfig.enemyScale" type="number" min="0.5" max="2.5" step="0.05" /></label>
            <template v-if="testConfig.opponentMode === 'dummy'">
              <label><span>每个木桩生命</span><input v-model.number="testConfig.dummyHp" type="number" min="1" max="1000000" /></label>
              <label><span>木桩攻击</span><input v-model.number="testConfig.dummyAttack" type="number" min="0" max="100000" /></label>
              <label><span>木桩防御</span><input v-model.number="testConfig.dummyDefense" type="number" min="0" max="100000" /></label>
            </template>
          </section>

          <fieldset class="test-toggles">
            <legend>战斗行为</legend>
            <template v-if="testConfig.opponentMode === 'dummy'">
              <label><input v-model="testConfig.dummyInvincible" type="checkbox" /><span>木桩无敌（最低保留 1 HP）</span></label>
              <label><input v-model="testConfig.dummyAttackEnabled" type="checkbox" /><span>木桩会主动攻击</span></label>
              <label><input v-model="testConfig.autoRespawn" type="checkbox" :disabled="testConfig.dummyInvincible" /><span>木桩死亡后自动满血复活</span></label>
            </template>
            <label><input v-model="testConfig.playerInvincible" type="checkbox" /><span>测试玩家无敌（最低保留 1 HP）</span></label>
          </fieldset>

          <fieldset v-if="mechanisms.length" class="test-toggles">
            <legend>额外加载机制</legend>
            <label v-for="mechanism in mechanisms" :key="mechanism.id">
              <input v-model="testMechanismIds" type="checkbox" :value="mechanism.id" />
              <span>{{ mechanism.name }}</span>
            </label>
          </fieldset>

          <section class="test-attributes">
            <header>
              <strong>Lv.100 属性点配置</strong>
              <small>生命/魔力每点 +5；攻击、防御、速度每点 +1；吸血每 2 点属性换 1%，最高 30%；行动点前 6 次各耗 2 点，之后各耗 3 点。</small>
            </header>
            <label><span>生命投入</span><input v-model.number="testConfig.attributes.hpMax" type="number" min="0" :max="maxLevelAttributeBudget" /></label>
            <label><span>魔力投入</span><input v-model.number="testConfig.attributes.mpMax" type="number" min="0" :max="maxLevelAttributeBudget" /></label>
            <label><span>攻击投入</span><input v-model.number="testConfig.attributes.attack" type="number" min="0" :max="maxLevelAttributeBudget" /></label>
            <label><span>防御投入</span><input v-model.number="testConfig.attributes.defense" type="number" min="0" :max="maxLevelAttributeBudget" /></label>
            <label><span>速度投入</span><input v-model.number="testConfig.attributes.speed" type="number" min="0" :max="maxLevelAttributeBudget" /></label>
            <label><span>吸血（%）</span><input v-model.number="testConfig.attributes.lifesteal" type="number" min="0" :max="LIFESTEAL_CAP" /></label>
            <label><span>行动点提升次数</span><input v-model.number="testConfig.attributes.actionPointsPerTurn" type="number" min="0" max="100" /></label>
          </section>

          <footer class="test-actions">
            <span>测试场完全可选；保存职业后即可直接使用，无需先完成模拟测试。</span>
            <button
              type="button"
              class="ca-button"
              :disabled="!testProfessionId"
              @click="editSelectedTestProfession"
            >
              载入编辑器
            </button>
            <button
              type="button"
              class="ca-button primary"
              :disabled="!testProfessionId || testAttributeSpent > maxLevelAttributeBudget"
              @click="startWorkshopTest"
            >
              进入测试战斗
            </button>
          </footer>
        </main>

        <main v-else-if="tab === 'drafts'" class="draft-list">
          <div v-if="drafts.length === 0" class="workshop-empty">
            编辑职业时会自动保存草稿，最多保留 40 份。
          </div>
          <button
            v-for="draft in drafts"
            :key="draft.id"
            type="button"
            @click="loadDraft(draft)"
          >
            <strong>{{ draft.value.name || '未命名职业' }}</strong>
            <span>{{ new Date(draft.updatedAt).toLocaleString('zh-CN') }}</span>
          </button>
        </main>

        <main v-else class="workshop-editor">
          <section class="editor-section">
            <header>
              <span>01</span>
              <div>
                <h3>职业与天赋</h3>
                <p>选择职业大类，设置名称、说明与最多 4 条天赋效果。</p>
              </div>
            </header>
            <div class="form-grid">
              <label>
                <span>职业大类</span>
                <select v-model="editor.main">
                  <option
                    v-for="main in WORKSHOP_MAIN_CLASSES"
                    :key="main"
                    :value="main"
                  >
                    {{ mainClassNames[main] }}
                  </option>
                </select>
              </label>
              <label>
                <span>职业名称</span>
                <input v-model="editor.name" maxlength="18" />
              </label>
              <label class="wide">
                <span>职业说明</span>
                <textarea v-model="editor.description" maxlength="120"></textarea>
              </label>
              <label>
                <span>天赋名称</span>
                <input v-model="editor.talent.name" maxlength="18" />
              </label>
              <label class="wide">
                <span>天赋说明</span>
                <textarea
                  v-model="editor.talent.description"
                  maxlength="100"
                ></textarea>
              </label>
              <fieldset v-if="mechanisms.length" class="wide mechanism-links">
                <legend>启用天赋 / 自定义状态与资源</legend>
                <label v-for="mechanism in mechanisms" :key="mechanism.id">
                  <input
                    v-model="editor.mechanismIds"
                    type="checkbox"
                    :value="mechanism.id"
                  />
                  <span>{{ mechanism.name }}</span>
                </label>
              </fieldset>
            </div>
            <div class="talent-effects">
              <div
                v-for="(effect, index) in editor.talent.effects"
                :key="`${effect.type}:${index}`"
                :class="{
                  'custom-talent': [
                    'apply_workshop_status',
                    'workshop_resource_change',
                  ].includes(effect.type),
                }"
              >
                <strong>
                  {{
                    WORKSHOP_TALENT_OPTIONS.find(
                      (option) => option[0] === effect.type,
                    )?.[1]
                  }}
                </strong>
                <template v-if="effect.type === 'apply_workshop_status'">
                  <label>
                    <span>自定义状态</span>
                    <select
                      :value="
                        talentDefinitionValue(
                          effect.mechanismId,
                          effect.statusId,
                        )
                      "
                      @change="
                        setTalentDefinition(
                          effect,
                          'status',
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option
                        v-for="option in workshopStatusOptions"
                        :key="`${option.mechanismId}:${option.statusId}`"
                        :value="
                          talentDefinitionValue(
                            option.mechanismId,
                            option.statusId,
                          )
                        "
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>施加目标</span>
                    <select v-model="effect.target">
                      <option value="self">自身</option>
                      <option value="all_enemies">全体敌人</option>
                      <option value="all_summons">全体召唤物</option>
                    </select>
                  </label>
                  <label>
                    <span>层数</span>
                    <input
                      v-model.number="effect.value"
                      type="number"
                      min="1"
                      step="1"
                    />
                  </label>
                  <label>
                    <span>持续回合（-1 = 整场）</span>
                    <input
                      v-model.number="effect.turns"
                      type="number"
                      min="-1"
                      max="99"
                      step="1"
                    />
                  </label>
                </template>
                <template v-else-if="effect.type === 'workshop_resource_change'">
                  <label>
                    <span>自定义资源</span>
                    <select
                      :value="
                        talentDefinitionValue(
                          effect.mechanismId,
                          effect.resourceId,
                        )
                      "
                      @change="
                        setTalentDefinition(
                          effect,
                          'resource',
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option
                        v-for="option in workshopResourceOptions"
                        :key="`${option.mechanismId}:${option.resourceId}`"
                        :value="
                          talentDefinitionValue(
                            option.mechanismId,
                            option.resourceId,
                          )
                        "
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>触发时机</span>
                    <select v-model="effect.trigger">
                      <option value="battle_start">战斗开始</option>
                      <option value="turn_start">每回合开始</option>
                    </select>
                  </label>
                  <label>
                    <span>变动方式</span>
                    <select v-model="effect.mode">
                      <option value="add">增加 / 减少</option>
                      <option value="set">设为指定值</option>
                    </select>
                  </label>
                  <label>
                    <span>数值（可为负数）</span>
                    <input
                      v-model.number="effect.value"
                      type="number"
                      min="-999999"
                      max="999999"
                      step="1"
                    />
                  </label>
                </template>
                <input
                  v-else-if="
                    ![
                      'always_reveal_intent',
                      'defense_reflect',
                      'counterattack',
                      'apply_workshop_status',
                      'workshop_resource_change',
                    ].includes(effect.type)
                  "
                  v-model.number="effect.value"
                  type="number"
                  min="0"
                  step="0.1"
                />
                <button
                  type="button"
                  @click="editor.talent.effects.splice(index, 1)"
                >
                  ×
                </button>
              </div>
              <select
                value=""
                :disabled="editor.talent.effects.length >= 4"
                @change="
                  addTalent(($event.target as HTMLSelectElement).value);
                  ($event.target as HTMLSelectElement).value = '';
                "
              >
                <option value="" disabled>+ 添加天赋效果</option>
                <option
                  v-for="[type, label] in WORKSHOP_TALENT_OPTIONS"
                  :key="type"
                  :value="type"
                  :disabled="talentOptionDisabled(type)"
                >
                  {{ label }}
                </option>
              </select>
            </div>
          </section>

          <section class="editor-section">
            <header>
              <span>02</span>
              <div>
                <h3>自定义卡牌</h3>
                <p>自由设置卡牌数值与稀有度；保存时只检查数据结构、机制引用和运行安全。</p>
              </div>
              <button
                type="button"
                class="ca-button primary"
                :disabled="editor.cards.length >= 16"
                @click="addCard"
              >
                + 新卡牌
              </button>
            </header>
            <div class="card-workspace">
              <aside>
                <button
                  v-for="card in editor.cards"
                  :key="card.id"
                  type="button"
                  :class="{ active: activeCardId === card.id }"
                  @click="activeCardId = card.id"
                >
                  <strong>{{ card.name || '未命名卡牌' }}</strong>
                  <span>{{ typeNames[card.type] }} · AP {{ card.cost }}</span>
                </button>
              </aside>
              <div v-if="activeCard" class="card-editor">
                <div class="form-grid">
                  <label>
                    <span>卡牌名称</span>
                    <input v-model="activeCard.name" maxlength="20" />
                  </label>
                  <label>
                    <span>卡牌类型</span>
                    <select v-model="activeCard.type">
                      <option value="attack">攻击</option>
                      <option value="defense">防御</option>
                      <option value="skill">技能</option>
                      <option value="summon">召唤</option>
                    </select>
                  </label>
                  <label>
                    <span>AP 费用</span>
                    <input
                      v-model.number="activeCard.cost"
                      type="number"
                      min="0"
                    />
                  </label>
                  <label>
                    <span>稀有度（自选）</span>
                    <select v-model="activeCard.rarity">
                      <option value="common">普通</option>
                      <option value="uncommon">优秀</option>
                      <option value="rare">稀有</option>
                      <option value="epic">史诗</option>
                      <option value="legendary">传说</option>
                    </select>
                  </label>
                  <label class="wide">
                    <span>卡牌说明</span>
                    <textarea
                      v-model="activeCard.description"
                      maxlength="90"
                    ></textarea>
                  </label>
                  <label class="wide">
                    <span>机制标签（逗号分隔）</span>
                    <input
                      :value="activeCard.tags.join(', ')"
                      maxlength="160"
                      placeholder="例如：近战, melee, weapon；支持自定义中英文标签"
                      @change="
                        setCardTags(
                          activeCard,
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    />
                    <small>代码机制可读取这些标签；每张牌最多 12 个。</small>
                  </label>
                </div>
                <WorkshopEffectEditor
                  v-for="(effect, index) in activeCard.effects"
                  :key="`${effect.type}:${index}`"
                  :effect="effect"
                  :resource-options="workshopResourceOptions"
                  :status-options="workshopStatusOptions"
                  @remove="activeCard.effects.splice(index, 1)"
                />
                <WorkshopEffectPalette
                  :card-type="activeCard.type"
                  :disabled="activeCard.effects.length >= 8"
                  :resource-options="workshopResourceOptions"
                  :status-options="workshopStatusOptions"
                  @add="addBuiltEffect"
                />
                <select
                  v-if="effectOptions.length"
                  class="effect-picker"
                  value=""
                  :disabled="activeCard.effects.length >= 8"
                  @change="
                    addEffect(($event.target as HTMLSelectElement).value);
                    ($event.target as HTMLSelectElement).value = '';
                  "
                >
                  <option value="" disabled>+ 添加已安装的扩展预设</option>
                  <option
                    v-for="option in effectOptions"
                    :key="option.id"
                    :value="option.id"
                    :disabled="
                      !supportsCardType(option, activeCard.type)
                    "
                  >
                    {{ option.label }}
                  </option>
                </select>
                <footer>
                  <button
                    type="button"
                    class="ca-button danger"
                    @click="deleteCard(activeCard.id)"
                  >
                    删除卡牌
                  </button>
                  <button
                    type="button"
                    class="ca-button primary"
                    @click="validateCard"
                  >
                    校验并保存卡牌
                  </button>
                </footer>
              </div>
              <div v-else class="workshop-empty">
                创建或选择一张卡牌后开始编辑。
              </div>
            </div>
          </section>

          <section class="editor-section">
            <header>
              <span>03</span>
              <div>
                <h3>职业卡池与基础构筑</h3>
                <p>8–16 种不同名卡牌组成 16–32 张职业卡池，再从中配置正好 15 张基础构筑；同名卡数量仅受职业卡池持有量约束。</p>
              </div>
              <div class="pool-summary">
                <output :class="{ over: editor.cards.length < 8 || editor.cards.length > 16 }">
                  卡种 {{ editor.cards.length }} / 8–16
                </output>
                <output :class="{ over: editor.cardPool.length < 16 || editor.cardPool.length > 32 }">
                  卡池 {{ editor.cardPool.length }} / 16–32
                </output>
                <output :class="{ over: editor.starterDeck.length !== 15 }">
                  基础构筑 {{ editor.starterDeck.length }} / 15
                </output>
              </div>
            </header>
            <div class="deck-builder">
              <article v-for="card in editor.cards" :key="card.id">
                <div>
                  <strong>{{ card.name }}</strong>
                  <span>{{ typeNames[card.type] }} · AP {{ card.cost }}</span>
                </div>
                <div class="pool-controls">
                  <small>职业卡池</small>
                  <button
                    type="button"
                    :disabled="(poolCounts[card.id] ?? 0) <= (deckCounts[card.id] ?? 0)"
                    @click="removePoolCopy(card.id)"
                  >
                    −
                  </button>
                  <b>{{ poolCounts[card.id] ?? 0 }}</b>
                  <button
                    type="button"
                    :disabled="editor.cardPool.length >= 32"
                    @click="addPoolCopy(card.id)"
                  >
                    +
                  </button>
                </div>
                <div class="pool-controls">
                  <small>基础构筑</small>
                  <button
                    type="button"
                    :disabled="(deckCounts[card.id] ?? 0) === 0"
                    @click="removeDeckCopy(card.id)"
                  >
                    −
                  </button>
                  <b>{{ deckCounts[card.id] ?? 0 }}</b>
                  <button
                    type="button"
                    :disabled="
                      (deckCounts[card.id] ?? 0) >= (poolCounts[card.id] ?? 0) ||
                        editor.starterDeck.length >= 15
                    "
                    @click="addDeckCopy(card.id)"
                  >
                    +
                  </button>
                </div>
              </article>
            </div>
          </section>

          <footer class="publish-actions">
            <span>草稿会自动保存在此浏览器中。</span>
            <button type="button" class="ca-button" @click="tab = 'library'">
              返回
            </button>
            <button
              type="button"
              class="ca-button primary"
              @click="publishProfession"
            >
              保存并立即启用
            </button>
          </footer>
        </main>

        <p v-if="notice" class="workshop-notice">{{ notice }}</p>
        <p v-if="error" class="workshop-error">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.workshop-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483645;
  display: grid;
  place-items: center;
  padding: 14px;
  background: rgba(5, 5, 4, 0.82);
  backdrop-filter: blur(8px);
}

.workshop-dialog {
  width: min(1040px, 100%);
  max-height: calc(100vh - 28px);
  overflow: auto;
  border: 1px solid rgba(212, 168, 67, 0.35);
  border-radius: 20px;
  color: var(--ca-text, #e7ddcd);
  background:
    radial-gradient(circle at 20% 0, rgba(212, 168, 67, 0.1), transparent 28%),
    #15120e;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.65);
}

.workshop-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 17px 20px;
  border-bottom: 1px solid rgba(212, 168, 67, 0.16);
  background: rgba(21, 18, 14, 0.95);
  backdrop-filter: blur(10px);
}

.workshop-header small {
  color: var(--ca-gold, #d4a843);
  font-size: 9px;
  letter-spacing: 0.18em;
}

.workshop-header h2 {
  margin: 2px 0;
  color: var(--ca-text-bright, #fff9eb);
  font: 700 23px/1.1 var(--ca-serif, Georgia, serif);
}

.workshop-header p {
  margin: 0;
  color: var(--ca-muted, #a99d8c);
  font-size: 10px;
}

.workshop-header > button {
  width: 34px;
  height: 34px;
  border: 1px solid var(--ca-border, #3d3327);
  border-radius: 50%;
  color: #d6c7b2;
  background: transparent;
  font-size: 22px;
  cursor: pointer;
}

.workshop-tabs {
  display: flex;
  gap: 5px;
  padding: 11px 20px 0;
}

.workshop-tabs button {
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: 9px 9px 0 0;
  color: var(--ca-muted);
  background: transparent;
  font: 700 11px var(--ca-ui);
  cursor: pointer;
}

.workshop-tabs button.active {
  border-color: rgba(212, 168, 67, 0.22);
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.08);
}

.workshop-library,
.workshop-editor,
.draft-list {
  display: grid;
  gap: 12px;
  padding: 15px 20px 20px;
}

.library-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.extension-intro {
  padding: 13px 14px;
  border: 1px solid rgba(212, 168, 67, 0.28);
  border-radius: 12px;
  background: rgba(212, 168, 67, 0.06);
}

.extension-intro strong {
  color: var(--ca-gold-light);
  font-size: 12px;
}

.extension-intro p {
  margin: 5px 0 0;
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.6;
}

.published-class {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--ca-border);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.022);
}

.published-class > div:first-child {
  min-width: 0;
}

.published-class h3 {
  margin: 2px 0 4px;
  color: var(--ca-text-bright);
  font: 700 17px var(--ca-serif);
}

.published-class p,
.published-class small,
.published-class > div:first-child > span {
  margin: 0;
  color: var(--ca-muted);
  font-size: 10px;
}

.published-class > div:last-child {
  display: flex;
  gap: 6px;
}

.workshop-empty {
  padding: 30px 14px;
  border: 1px dashed var(--ca-border);
  border-radius: 12px;
  color: var(--ca-muted);
  font-size: 11px;
  text-align: center;
}

.draft-list > button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 11px;
  border: 1px solid var(--ca-border);
  border-radius: 9px;
  color: var(--ca-text);
  background: rgba(255, 255, 255, 0.025);
  cursor: pointer;
}

.draft-list span {
  color: var(--ca-muted);
  font-size: 9px;
}

.editor-section {
  padding: 14px;
  border: 1px solid rgba(212, 168, 67, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.018);
}

.editor-section > header {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 13px;
}

.editor-section > header > span {
  width: 34px;
  height: 34px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.1);
  font-weight: 800;
}

.editor-section > header > div {
  min-width: 0;
  flex: 1;
}

.editor-section h3 {
  margin: 0;
  color: var(--ca-text-bright);
  font: 700 15px var(--ca-serif);
}

.editor-section header p {
  margin: 2px 0 0;
  color: var(--ca-muted);
  font-size: 9px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.form-grid label {
  display: grid;
  gap: 5px;
  color: var(--ca-muted);
  font-size: 9px;
}

.mechanism-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 10px 12px 12px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
}

.mechanism-links legend {
  padding: 0 6px;
  color: var(--ca-gold);
  font-size: 9px;
}

.mechanism-links label {
  display: flex;
  align-items: center;
  grid-template-columns: none;
  gap: 6px;
}

.mechanism-links input {
  width: auto;
}

.form-grid label.wide {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid select,
.form-grid textarea,
.talent-effects input,
.talent-effects select,
.effect-picker {
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-text);
  background: #1b1712;
  font: inherit;
}

.form-grid textarea {
  min-height: 60px;
  resize: vertical;
}

output {
  padding: 8px 9px;
  border: 1px solid rgba(94, 180, 126, 0.35);
  border-radius: 8px;
  color: #91d2a8;
  background: rgba(94, 180, 126, 0.06);
  font-size: 11px;
}

output.over {
  border-color: rgba(218, 94, 84, 0.45);
  color: #e4a09a;
  background: rgba(218, 94, 84, 0.07);
}

.talent-effects {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 10px;
}

.talent-effects > div {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
}

.talent-effects > div.custom-talent {
  grid-column: 1 / -1;
  flex-wrap: wrap;
  align-items: end;
}

.custom-talent > strong {
  flex-basis: 100%;
}

.custom-talent label {
  display: grid;
  min-width: 120px;
  flex: 1 1 140px;
  gap: 3px;
}

.custom-talent label > span {
  color: var(--ca-muted);
  font-size: 8px;
}

.talent-effects .custom-talent input,
.talent-effects .custom-talent select {
  width: 100%;
}

.talent-effects strong {
  min-width: 0;
  flex: 1;
  color: var(--ca-text);
  font-size: 10px;
}

.talent-effects input {
  width: 64px;
}

.talent-effects button {
  border: 0;
  color: #d99b91;
  background: transparent;
  cursor: pointer;
}

.card-workspace {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 10px;
}

.card-workspace > aside {
  display: grid;
  align-content: start;
  gap: 5px;
  max-height: 650px;
  overflow: auto;
}

.card-workspace > aside button {
  display: grid;
  gap: 3px;
  padding: 9px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.card-workspace > aside button.active {
  border-color: var(--ca-gold);
  background: rgba(212, 168, 67, 0.08);
}

.card-workspace aside span {
  color: var(--ca-muted);
  font-size: 9px;
}

.card-editor {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.effect-picker {
  width: 100%;
  border-style: dashed;
  color: var(--ca-gold-light);
}

.card-editor > footer,
.publish-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
}

.card-editor > footer {
  justify-content: space-between;
}

.deck-builder {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.deck-builder article {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
}

.deck-builder article > div:first-child {
  display: grid;
  min-width: 0;
  flex: 1;
}

.pool-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.pool-summary output {
  padding: 5px 7px;
  font-size: 9px;
}

.pool-controls {
  display: grid;
  grid-template-columns: auto 25px 18px 25px;
  align-items: center;
  gap: 4px;
}

.pool-controls small {
  color: var(--ca-muted);
  font-size: 8px;
}

.deck-builder strong {
  color: var(--ca-text);
  font-size: 10px;
}

.deck-builder span {
  color: var(--ca-muted);
  font-size: 8px;
}

.deck-builder button {
  width: 25px;
  height: 25px;
  border: 1px solid var(--ca-border);
  border-radius: 6px;
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.06);
  cursor: pointer;
}

.deck-builder b {
  min-width: 14px;
  color: var(--ca-text-bright);
  text-align: center;
}

.publish-actions > span {
  flex: 1;
  color: var(--ca-muted);
  font-size: 9px;
}

.workshop-test {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.test-intro,
.test-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px;
  border: 1px solid rgba(212, 168, 67, 0.28);
  border-radius: 11px;
  background: rgba(212, 168, 67, 0.055);
}

.test-intro strong,
.test-attributes strong {
  color: var(--ca-gold-light);
  font-size: 12px;
}

.test-intro p,
.test-actions span {
  margin: 4px 0 0;
  color: var(--ca-muted);
  font-size: 9px;
  line-height: 1.55;
}

.test-grid,
.test-attributes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  padding: 13px;
  border: 1px solid var(--ca-border);
  border-radius: 11px;
}

.test-grid label,
.test-attributes label {
  display: grid;
  gap: 5px;
  color: var(--ca-muted);
  font-size: 9px;
}

.test-grid .wide,
.test-attributes header {
  grid-column: 1 / -1;
}

.test-attributes header {
  display: grid;
  gap: 3px;
}

.test-attributes header small {
  color: var(--ca-muted);
  font-size: 8px;
}

.test-grid input,
.test-grid select,
.test-attributes input {
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-text);
  background: #1b1712;
  font: inherit;
}

.test-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 11px 13px;
  border: 1px solid var(--ca-border);
  border-radius: 11px;
}

.test-toggles legend {
  padding: 0 6px;
  color: var(--ca-gold);
  font-size: 9px;
}

.test-toggles label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ca-muted);
  font-size: 9px;
}

.workshop-notice,
.workshop-error {
  position: sticky;
  bottom: 0;
  z-index: 5;
  margin: 0;
  padding: 9px 20px;
  background: rgba(21, 18, 14, 0.96);
  font-size: 10px;
  text-align: center;
}

.workshop-notice {
  color: #91d2a8;
}

.workshop-error {
  color: #e4a09a;
}

.ca-button.danger {
  color: #e4a09a;
}

@media (max-width: 700px) {
  .card-workspace {
    grid-template-columns: 1fr;
  }

  .card-workspace > aside {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 180px;
  }
}

@media (max-width: 560px) {
  .workshop-backdrop {
    padding: 0;
  }

  .workshop-dialog {
    max-height: 100vh;
    border-radius: 0;
  }

  .workshop-header,
  .workshop-library,
  .workshop-editor,
  .workshop-test,
  .draft-list {
    padding-right: 12px;
    padding-left: 12px;
  }

  .published-class,
  .editor-section > header {
    align-items: stretch;
    flex-direction: column;
  }

  .published-class > div:last-child {
    flex-wrap: wrap;
  }

  .talent-effects,
  .deck-builder,
  .test-grid,
  .test-attributes {
    grid-template-columns: 1fr;
  }

  .publish-actions,
  .test-intro,
  .test-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .deck-builder article {
    flex-wrap: wrap;
  }

  .deck-builder article > div:first-child {
    flex-basis: 100%;
  }
}
</style>
