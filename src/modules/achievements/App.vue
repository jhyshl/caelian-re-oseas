<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { loadAchievementDefinitions } from '@/content/catalogs/achievements';
import type { AchievementDefinition } from '@/content/types';
import type { GameSnapshot } from '@/domain/types';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const definitions = ref<Record<string, AchievementDefinition>>({});
const mode = ref<'all' | 'unlocked' | 'locked'>('all');
const stars = ref(0);
const search = ref('');

const unlockedIds = computed(
  () =>
    new Set(
      (snapshot.value?.achievements ?? [])
        .filter((progress) => progress.unlocked)
        .map((progress) => progress.achievementId),
    ),
);
const entries = computed(() => {
  const term = search.value.trim().toLowerCase();
  return Object.entries(definitions.value).filter(([id, definition]) => {
    const unlocked = unlockedIds.value.has(id);
    const modeMatches =
      mode.value === 'all' ||
      (mode.value === 'unlocked' ? unlocked : !unlocked);
    const starValue = Number(definition.star ?? 0);
    const starMatches = stars.value === 0 || starValue === stars.value;
    const searchMatches =
      !term ||
      definition.name.toLowerCase().includes(term) ||
      definition.description.toLowerCase().includes(term) ||
      String(definition.condition ?? '').toLowerCase().includes(term);
    return modeMatches && starMatches && searchMatches;
  });
});
const totalStars = computed(() =>
  Object.entries(definitions.value).reduce(
    (total, [id, definition]) =>
      total + (unlockedIds.value.has(id) ? Number(definition.star ?? 0) : 0),
    0,
  ),
);

onMounted(async () => {
  [snapshot.value, definitions.value] = await Promise.all([
    props.context.api.query('state'),
    loadAchievementDefinitions(),
  ]);
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
          <p>名称、达成条件、星级与描述直接来自原始成就系统。</p>
        </div>
        <dl>
          <div>
            <dt>已解锁</dt>
            <dd>{{ unlockedIds.size }}/{{ Object.keys(definitions).length }}</dd>
          </div>
          <div>
            <dt>获得星数</dt>
            <dd>{{ totalStars }} ★</dd>
          </div>
        </dl>
      </section>

      <div class="achievement-filters">
        <div>
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
        <select v-model.number="stars">
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
            :class="{ unlocked: unlockedIds.has(id) }"
          >
            <header>
              <div class="achievement-icon">
                {{ unlockedIds.has(id) ? '♛' : '◇' }}
              </div>
              <div>
                <strong>{{ achievement.name }}</strong>
                <span>
                  {{ '★'.repeat(Number(achievement.star ?? 0)) }}
                </span>
              </div>
              <b>{{ unlockedIds.has(id) ? '已解锁' : '未解锁' }}</b>
            </header>
            <p>{{ achievement.description }}</p>
            <footer>
              <span>达成条件</span>
              <strong>{{ achievement.condition }}</strong>
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
  min-width: 88px;
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
  font: 700 16px var(--ca-serif);
}

.achievement-filters {
  display: flex;
  gap: 8px;
  margin: 14px 0;
}

.achievement-filters > div {
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
  min-width: 160px;
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

.achievement-grid p {
  min-height: 34px;
  margin: 12px 0;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.5;
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
