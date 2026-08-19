<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_LABELS,
  achievementTarget,
  type AchievementCategory,
} from '@/achievements/catalog';
import type { AchievementDefinition } from '@/content/types';
import type {
  AchievementProgressRecord,
  GameSnapshot,
} from '@/domain/types';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const definitions = ref<Record<string, AchievementDefinition>>({});
const mode = ref<'all' | 'unlocked' | 'locked'>('all');
const category = ref<AchievementCategory>('all');
const stars = ref(0);
const search = ref('');
const disposers: Array<() => void> = [];

const progressById = computed(
  () =>
    new Map(
      (snapshot.value?.achievements ?? []).map((progress) => [
        progress.achievementId,
        progress,
      ]),
    ),
);

const unlockedIds = computed(
  () =>
    new Set(
      (snapshot.value?.achievements ?? [])
        .filter((progress) => progress.unlocked)
        .map((progress) => progress.achievementId),
    ),
);

const visibleDefinitions = computed(() =>
  Object.fromEntries(
    Object.entries(definitions.value).filter(
      ([id, definition]) =>
        !definition.patchOnly || progressById.value.has(id),
    ),
  ),
);

const entries = computed(() => {
  const term = search.value.trim().toLowerCase();
  return Object.entries(visibleDefinitions.value)
    .filter(([id, definition]) => {
      const unlocked = unlockedIds.value.has(id);
      const modeMatches =
        mode.value === 'all' ||
        (mode.value === 'unlocked' ? unlocked : !unlocked);
      const definitionCategory = String(
        definition.category ?? 'story',
      ) as AchievementCategory;
      const categoryMatches =
        category.value === 'all' || definitionCategory === category.value;
      const starValue = Number(definition.star ?? 0);
      const starMatches = stars.value === 0 || starValue === stars.value;
      const hidden = Boolean(definition.hidden) && !unlocked;
      const searchSource = hidden
        ? '隐藏成就'
        : `${definition.name} ${definition.description} ${definition.condition ?? ''}`;
      const searchMatches =
        !term || searchSource.toLowerCase().includes(term);
      return (
        modeMatches &&
        categoryMatches &&
        starMatches &&
        searchMatches
      );
    })
    .sort(([leftId, left], [rightId, right]) => {
      const unlockedDifference =
        Number(unlockedIds.value.has(rightId)) -
        Number(unlockedIds.value.has(leftId));
      if (unlockedDifference !== 0) return unlockedDifference;
      const starDifference =
        Number(right.star ?? 0) - Number(left.star ?? 0);
      if (starDifference !== 0) return starDifference;
      return left.name.localeCompare(right.name, 'zh-Hans-CN');
    });
});

const totalStars = computed(() =>
  Object.entries(visibleDefinitions.value).reduce(
    (total, [id, definition]) =>
      total + (unlockedIds.value.has(id) ? Number(definition.star ?? 0) : 0),
    0,
  ),
);

const possibleStars = computed(() =>
  Object.values(visibleDefinitions.value).reduce(
    (total, definition) => total + Number(definition.star ?? 0),
    0,
  ),
);

const categoryOptions = computed(() =>
  ACHIEVEMENT_CATEGORIES.map((id) => ({
    id,
    label: ACHIEVEMENT_CATEGORY_LABELS[id],
  })),
);

async function refresh(): Promise<void> {
  [snapshot.value, definitions.value] = await Promise.all([
    props.context.api.query('state'),
    props.context.api.query('achievement-definitions'),
  ]);
}

function progress(id: string): AchievementProgressRecord | undefined {
  return progressById.value.get(id);
}

function progressValue(id: string): number {
  return Math.min(
    achievementTarget(id),
    Math.max(0, progress(id)?.progress ?? 0),
  );
}

function progressPercent(id: string): number {
  return Math.min(
    100,
    Math.round((progressValue(id) / achievementTarget(id)) * 100),
  );
}

