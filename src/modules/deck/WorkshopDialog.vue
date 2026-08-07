<script setup lang="ts">
/* global Blob, Event, HTMLInputElement, URL, clearTimeout, document, setTimeout, structuredClone, window */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { refreshWorkshopPassiveCatalog } from '@/content/catalogs/battle';
import {
  loadCardCatalog,
  refreshWorkshopCardCatalog,
} from '@/content/catalogs/cards';
import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import type { CardEffect } from '@/content/types';
import type { PanelContext } from '@/kernel/public-api';
import WorkshopEffectEditor from '@/modules/deck/WorkshopEffectEditor.vue';
import {
  WORKSHOP_MECHANISM_FORMAT,
  deleteWorkshopMechanism,
  readWorkshopMechanisms,
  saveWorkshopMechanism,
  type WorkshopMechanismManifest,
} from '@/workshop-mechanisms';
import {
  WORKSHOP_EFFECT_OPTIONS,
  WORKSHOP_MAIN_CLASSES,
  WORKSHOP_TALENT_OPTIONS,
  cardLimit,
  cardScore,
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
  talentScore,
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
  description: string;
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
  starterDeck: string[];
  mechanismIds: string[];
}

const props = defineProps<{ context: PanelContext }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const tab = ref<'library' | 'editor' | 'drafts' | 'extensions'>('library');
const published = ref(readWorkshopPacks());
const drafts = ref(readWorkshopDrafts());
const extensions = ref(readWorkshopExtensions());
const mechanisms = ref(readWorkshopMechanisms());
const editor = ref<EditableClass>(createEditor());
const activeCardId = ref('');
const notice = ref('');
const error = ref('');
const importInput = ref<HTMLInputElement>();
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
const workshopCardTypes = ['attack', 'defense', 'skill', 'summon'] as const;
const activeCard = computed(() =>
  editor.value.cards.find((card) => card.id === activeCardId.value),
);
const deckCounts = computed(() =>
  editor.value.starterDeck.reduce<Record<string, number>>((result, id) => {
    result[id] = (result[id] ?? 0) + 1;
    return result;
  }, {}),
);
const talentPower = computed(() =>
  talentScore(editor.value.talent.effects),
);
const activeCardPower = computed(() =>
  activeCard.value ? Math.round(cardScore(activeCard.value)) : 0,
);
const activeCardLimit = computed(() =>
  activeCard.value ? cardLimit(activeCard.value.cost) : 0,
);
const effectOptions = computed(() => [
  ...WORKSHOP_EFFECT_OPTIONS.map((option) => ({
    id: `builtin:${option.type}`,
    label: option.label,
    description: '内置效果',
    cardTypes: [...workshopCardTypes],
    effects: [option],
  })),
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

function supportsCardType(
  option: { cardTypes: readonly string[] },
  cardType: string,
): boolean {
  return option.cardTypes.includes(cardType);
}

watch(
  editor,
  () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      saveWorkshopDraft({
        id: editor.value.id,
        updatedAt: Date.now(),
        value: structuredClone(editor.value) as unknown as Partial<WorkshopClass>,
      });
      drafts.value = readWorkshopDrafts();
    }, 400);
  },
  { deep: true },
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
    starterDeck: [],
    mechanismIds: [],
  };
}

function editableFromClass(profession: WorkshopClass): EditableClass {
  return structuredClone(profession) as unknown as EditableClass;
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
  editor.value = structuredClone(draft.value) as unknown as EditableClass;
  activeCardId.value = editor.value.cards?.[0]?.id ?? '';
  tab.value = 'editor';
}

function addTalent(type: string): void {
  if (editor.value.talent.effects.length >= 4) return;
  if (editor.value.talent.effects.some((effect) => effect.type === type)) {
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
  };
  const effect: EditableEffect = { type };
  if (type !== 'always_reveal_intent') effect.value = defaults[type] ?? 1;
  editor.value.talent.effects.push(effect);
}

function addCard(): void {
  const id = makeId(`custom_card_${editor.value.id}`);
  editor.value.cards.push({
    id,
    name: `自定义卡牌${editor.value.cards.length + 1}`,
    type: 'skill',
    cost: 1,
    description: '',
    effects: [],
  });
  activeCardId.value = id;
}

function deleteCard(cardId: string): void {
  editor.value.cards = editor.value.cards.filter((card) => card.id !== cardId);
  editor.value.starterDeck = editor.value.starterDeck.filter(
    (id) => id !== cardId,
  );
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
    const effect = structuredClone(entry) as EditableEffect;
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
    notice.value = `卡牌已通过旧版强度校验：${normalized.powerScore}/${cardLimit(normalized.cost)}，稀有度自动判定为 ${normalized.rarity}。`;
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
  if (editor.value.starterDeck.length >= 20) return;
  if ((deckCounts.value[cardId] ?? 0) >= 3) return;
  editor.value.starterDeck.push(cardId);
}

function removeDeckCopy(cardId: string): void {
  const index = editor.value.starterDeck.lastIndexOf(cardId);
  if (index >= 0) editor.value.starterDeck.splice(index, 1);
}

