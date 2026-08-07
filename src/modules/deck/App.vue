<script setup lang="ts">
/* global window */
import { computed, onMounted, ref } from 'vue';
import { loadCardCatalog } from '@/content/catalogs/cards';
import {
  mainClassForSubclass,
  subclassNames,
} from '@/content/catalogs/professions';
import type { CardDefinition } from '@/content/types';
import type { GameSnapshot } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import WorkshopDialog from '@/modules/deck/WorkshopDialog.vue';
import CardSquareDialog from '@/modules/deck/CardSquareDialog.vue';
import {
  deleteSavedDeckBuild,
  readSavedDeckBuilds,
  saveNamedDeckBuild,
  type SavedDeckBuild,
} from '@/saved-decks';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const catalog = ref<Record<string, CardDefinition>>({});
const editing = ref(false);
const draft = ref<string[]>([]);
const filter = ref('all');
const search = ref('');
const notice = ref('');
const workshopOpen = ref(false);
const squareOpen = ref(false);
const presetName = ref('');
const savedDecks = ref(readSavedDeckBuilds());

const typeNames: Record<string, string> = {
  all: '全部',
  attack: '攻击',
  defense: '防御',
  skill: '技能',
  summon: '召唤',
  status: '状态',
};
const rarityNames: Record<string, string> = {
  common: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

const deckIds = computed(
  () =>
    (editing.value
      ? draft.value
      : snapshot.value?.decks.find((deck) => deck.active)?.cardIds) ?? [],
);
const groupedDeck = computed(() =>
  groupCards(deckIds.value).filter((entry) => matchFilter(entry.definition)),
);
const ownedCards = computed(() =>
  (snapshot.value?.cards ?? [])
    .flatMap((owned) => {
      const definition = catalog.value[owned.cardId];
      return definition
        ? [
            {
              id: owned.cardId,
              quantity: owned.quantity,
              definition,
              inDeck: draft.value.filter((id) => id === owned.cardId).length,
            },
          ]
        : [];
    })
    .filter((entry) => matchFilter(entry.definition)),
);

function groupCards(cardIds: string[]) {
  const counts = cardIds.reduce<Record<string, number>>((result, id) => {
    result[id] = (result[id] ?? 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).flatMap(([id, quantity]) => {
    const definition = catalog.value[id];
    return definition ? [{ id, quantity, definition }] : [];
  });
}

function matchFilter(card: CardDefinition) {
  const typeMatch = filter.value === 'all' || card.type === filter.value;
  const term = search.value.trim().toLowerCase();
  return (
    typeMatch &&
    (!term ||
      card.name.toLowerCase().includes(term) ||
      card.description.toLowerCase().includes(term))
  );
}

function beginEdit() {
  draft.value = [
    ...(snapshot.value?.decks.find((deck) => deck.active)?.cardIds ?? []),
  ];
  editing.value = true;
  notice.value = '';
}

function addCard(id: string) {
  const owned = snapshot.value?.cards.find((entry) => entry.cardId === id);
  if (!owned || draft.value.filter((cardId) => cardId === id).length >= owned.quantity) {
    return;
  }
  if (draft.value.length >= 30) return;
  draft.value.push(id);
}

function removeCard(id: string) {
  const index = draft.value.lastIndexOf(id);
  if (index >= 0) draft.value.splice(index, 1);
}

async function saveDeck() {
  notice.value = '';
  const result = await props.context.api.execute({
    id: commandId('deck.update'),
    type: 'deck.update',
    payload: { cardIds: [...draft.value] },
  });
  if (result.status === 'rejected') {
    notice.value = result.message ?? '牌组保存失败';
    return;
  }
  snapshot.value = await props.context.api.query('state');
  editing.value = false;
  notice.value = '牌组已保存到浏览器本地档案。';
}

function savePreset(): void {
  notice.value = '';
  const name = presetName.value.trim();
  const player = snapshot.value?.player;
  const deck = snapshot.value?.decks.find((entry) => entry.active);
  if (name.length < 2) {
    notice.value = '请先填写至少 2 个字的构筑名称。';
    return;
  }
  if (!player || !deck?.cardIds.length) {
    notice.value = '当前没有可以保存的构筑。';
    return;
  }
  const existing = savedDecks.value.find(
    (entry) => entry.name === name && entry.professionId === player.subclass,
  );
  const saved = saveNamedDeckBuild({
    id: existing?.id ?? commandId('saved-deck'),
    name,
    professionId: player.subclass,
    professionName: subclassNames[player.subclass] ?? player.subclass,
    mainClass: mainClassForSubclass(player.subclass),
    cardIds: [...deck.cardIds],
    createdAt: existing?.createdAt,
  });
  savedDecks.value = readSavedDeckBuilds();
  presetName.value = '';
  notice.value = existing
    ? `已覆盖更新构筑「${saved.name}」。`
    : `已保存构筑「${saved.name}」。`;
}

async function applyPreset(build: SavedDeckBuild): Promise<void> {
  notice.value = '';
  const player = snapshot.value?.player;
  if (!player) return;
  if (player.subclass !== build.professionId) {
    const confirmed = window.confirm(
      `「${build.name}」属于${build.professionName}。是否先快捷转职，再切换构筑？`,
    );
    if (!confirmed) return;
    const reclass = await props.context.api.execute({
      id: commandId('player.reclass'),
      type: 'player.reclass',
      payload: {
        classMain: build.mainClass,
        subclass: build.professionId,
      },
    });
    if (reclass.status === 'rejected') {
      notice.value = reclass.message ?? '快捷转职失败。';
      return;
    }
  }
  const result = await props.context.api.execute({
    id: commandId('deck.update'),
    type: 'deck.update',
    payload: { cardIds: [...build.cardIds] },
  });
  if (result.status === 'rejected') {
    notice.value = `${result.message ?? '构筑切换失败'}。预设不会自动赠送尚未拥有的卡牌。`;
    snapshot.value = await props.context.api.query('state');
    return;
  }
  snapshot.value = await props.context.api.query('state');
  draft.value = [...build.cardIds];
  notice.value = `已一键切换到构筑「${build.name}」。`;
}

function removePreset(build: SavedDeckBuild): void {
  if (!window.confirm(`确认删除构筑预设「${build.name}」？`)) return;
  deleteSavedDeckBuild(build.id);
  savedDecks.value = readSavedDeckBuilds();
  notice.value = `已删除构筑预设「${build.name}」。`;
}

async function workshopSaved() {
  catalog.value = { ...(await loadCardCatalog()) };
}

onMounted(async () => {
  [snapshot.value, catalog.value] = await Promise.all([
    props.context.api.query('state'),
    loadCardCatalog(),
  ]);
  draft.value = [
    ...(snapshot.value.decks.find((deck) => deck.active)?.cardIds ?? []),
  ];
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="deck"
    :date="snapshot?.world.location"
  >
    <div v-if="!snapshot" class="ca-empty">正在读取卡牌档案……</div>
    <template v-else>
      <section class="ca-section deck-header">
        <div>
          <span>ACTIVE DECK</span>
          <h1>{{ snapshot.decks.find((deck) => deck.active)?.name ?? '冒险牌组' }}</h1>
          <p>
            当前 {{ deckIds.length }} 张｜收藏
            {{ snapshot.cards.reduce((sum, item) => sum + item.quantity, 0) }} 张
          </p>
        </div>
        <div class="deck-actions">
          <template v-if="editing">
            <button type="button" class="ca-button" @click="editing = false">
              取消
            </button>
            <button
              type="button"
              class="ca-button primary"
              :disabled="draft.length === 0"
              @click="saveDeck"
            >
              保存牌组
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="ca-button"
              @click="workshopOpen = true"
            >
              创意工坊
            </button>
            <button type="button" class="ca-button" @click="squareOpen = true">
              卡牌广场
            </button>
            <button type="button" class="ca-button primary" @click="beginEdit">
              编辑牌组
            </button>
          </template>
        </div>
      </section>

      <section class="ca-section saved-builds">
        <header>
          <div>
            <span>SAVED BUILDS</span>
            <h2>我的构筑预设</h2>
            <p>保存在当前浏览器；选择预设即可切换，职业不符时可快捷转职。</p>
          </div>
          <div class="preset-save">
            <input
              v-model="presetName"
              maxlength="50"
              placeholder="为当前构筑命名"
              @keyup.enter="savePreset"
            />
            <button type="button" class="ca-button primary" @click="savePreset">
              保存当前构筑
            </button>
          </div>
        </header>
        <div v-if="savedDecks.length === 0" class="preset-empty">
          还没有预设。完成一套构筑后，为它命名并保存。
        </div>
        <div v-else class="preset-list">
          <article v-for="build in savedDecks" :key="build.id">
            <div>
              <strong>{{ build.name }}</strong>
              <span>{{ build.professionName }} · {{ build.cardIds.length }} 张</span>
            </div>
            <div>
              <button type="button" class="ca-button primary" @click="applyPreset(build)">
                一键切换
              </button>
              <button type="button" class="ca-button" @click="removePreset(build)">
                删除
              </button>
            </div>
          </article>
        </div>
      </section>

      <div class="filters">
        <button
          v-for="(name, id) in typeNames"
          :key="id"
          type="button"
          :class="{ active: filter === id }"
          @click="filter = id"
        >
          {{ name }}
        </button>
        <input v-model="search" placeholder="搜索卡牌或效果" />
      </div>

      <section class="ca-section">
        <h2 class="ca-section-title">
          牌组内容
          <small>{{ deckIds.length }}/30</small>
        </h2>
        <div v-if="groupedDeck.length === 0" class="ca-empty">
          当前筛选条件下没有卡牌
        </div>
        <div v-else class="card-grid">
          <article
            v-for="entry in groupedDeck"
            :key="entry.id"
            class="card"
            :data-rarity="entry.definition.rarity"
          >
            <header>
              <div>
                <strong>{{ entry.definition.name }}</strong>
                <span>
                  {{ rarityNames[entry.definition.rarity] ?? entry.definition.rarity }}
                  · {{ typeNames[entry.definition.type] ?? entry.definition.type }}
                </span>
              </div>
              <b>×{{ entry.quantity }}</b>
            </header>
            <p>{{ entry.definition.description }}</p>
            <footer>
              <span>AP {{ entry.definition.cost }}</span>
              <span v-if="entry.definition.mpCost">
                MP {{ entry.definition.mpCost }}
              </span>
              <button
                v-if="editing"
                type="button"
                class="ca-button"
                @click="removeCard(entry.id)"
              >
                移出一张
              </button>
            </footer>
          </article>
        </div>
      </section>

      <section v-if="editing" class="ca-section">
        <h2 class="ca-section-title">卡牌收藏</h2>
        <div class="collection-list">
          <article v-for="entry in ownedCards" :key="entry.id">
            <div>
              <strong>{{ entry.definition.name }}</strong>
              <span>{{ entry.definition.description }}</span>
            </div>
            <div>
              <small>{{ entry.inDeck }}/{{ entry.quantity }}</small>
              <button
                type="button"
                class="ca-button primary"
                :disabled="entry.inDeck >= entry.quantity || draft.length >= 30"
                @click="addCard(entry.id)"
              >
                加入
              </button>
            </div>
          </article>
        </div>
      </section>

      <p v-if="notice" class="deck-notice">{{ notice }}</p>
    </template>
    <WorkshopDialog
      v-if="workshopOpen"
      :context="context"
      @close="workshopOpen = false"
      @saved="workshopSaved"
    />
    <CardSquareDialog
      v-if="squareOpen"
      :context="context"
      @close="squareOpen = false"
      @changed="workshopSaved"
    />
  </AdventurerFrame>
</template>

<style scoped>
.deck-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.deck-header > div:first-child > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.18em;
}

.deck-header h1 {
  margin: 4px 0 3px;
  color: var(--ca-text-bright);
  font: 700 23px/1.1 var(--ca-serif);
}

.deck-header p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
}

.deck-actions {
  display: flex;
  gap: 7px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 13px 0;
}

.filters button {
  padding: 5px 12px;
  border: 1px solid var(--ca-border);
  border-radius: 999px;
  color: var(--ca-muted);
  background: transparent;
  font: 700 11px var(--ca-ui);
  cursor: pointer;
}

.filters button.active {
  border-color: var(--ca-gold);
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.1);
}

.filters input {
  min-width: 160px;
  flex: 1;
  padding: 6px 11px;
  border: 1px solid var(--ca-border);
  border-radius: 999px;
  color: var(--ca-text);
  background: var(--ca-surface);
  font: inherit;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.card {
  display: flex;
  min-height: 122px;
  flex-direction: column;
  padding: 9px 10px;
  border: 1px solid var(--ca-border);
  border-left: 3px solid #9c8970;
  border-radius: 11px;
  background:
    radial-gradient(circle at 90% 5%, rgba(212, 168, 67, 0.08), transparent 35%),
    var(--ca-surface-soft);
}

.card[data-rarity="uncommon"] {
  border-left-color: #4fa36d;
}

.card[data-rarity="rare"] {
  border-left-color: #4f91c5;
}

.card[data-rarity="epic"] {
  border-left-color: #a35bb9;
}

.card[data-rarity="legendary"] {
  border-left-color: var(--ca-gold);
}

.card header,
.card footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.card header > div {
  display: grid;
  gap: 3px;
}

.card strong {
  color: var(--ca-text-bright);
  font: 700 13px/1.1 var(--ca-serif);
}

.card header span,
.card footer span {
  color: var(--ca-muted);
  font-size: 9px;
}

.card header > b {
  color: var(--ca-gold-light);
}

.card p {
  flex: 1;
  margin: 7px 0;
  color: var(--ca-muted);
  font-size: 9px;
  line-height: 1.45;
}

.card footer {
  align-items: center;
  justify-content: flex-start;
}

.card footer button {
  margin-left: auto;
}

.collection-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.collection-list article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 9px;
  border: 1px solid var(--ca-border);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.02);
}

.collection-list article > div:first-child {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.collection-list strong {
  color: var(--ca-text-bright);
  font-size: 13px;
}

.collection-list span {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ca-muted);
  font-size: 10px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.collection-list article > div:last-child {
  display: flex;
  align-items: center;
  gap: 8px;
}

.collection-list small {
  color: var(--ca-gold-light);
}

.deck-notice {
  color: #9bdfb9;
  font-size: 11px;
  text-align: center;
}

.saved-builds > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
}

.saved-builds header > div:first-child > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.16em;
}