function unlockedDate(id: string): string {
  const timestamp = progress(id)?.unlockedAt;
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

function isHidden(id: string, definition: AchievementDefinition): boolean {
  return Boolean(definition.hidden) && !unlockedIds.value.has(id);
}

onMounted(async () => {
  await refresh();
  for (const event of [
    'state.changed',
    'tavern.changed',
    'achievement.unlocked',
  ] as const) {
    disposers.push(props.context.api.on(event, refresh));
  }
});

onUnmounted(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="achievements"
    :date="snapshot?.world.location"
  >
    <div v-if="!snapshot" class="ca-empty">正在展开成就图鉴……</div>
    <template v-else>
      <section class="ca-section achievement-summary">
        <div>
          <span>ACHIEVEMENT ARCHIVE</span>
          <h1>欧西亚斯成就图鉴</h1>
          <p>跨聊天保存；条件、星级和文本均沿用旧版成就系统。</p>
        </div>
        <dl>
          <div>
            <dt>已解锁</dt>
            <dd>{{ unlockedIds.size }}/{{ Object.keys(visibleDefinitions).length }}</dd>
          </div>
          <div>
            <dt>获得星数</dt>
            <dd>{{ totalStars }}/{{ possibleStars }} ★</dd>
          </div>
        </dl>
      </section>

      <div class="achievement-filters">
        <div class="status-filter">
          <button
            v-for="item in [
              ['all', '全部'],
              ['unlocked', '已解锁'],
              ['locked', '未解锁'],
            ]"
            :key="item[0]"
            type="button"
            :class="{ active: mode === item[0] }"
            @click="mode = item[0] as typeof mode"
          >
            {{ item[1] }}
          </button>
        </div>
        <select v-model="category" aria-label="成就类别">
          <option
            v-for="option in categoryOptions"
            :key="option.id"
            :value="option.id"
          >
            {{ option.label }}
          </option>
        </select>
        <select v-model.number="stars" aria-label="成就星级">
          <option :value="0">全部星级</option>
          <option v-for="value in 5" :key="value" :value="value">
            {{ value }} 星
          </option>
        </select>
        <input v-model="search" placeholder="搜索成就、条件或描述" />
      </div>

      <section class="ca-section">
        <h2 class="ca-section-title">
          成就列表
          <small>{{ entries.length }} 项</small>
        </h2>
        <div v-if="entries.length === 0" class="ca-empty">
          当前筛选条件下没有成就。
        </div>
        <div v-else class="achievement-grid">
          <article
            v-for="[id, achievement] in entries"
            :key="id"
            :class="{
              unlocked: unlockedIds.has(id),
              hidden: isHidden(id, achievement),
            }"
          >
            <header>
              <div class="achievement-icon">
                {{ unlockedIds.has(id) ? '♛' : isHidden(id, achievement) ? '?' : '◇' }}
              </div>
              <div>
                <strong>
                  {{ isHidden(id, achievement) ? '？？？' : achievement.name }}
                </strong>
                <span>{{ '★'.repeat(Number(achievement.star ?? 0)) }}</span>
              </div>
              <b>{{ unlockedIds.has(id) ? '已解锁' : '未解锁' }}</b>
            </header>
            <p>
              {{
                isHidden(id, achievement)
                  ? '达成隐藏条件后才会显示这项成就。'
                  : achievement.description
              }}
            </p>
            <div
              v-if="
                !unlockedIds.has(id) &&
                  !isHidden(id, achievement) &&
                  (achievementTarget(id) > 1 || progressValue(id) > 0)
              "
              class="progress"
            >
              <span :style="{ width: `${progressPercent(id)}%` }"></span>
              <small>
                {{ progressValue(id) }}/{{ achievementTarget(id) }}
              </small>
            </div>
            <footer>
              <span>{{ unlockedIds.has(id) ? '解锁日期' : '达成条件' }}</span>
              <strong>
                {{
                  unlockedIds.has(id)
                    ? unlockedDate(id)
                    : isHidden(id, achievement)
                      ? '隐藏'
                      : achievement.condition
                }}
              </strong>
            </footer>
          </article>
        </div>
      </section>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.achievement-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background:
    radial-gradient(circle at 8% 40%, rgba(156, 97, 187, 0.13), transparent 27%),
    var(--ca-surface);
}

