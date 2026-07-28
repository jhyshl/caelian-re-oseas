<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { loadCards } from '@/content/catalogs/cards';
import {
  getProfessionTalent,
  getStarterDeck,
  mainProfessions,
  subclassNames,
} from '@/content/catalogs/professions';
import type { PlayerRecord } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{
  context: PanelContext;
  player: PlayerRecord;
  mode: 'create' | 'reclass';
}>();
const emit = defineEmits<{
  close: [];
  applied: [];
}>();

const selectedMain = ref('');
const selectedSubclass = ref('');
const playerName = ref(props.player.name);
const deckNames = ref<string[]>([]);
const busy = ref(false);
const error = ref('');

const talent = computed(() =>
  selectedSubclass.value
    ? getProfessionTalent(selectedSubclass.value)
    : undefined,
);
const reclassCost = computed(() =>
  props.player.reclassCount <= 0
    ? 500
    : props.player.reclassCount === 1
      ? 1000
      : 2000,
);
const canSubmit = computed(
  () =>
    selectedMain.value.length > 0 &&
    selectedSubclass.value.length > 0 &&
    playerName.value.trim().length > 0 &&
    (props.mode === 'create' || props.player.gold >= reclassCost.value),
);

watch(selectedMain, () => {
  selectedSubclass.value = '';
  deckNames.value = [];
});

watch(selectedSubclass, async (subclass) => {
  if (!subclass) {
    deckNames.value = [];
    return;
  }
  deckNames.value = (await loadCards(getStarterDeck(subclass))).map(
    (entry) => entry.definition.name,
  );
});

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = '';
  const type = props.mode === 'create' ? 'player.create' : 'player.reclass';
  try {
    const result = await props.context.api.execute({
      id: commandId(type),
      type,
      payload:
        props.mode === 'create'
          ? {
              name: playerName.value.trim(),
              classMain: selectedMain.value,
              subclass: selectedSubclass.value,
            }
          : {
              classMain: selectedMain.value,
              subclass: selectedSubclass.value,
            },
    });
    if (result.status === 'rejected') throw new Error(result.message);
    emit('applied');
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="profession-backdrop">
    <section class="profession-dialog" role="dialog" aria-modal="true">
      <header>
        <div>
          <span>{{ mode === 'create' ? 'NEW ADVENTURER' : 'RECLASS' }}</span>
          <h2>
            {{ mode === 'create' ? '创建你的冒险者' : '选择新的职业道路' }}
          </h2>
        </div>
        <button
          v-if="mode === 'reclass'"
          type="button"
          class="dialog-close"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <label v-if="mode === 'create'" class="name-field">
        <span>冒险者名称</span>
        <input v-model="playerName" maxlength="80" />
        <small>默认读取当前 User 人设，只需要选择职业即可开始冒险。</small>
      </label>

      <div v-else class="reclass-warning">
        转职后会保留等级、背包、装备、藏品、任务与成就，但会丢弃当前牌组和卡牌收藏，改为新职业的15张预设牌组。旧卡组无法找回。
        <b>本次费用：{{ reclassCost }}金币</b>
        <span>当前金币：{{ player.gold }}｜已转职：{{ player.reclassCount }}次</span>
      </div>

      <h3>选择职业大类</h3>
      <div class="main-class-grid">
        <button
          v-for="item in mainProfessions"
          :key="item.id"
          type="button"
          :class="{ selected: selectedMain === item.id }"
          @click="selectedMain = item.id"
        >
          <i>{{ item.icon }}</i>
          <strong>{{ item.name }}</strong>
          <span>{{ item.description }}</span>
        </button>
      </div>

      <template v-if="selectedMain">
        <h3>选择子职业</h3>
        <div class="subclass-grid">
          <button
            v-for="subclass in mainProfessions.find(
              (item) => item.id === selectedMain,
            )?.subclassIds"
            :key="subclass"
            type="button"
            :disabled="mode === 'reclass' && subclass === player.subclass"
            :class="{ selected: selectedSubclass === subclass }"
            @click="selectedSubclass = subclass"
          >
            {{ subclassNames[subclass] ?? subclass }}
            <small v-if="mode === 'reclass' && subclass === player.subclass">
              当前职业
            </small>
          </button>
        </div>
      </template>

      <div v-if="talent" class="profession-detail">
        <strong>{{ talent.title }}｜职业玩法</strong>
        <p>{{ talent.playstyle }}</p>
        <p><b>天赋：</b>{{ talent.talent }}</p>
        <p class="deck-preview">
          <b>预设牌组：</b>{{ deckNames.join('、') || '正在读取……' }}
        </p>
      </div>

      <p v-if="error" class="dialog-error">{{ error }}</p>
      <footer>
        <button
          v-if="mode === 'reclass'"
          type="button"
          class="ca-button"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          class="ca-button primary"
          :disabled="!canSubmit || busy"
          @click="submit"
        >
          {{
            busy
              ? '处理中……'
              : mode === 'create'
                ? '开始冒险'
                : `支付 ${reclassCost} 金币并转职`
          }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.profession-backdrop {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.68);
  backdrop-filter: blur(4px);
}