.saved-builds h2 {
  margin: 3px 0;
  color: var(--ca-text-bright);
  font: 700 17px var(--ca-serif);
}

.saved-builds p,
.preset-empty {
  margin: 0;
  color: var(--ca-muted);
  font-size: 10px;
}

.preset-save {
  display: flex;
  gap: 7px;
}

.preset-save input {
  min-width: 180px;
  padding: 7px 10px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-text);
  background: var(--ca-surface);
  font: inherit;
}

.preset-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 7px;
  margin-top: 12px;
}

.preset-list article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--ca-border);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.02);
}

.preset-list article > div {
  display: flex;
  gap: 6px;
}

.preset-list article > div:first-child {
  min-width: 0;
  flex-direction: column;
}

.preset-list strong {
  overflow: hidden;
  color: var(--ca-text-bright);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-list span {
  color: var(--ca-muted);
  font-size: 9px;
}

@media (max-width: 560px) {
  .deck-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .saved-builds > header,
  .preset-save {
    align-items: stretch;
    flex-direction: column;
  }

  .preset-save input {
    min-width: 0;
  }

  .card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .card {
    min-height: 112px;
    padding: 8px;
  }

  .card header {
    align-items: flex-start;
  }

  .card strong {
    font-size: 12px;
  }

  .card p {
    font-size: 8px;
  }

  .card footer {
    flex-wrap: wrap;
  }

  .collection-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .collection-list article {
    align-items: stretch;
    flex-direction: column;
    padding: 8px;
  }

  .collection-list article > div:last-child {
    justify-content: space-between;
  }
}

@media (max-width: 359px) {
  .card-grid,
  .collection-list {
    gap: 5px;
  }

  .card {
    padding: 7px;
  }

  .card header span {
    font-size: 8px;
  }
}
</style>