.achievement-summary > div > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.17em;
}

.achievement-summary h1 {
  margin: 5px 0;
  color: var(--ca-text-bright);
  font: 700 23px var(--ca-serif);
}

.achievement-summary p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
}

.achievement-summary dl {
  display: flex;
  gap: 10px;
  margin: 0;
}

.achievement-summary dl div {
  min-width: 94px;
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  text-align: center;
}

.achievement-summary dt {
  color: var(--ca-muted);
  font-size: 9px;
}

.achievement-summary dd {
  margin: 0;
  color: var(--ca-gold-light);
  font: 700 15px var(--ca-serif);
}

.achievement-filters {
  display: flex;
  gap: 8px;
  margin: 14px 0;
}

.status-filter {
  display: flex;
  gap: 5px;
}

.achievement-filters button,
.achievement-filters select,
.achievement-filters input {
  min-height: 32px;
  padding: 6px 11px;
  border: 1px solid var(--ca-border);
  border-radius: 999px;
  color: var(--ca-muted);
  background: var(--ca-surface);
  font: 700 10px var(--ca-ui);
}

.achievement-filters button {
  cursor: pointer;
}

.achievement-filters button.active {
  border-color: var(--ca-gold-dark);
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.08);
}

.achievement-filters input {
  min-width: 150px;
  flex: 1;
  font-weight: 400;
}

.achievement-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.achievement-grid article {
  padding: 13px;
  border: 1px solid var(--ca-border);
  border-radius: 11px;
  background: var(--ca-surface-soft);
  opacity: 0.72;
}

.achievement-grid article.unlocked {
  border-color: rgba(212, 168, 67, 0.38);
  background:
    radial-gradient(circle at 0 0, rgba(212, 168, 67, 0.1), transparent 36%),
    var(--ca-surface-soft);
  opacity: 1;
}

.achievement-grid article.hidden {
  background:
    repeating-linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.012),
      rgba(255, 255, 255, 0.012) 5px,
      transparent 5px,
      transparent 10px
    ),
    var(--ca-surface-soft);
}

.achievement-grid header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
}

.achievement-icon {
  width: 35px;
  height: 35px;
  display: grid;
  place-items: center;
  border: 1px solid var(--ca-border-light);
  border-radius: 50%;
  color: var(--ca-muted);
  background: #101217;
}

.unlocked .achievement-icon {
  border-color: var(--ca-gold-dark);
  color: var(--ca-gold);
}

.achievement-grid header > div:nth-child(2) {
  display: grid;
  gap: 3px;
}

.achievement-grid header strong {
  color: var(--ca-text-bright);
  font: 700 15px var(--ca-serif);
}

.achievement-grid header span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.08em;
}

.achievement-grid header b {
  color: var(--ca-muted);
  font-size: 9px;
}

.unlocked header b {
  color: #8fd5ae;
}

.achievement-grid article > p {
  min-height: 34px;
  margin: 12px 0;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.5;
}

.progress {
  position: relative;
  height: 13px;
  margin: -2px 0 10px;
  overflow: hidden;
  border: 1px solid var(--ca-border);
  border-radius: 999px;
  background: #0d0f14;
}

.progress > span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #6f4d1c, #d4a843);
}

.progress > small {
  position: absolute;
  inset: 0;
  color: #e5dfd3;
  text-align: center;
  font-size: 8px;
  line-height: 11px;
}

.achievement-grid footer {
  display: grid;
  gap: 3px;
  padding-top: 9px;
  border-top: 1px solid var(--ca-border);
}

.achievement-grid footer span {
  color: var(--ca-gold-dark);
  font-size: 8px;
  letter-spacing: 0.1em;
}

.achievement-grid footer strong {
  color: var(--ca-text);
  font-size: 10px;
  font-weight: 500;
}

@media (max-width: 700px) {
  .achievement-summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .achievement-filters {
    flex-wrap: wrap;
  }

  .achievement-filters input {
    min-width: 100%;
  }

  .achievement-grid {
    grid-template-columns: 1fr;
  }

}
</style>