.profession-dialog {
  width: min(720px, 100%);
  max-height: min(760px, calc(100dvh - 36px));
  overflow: auto;
  padding: 24px;
  border: 1px solid rgba(212, 168, 67, 0.38);
  border-radius: 16px;
  background: var(--ca-surface);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.7);
}

header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 18px;
}

header span,
h3,
.name-field > span {
  color: var(--ca-gold);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

h2 {
  margin: 4px 0 0;
  color: var(--ca-text-bright);
  font: 700 24px/1.15 var(--ca-serif);
}

h3 {
  margin: 19px 0 8px;
}

.dialog-close {
  border: 0;
  color: var(--ca-muted);
  background: transparent;
  font-size: 28px;
  cursor: pointer;
}

.name-field {
  display: grid;
  gap: 7px;
  padding: 12px;
  border: 1px solid rgba(212, 168, 67, 0.25);
  border-radius: 11px;
  background: rgba(212, 168, 67, 0.07);
}

.name-field input {
  padding: 10px 12px;
  border: 1px solid var(--ca-border-light);
  border-radius: 8px;
  color: var(--ca-text-bright);
  background: var(--ca-bg);
  font: inherit;
}

.name-field small,
.reclass-warning span {
  color: var(--ca-muted);
  font-size: 11px;
}

.reclass-warning {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid rgba(201, 74, 67, 0.35);
  border-radius: 11px;
  color: var(--ca-muted);
  background: rgba(201, 74, 67, 0.07);
  font-size: 12px;
  line-height: 1.55;
}

.reclass-warning b {
  color: var(--ca-gold-light);
}

.main-class-grid,
.subclass-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.main-class-grid button,
.subclass-grid button {
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  color: var(--ca-text);
  background: rgba(255, 255, 255, 0.02);
  font: inherit;
  cursor: pointer;
}

.main-class-grid button {
  display: grid;
  grid-template:
    "icon title" auto
    "icon desc" auto /
    36px 1fr;
  gap: 2px 8px;
  padding: 11px;
  text-align: left;
}

.main-class-grid button i {
  grid-area: icon;
  align-self: center;
  color: var(--ca-gold);
  font-size: 25px;
  font-style: normal;
  text-align: center;
}

.main-class-grid button strong {
  grid-area: title;
  color: var(--ca-text-bright);
}

.main-class-grid button span {
  grid-area: desc;
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.4;
}

.subclass-grid button {
  padding: 9px;
}

.subclass-grid small {
  margin-left: 5px;
  color: var(--ca-muted);
}

.main-class-grid button.selected,
.subclass-grid button.selected {
  border-color: var(--ca-gold);
  background: rgba(212, 168, 67, 0.1);
  box-shadow: 0 0 0 1px rgba(212, 168, 67, 0.12);
}

.profession-detail {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(212, 168, 67, 0.22);
  border-radius: 11px;
  background: rgba(212, 168, 67, 0.055);
}

.profession-detail > strong {
  color: var(--ca-gold);
}

.profession-detail p {
  margin: 6px 0 0;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.55;
}

.profession-detail p b {
  color: var(--ca-text);
}

.deck-preview {
  max-height: 70px;
  overflow: auto;
}

.dialog-error {
  margin: 12px 0 0;
  color: #ff9f9a;
  font-size: 12px;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

@media (max-width: 560px) {
  .profession-dialog {
    padding: 17px;
  }

  .main-class-grid {
    grid-template-columns: 1fr;
  }
}
</style>