async function publishProfession(): Promise<void> {
  error.value = '';
  notice.value = '';
  try {
    if (editor.value.starterDeck.length < 10) {
      throw new Error('预设牌组至少需要 10 张卡牌。');
    }
    if (editor.value.starterDeck.length > 20) {
      throw new Error('预设牌组最多只能有 20 张卡牌。');
    }
    if (Object.values(deckCounts.value).some((count) => count > 3)) {
      throw new Error('同一张自定义卡牌最多放入预设牌组 3 张。');
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
    await props.context.api.execute({
      id: makeId('achievement-workshop-class'),
      type: 'achievement.record',
      payload: { event: 'workshop.class' },
    });
    notice.value = `职业「${pack.classes[0]?.name}」已发布到本地创意工坊，可在新档与转职中选择。`;
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

function removeMechanism(mechanism: WorkshopMechanismManifest): void {
  if (!window.confirm(`确认删除底层机制「${mechanism.name}」？依赖它的职业将无法正常使用。`)) return;
  if (deleteWorkshopMechanism(mechanism.id)) {
    mechanisms.value = readWorkshopMechanisms();
    notice.value = `底层机制「${mechanism.name}」已删除。`;
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

async function importFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = '';
  try {
    const raw = JSON.parse(await file.text()) as Record<string, unknown>;
    if (raw.format === WORKSHOP_MECHANISM_FORMAT) {
      const mechanism = saveWorkshopMechanism(raw);
      mechanisms.value = readWorkshopMechanisms();
      notice.value = `底层机制「${mechanism.name}」已导入，包含 ${mechanism.rules.length} 条运行规则。`;
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
      notice.value = `职业包「${result.pack.packName}」已通过安全校验并导入。`;
      emit('saved');
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    (event.target as HTMLInputElement).value = '';
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
            <small>CREATIVE WORKSHOP v3.0</small>
            <h2 id="workshop-title">创意工坊</h2>
            <p>只保存职业与卡牌数据模板，不执行任何自定义脚本。</p>
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
                {{ profession.starterDeck.length }} 张预设牌组 ·
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
            <strong>声明式扩展接口</strong>
            <p>
              扩展只能组合受支持的战斗效果，不执行脚本，也不能读取聊天记录或玩家存档。
              可将指导手册交给 AI 生成职业包或效果扩展，再从这里导入。
            </p>
          </div>
          <div v-if="extensions.length + mechanisms.length === 0" class="workshop-empty">
            尚未安装扩展。下载指导手册即可查看完整格式、示例和强度限制。
          </div>
          <article
            v-for="mechanism in mechanisms"
            :key="mechanism.id"
            class="published-class"
          >
            <div>
              <span>底层机制 · {{ mechanism.author || '匿名作者' }}</span>
              <h3>{{ mechanism.name }}</h3>
              <p>{{ mechanism.description || '未填写机制说明' }}</p>
              <small>
                {{ mechanism.resources.length }} 个资源 ·
                {{ mechanism.rules.length }} 条规则 · {{ mechanism.id }}
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
              <label>
                <span>天赋强度</span>
                <output :class="{ over: talentPower > 24 }">
                  {{ Math.round(talentPower * 10) / 10 }} / 24
                </output>
              </label>
              <label class="wide">
                <span>天赋说明</span>
                <textarea
                  v-model="editor.talent.description"
                  maxlength="100"
                ></textarea>
              </label>
              <fieldset v-if="mechanisms.length" class="wide mechanism-links">
                <legend>启用底层机制</legend>
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
                :key="effect.type"
              >
                <strong>
                  {{
                    WORKSHOP_TALENT_OPTIONS.find(
                      (option) => option[0] === effect.type,
                    )?.[1]
                  }}
                </strong>
                <input
                  v-if="effect.type !== 'always_reveal_intent'"
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
                  :disabled="
                    editor.talent.effects.some((effect) => effect.type === type)
                  "
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
                <p>稀有度按旧版强度公式自动计算，同类效果每张牌只能添加一次。</p>
              </div>
              <button type="button" class="ca-button primary" @click="addCard">
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
                      max="10"
                    />
                  </label>
                  <label>
                    <span>当前强度</span>
                    <output :class="{ over: activeCardPower > activeCardLimit }">
                      {{ activeCardPower }} / {{ activeCardLimit }}
                    </output>
                  </label>
                  <label class="wide">
                    <span>卡牌说明</span>
                    <textarea
                      v-model="activeCard.description"
                      maxlength="90"
                    ></textarea>
                  </label>
                </div>
                <WorkshopEffectEditor
                  v-for="(effect, index) in activeCard.effects"
                  :key="`${effect.type}:${index}`"
                  :effect="effect"
                  @remove="activeCard.effects.splice(index, 1)"
                />
                <select
                  class="effect-picker"
                  value=""
                  :disabled="activeCard.effects.length >= 8"
                  @change="
                    addEffect(($event.target as HTMLSelectElement).value);
                    ($event.target as HTMLSelectElement).value = '';
                  "
                >
                  <option value="" disabled>+ 添加卡牌效果</option>
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
                <h3>预设牌组</h3>
                <p>总计 10–20 张，同一张自定义卡牌最多放入 3 张。</p>
              </div>
              <output
                :class="{
                  over:
                    editor.starterDeck.length < 10 ||
                    editor.starterDeck.length > 20,
                }"
              >
                {{ editor.starterDeck.length }} / 10–20
              </output>
            </header>
            <div class="deck-builder">
              <article v-for="card in editor.cards" :key="card.id">
                <div>
                  <strong>{{ card.name }}</strong>
                  <span>{{ typeNames[card.type] }} · AP {{ card.cost }}</span>
                </div>
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
                    (deckCounts[card.id] ?? 0) >= 3 ||
                      editor.starterDeck.length >= 20
                  "
                  @click="addDeckCopy(card.id)"
                >
                  +
                </button>
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
              校验并发布职业
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

.deck-builder article > div {
  display: grid;
  min-width: 0;
  flex: 1;
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
  .deck-builder {
    grid-template-columns: 1fr;
  }

  .publish-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
