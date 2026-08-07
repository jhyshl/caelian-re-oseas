<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  loadGuildCatalogs,
  type GuildRankRequirement,
  type GuildTaskDefinition,
} from '@/content/catalogs/guild';
import type { GameSnapshot, QuestRecord } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type {
  PanelContext,
  TrackedQuestView,
} from '@/kernel/public-api';
import type { QuestListEntry } from '@/quests/catalog';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const tasks = ref<GuildTaskDefinition[]>([]);
const rankNames = ref<Record<string, string>>({});
const rankRequirements = ref<Record<string, GuildRankRequirement>>({});
const typeNames = ref<Record<string, string>>({});
const typeIcons = ref<Record<string, string>>({});
const difficultyNames = ref<Record<string, string>>({});
const storyQuests = ref<QuestListEntry[]>([]);
const trackedQuest = ref<TrackedQuestView | null>(null);
const activeTab = ref<'quests' | 'board' | 'history'>('quests');
const notice = ref('');
const busyTask = ref('');
const busyManagedTask = ref('');
let disposeStateListener: (() => void) | undefined;

const activeQuests = computed(() =>
  (snapshot.value?.quests ?? []).filter((quest) =>
    ['active', 'ready'].includes(quest.status),
  ),
);
const activeCommissionTitles = computed(
  () =>
    new Set(
      activeQuests.value
        .filter((quest) => quest.kind === 'commission')
        .map((quest) => quest.title),
    ),
);
const rankSequence = [
  'copper',
  'iron',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'legend',
];
const nextRank = computed(() => {
  const rank = snapshot.value?.guild.rank ?? 'copper';
  const index = rankSequence.indexOf(rank);
  return index >= 0 ? rankSequence[index + 1] : rankSequence[0];
});
const nextRankName = computed(() => {
  const key = nextRank.value;
  return key ? (rankNames.value[key] ?? key) : '最高等级';
});
const nextRequirement = computed(() =>
  nextRank.value ? rankRequirements.value[nextRank.value] : undefined,
);
const rankProgress = computed(() => {
  const requirement = nextRequirement.value?.xp ?? 0;
  if (!snapshot.value || requirement <= 0) return 100;
  return Math.min(100, (snapshot.value.guild.experience / requirement) * 100);
});
const availableTasks = computed(() =>
  tasks.value.filter(
    (task) => (snapshot.value?.player.level ?? 1) >= task.lvl,
  ),
);

function taskId(task: GuildTaskDefinition) {
  return `${task.name}:${task.region}`;
}

async function refresh() {
  const [state, available, tracked] = await Promise.all([
    props.context.api.query('state'),
    props.context.api.listAvailableQuests(),
    props.context.api.getTrackedQuest(),
  ]);
  snapshot.value = state;
  storyQuests.value = available;
  trackedQuest.value = tracked;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTracked(quest: QuestRecord) {
  return trackedQuest.value?.quest.id === quest.id;
}

async function acceptStory(quest: QuestListEntry) {
  busyManagedTask.value = quest.id;
  notice.value = '';
  try {
    await props.context.api.acceptManagedQuest(quest.id);
    await refresh();
    activeTab.value = 'quests';
    notice.value = `已接取任务“${quest.name}”，前往任务地点的内容已填入聊天框。`;
  } catch (error) {
    notice.value = errorMessage(error);
  } finally {
    busyManagedTask.value = '';
  }
}

async function trackManaged(quest: QuestRecord) {
  busyManagedTask.value = quest.id;
  notice.value = '';
  try {
    await props.context.api.trackQuest(quest.id);
    await refresh();
    notice.value = `已开始追踪“${quest.title}”。`;
  } catch (error) {
    notice.value = errorMessage(error);
  } finally {
    busyManagedTask.value = '';
  }
}

async function toggleTracking(quest: QuestRecord) {
  busyManagedTask.value = quest.id;
  notice.value = '';
  try {
    const paused = ['manualPaused', 'suspended'].includes(
      trackedQuest.value?.tracker.current.trackerState ?? '',
    );
    if (paused) {
      await props.context.api.resumeTrackedQuest();
      notice.value = `已继续追踪“${quest.title}”。`;
    } else {
      await props.context.api.pauseTrackedQuest();
      notice.value = `已暂停追踪“${quest.title}”，任务进度会保留。`;
    }
    await refresh();
  } catch (error) {
    notice.value = errorMessage(error);
  } finally {
    busyManagedTask.value = '';
  }
}

async function performTrackedAction(quest: QuestRecord) {
  busyManagedTask.value = quest.id;
  notice.value = '';
  try {
    const action = trackedQuest.value?.action;
    await props.context.api.performTrackedQuestAction();
    await refresh();
    notice.value =
      action?.type === 'start_battle'
        ? '任务战斗已载入。'
        : `已完成任务动作“${action?.label ?? '确认'}”。`;
  } catch (error) {
    notice.value = errorMessage(error);
  } finally {
    busyManagedTask.value = '';
  }
}

async function completeManaged(quest: QuestRecord) {
  const confirmed = await props.context.api.confirm({
    title: `结算任务“${quest.title}”`,
    description: '结算后将发放奖励并写入完成记录，此操作不会随聊天楼层删除而回退。',
    confirmText: '确认结算',
    cancelText: '暂不结算',
  });
  if (!confirmed) return;
  busyManagedTask.value = quest.id;
  notice.value = '';
  try {
    const result = await props.context.api.completeTrackedQuest();
    await refresh();
    notice.value = `“${result.title}”已结算：${result.experience} EXP、${result.gold} 金币、${result.guildExperience} GXP。`;
  } catch (error) {
    notice.value = errorMessage(error);
  } finally {
    busyManagedTask.value = '';
  }
}

async function accept(task: GuildTaskDefinition) {
  busyTask.value = task.name;
  notice.value = '';
  const result = await props.context.api.execute({
    id: commandId('quest.accept'),
    type: 'quest.accept',
    payload: {
      taskId: taskId(task),
      title: task.name,
      region: task.region,
      objective: task.desc,
      totalStages: task.count ?? 1,
      rewardExperience: task.xp,
      rewardGold: task.gold,
      rewardGuildExperience: task.gxp,
      minimumLevel: task.lvl,
    },
  });
  busyTask.value = '';
  if (result.status === 'rejected') {
    notice.value = result.message ?? '委托接受失败';
    return;
  }
  await refresh();
  props.context.api.setUserInput(`接受协会委托：${task.name}`);
  notice.value = `已接受委托“${task.name}”，行动文本已填入酒馆输入框。`;
}

async function abandon(quest: QuestRecord) {
  notice.value = '';
  const result = await props.context.api.execute({
    id: commandId('quest.abandon'),
    type: 'quest.abandon',
    payload: { questId: quest.id },
  });
  if (result.status === 'rejected') {
    notice.value = result.message ?? '放弃任务失败';
    return;
  }
  await refresh();
  notice.value = `已从本地任务档案移除“${quest.title}”。`;
}

onMounted(async () => {
  const catalogs = await loadGuildCatalogs();
  tasks.value = catalogs.tasks;
  rankNames.value = catalogs.rankNames;
  rankRequirements.value = catalogs.rankRequirements;
  typeNames.value = catalogs.typeNames;
  typeIcons.value = catalogs.typeIcons;
  difficultyNames.value = catalogs.difficultyNames;
  await refresh();
  disposeStateListener = props.context.api.on('state.changed', refresh);
});

onUnmounted(() => {
  disposeStateListener?.();
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="guild"
    :date="snapshot?.world.location"
  >
    <div v-if="!snapshot" class="ca-empty">正在读取冒险者协会档案……</div>
    <template v-else>
      <section class="ca-section guild-card">
        <div class="guild-seal">⚔</div>
        <div class="guild-identity">
          <span>ADVENTURERS' GUILD</span>
          <h1>欧西亚斯冒险者协会</h1>
          <p>登记冒险者：{{ snapshot.player.name }}</p>
        </div>
        <div class="rank-panel">
          <small>当前协会等级</small>
          <strong>{{ rankNames[snapshot.guild.rank] ?? snapshot.guild.rank }}</strong>
          <span>{{ snapshot.guild.experience }} GXP</span>
        </div>
      </section>

      <section v-if="nextRequirement" class="ca-section rank-progress">
        <div>
          <strong>
            晋升{{ nextRankName }}
          </strong>
          <span>
            {{ snapshot.guild.experience }}/{{ nextRequirement.xp }} GXP ·
            已完成 {{ snapshot.guild.completedTaskCount }} 项委托
          </span>
        </div>
        <div class="rank-track"><i :style="{ width: `${rankProgress}%` }"></i></div>
      </section>

      <nav class="guild-tabs">
        <button
          type="button"
          :class="{ active: activeTab === 'quests' }"
          @click="activeTab = 'quests'"
        >
          进行中 {{ activeQuests.length }}
        </button>
        <button
          type="button"
          :class="{ active: activeTab === 'board' }"
          @click="activeTab = 'board'"
        >
          委托告示板
        </button>
        <button
          type="button"
          :class="{ active: activeTab === 'history' }"
          @click="activeTab = 'history'"
        >
          完成记录
        </button>
      </nav>

      <section v-if="activeTab === 'quests'" class="ca-section">
        <h2 class="ca-section-title">任务档案</h2>
        <div v-if="activeQuests.length === 0" class="ca-empty">
          当前没有进行中的任务，可前往委托告示板领取。
        </div>
        <div v-else class="quest-list">
          <article v-for="quest in activeQuests" :key="quest.id">
            <header>
              <div>
                <span>{{ quest.kind === 'main' ? '主线' : quest.kind === 'side' ? '支线' : '委托' }}</span>
                <h3>{{ quest.title }}</h3>
              </div>
              <b>{{ quest.region }}</b>
            </header>
            <p>{{ quest.objective }}</p>
            <p v-if="isTracked(quest)" class="tracking-state">
              当前追踪 · {{ trackedQuest?.tracker.current.trackerState }}
              <template v-if="trackedQuest?.position">
                · {{ trackedQuest.position.stageTitle }} / {{ trackedQuest.position.sceneTitle }} /
                {{ trackedQuest.position.beatTitle }}
              </template>
            </p>
            <p
              v-if="isTracked(quest) && trackedQuest?.action"
              class="required-action"
            >
              <template v-if="trackedQuest.action.type === 'submit_item'">
                需要提交 {{ trackedQuest.action.itemName }} ×{{ trackedQuest.action.count }}，
                当前持有 {{ trackedQuest.action.ownedCount ?? 0 }}。
              </template>
              <template v-else>需要本地确认：{{ trackedQuest.action.label }}。</template>
            </p>
            <div class="quest-progress">
              <i
                :style="{
                  width: `${Math.min(100, (quest.currentStage / quest.totalStages) * 100)}%`,
                }"
              ></i>
            </div>
            <footer>
              <div class="quest-meta">
                <span>进度 {{ quest.currentStage }}/{{ quest.totalStages }}</span>
                <span>
                  奖励 {{ quest.rewardExperience }} EXP ·
                  {{ quest.rewardGold }} 金币 ·
                  {{ quest.rewardGuildExperience }} GXP
                </span>
              </div>
              <div class="quest-actions">
                <button
                  v-if="quest.definitionId && quest.status === 'ready' && isTracked(quest)"
                  type="button"
                  class="ca-button primary"
                  :disabled="busyManagedTask === quest.id"
                  @click="completeManaged(quest)"
                >
                  确认结算
                </button>
                <button
                  v-else-if="quest.definitionId && !isTracked(quest)"
                  type="button"
                  class="ca-button primary"
                  :disabled="busyManagedTask === quest.id"
                  @click="trackManaged(quest)"
                >
                  追踪任务
                </button>
                <button
                  v-if="
                    quest.definitionId &&
                      quest.status === 'active' &&
                      isTracked(quest) &&
                      trackedQuest?.action
                  "
                  type="button"
                  class="ca-button primary"
                  :disabled="
                    !trackedQuest.action.available || busyManagedTask === quest.id
                  "
                  @click="performTrackedAction(quest)"
                >
                  {{ trackedQuest.action.label }}
                </button>
                <button
                  v-if="quest.definitionId && quest.status === 'active' && isTracked(quest)"
                  type="button"
                  class="ca-button"
                  :disabled="busyManagedTask === quest.id"
                  @click="toggleTracking(quest)"
                >
                  {{
                    ['manualPaused', 'suspended'].includes(
                      trackedQuest?.tracker.current.trackerState ?? '',
                    )
                      ? '继续追踪'
                      : '暂停追踪'
                  }}
                </button>
                <button
                  v-if="quest.kind !== 'main' && quest.status === 'active'"
                  type="button"
                  class="ca-button"
                  @click="abandon(quest)"
                >
                  放弃
                </button>
              </div>
            </footer>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'board'" class="ca-section">
        <h2 class="ca-section-title">
          当前地区剧情任务
          <small>{{ snapshot.world.region }} · Lv.{{ snapshot.player.level }}</small>
        </h2>
        <div v-if="storyQuests.length === 0" class="ca-empty story-empty">
          当前地区和等级暂时没有新的剧情任务。
        </div>
        <div v-else class="task-grid story-grid">
          <article v-for="quest in storyQuests" :key="quest.id">
            <header>
              <span>{{ quest.kind === 'main' ? '主线' : '支线' }}</span>
              <b>Lv.{{ quest.minimumLevel }}</b>
            </header>
            <h3>{{ quest.name }}</h3>
            <p>{{ quest.publicSummary }}</p>
            <dl>
              <div><dt>地区</dt><dd>{{ quest.region }}</dd></div>
              <div>
                <dt>奖励</dt>
                <dd>{{ quest.rewardExperience }} EXP / {{ quest.rewardGold }} G</dd>
              </div>
              <div><dt>协会经验</dt><dd>{{ quest.rewardGuildExperience }} GXP</dd></div>
            </dl>
            <button
              type="button"
              class="ca-button primary"
              :disabled="busyManagedTask === quest.id"
              @click="acceptStory(quest)"
            >
              {{ busyManagedTask === quest.id ? '接取中…' : '接取剧情任务' }}
            </button>
          </article>
        </div>

        <h2 class="ca-section-title">
          委托告示板
          <small>{{ availableTasks.length }} 项符合当前等级</small>
        </h2>
        <div class="task-grid">
          <article v-for="task in tasks" :key="`${task.name}:${task.region}`">
            <header>
              <span>
                {{ typeIcons[task.type] ?? '◇' }}
                {{ typeNames[task.type] ?? task.type }}
              </span>
              <b>{{ difficultyNames[task.difficulty] ?? task.difficulty }}</b>
            </header>
            <h3>{{ task.name }}</h3>
            <p>{{ task.desc }}</p>
            <dl>
              <div><dt>地区</dt><dd>{{ task.region }}</dd></div>
              <div><dt>等级</dt><dd>Lv.{{ task.lvl }}</dd></div>
              <div><dt>奖励</dt><dd>{{ task.xp }} EXP / {{ task.gold }} G</dd></div>
            </dl>
            <button
              type="button"
              class="ca-button primary"
              :disabled="
                snapshot.player.level < task.lvl ||
                  activeCommissionTitles.has(task.name) ||
                  busyTask === task.name
              "
              @click="accept(task)"
            >
              {{
                activeCommissionTitles.has(task.name)
                  ? '已接受'
                  : snapshot.player.level < task.lvl
                    ? `需要 Lv.${task.lvl}`
                    : '接受委托'
              }}
            </button>
          </article>
        </div>
      </section>

      <section v-else class="ca-section">
        <h2 class="ca-section-title">完成记录</h2>
        <div v-if="snapshot.questHistory.length === 0" class="ca-empty">
          尚未留下完成记录。
        </div>
        <div v-else class="history-list">
          <div v-for="item in snapshot.questHistory" :key="item.id">
            <strong>{{ item.title }}</strong>
            <span>{{ item.completedDate }}</span>
          </div>
        </div>
      </section>

      <p v-if="notice" class="guild-notice">{{ notice }}</p>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.guild-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 17px;
  background:
    radial-gradient(circle at 15% 50%, rgba(212, 168, 67, 0.15), transparent 25%),
    linear-gradient(120deg, #1b1817, #151922);
}

.guild-seal {
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  border: 1px solid var(--ca-gold-dark);
  border-radius: 50%;
  color: var(--ca-gold);
  background: #121319;
  font-size: 30px;
}

.guild-identity > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.17em;
}

.guild-identity h1 {
  margin: 4px 0;
  color: var(--ca-text-bright);
  font: 700 23px var(--ca-serif);
}

.guild-identity p,
.rank-panel span,
.rank-progress span {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
}

.rank-panel {
  display: grid;
  gap: 3px;
  min-width: 110px;
  padding-left: 18px;
  border-left: 1px solid var(--ca-border);
  text-align: right;
}

.rank-panel small {
  color: var(--ca-muted);
}

.rank-panel strong {
  color: var(--ca-gold-light);
  font: 700 22px var(--ca-serif);
}

.rank-progress > div:first-child {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.rank-progress strong {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.rank-track,
.quest-progress {
  height: 6px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 99px;
  background: #0c0e12;
}

.rank-track i,
.quest-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--ca-gold-dark), var(--ca-gold-light));
}

.guild-tabs {
  display: flex;
  gap: 6px;
  margin: 14px 0;
}

.guild-tabs button {
  flex: 1;
  padding: 9px;
  border: 1px solid var(--ca-border);
  border-radius: 9px;
  color: var(--ca-muted);
  background: var(--ca-surface);
  font: 700 11px var(--ca-ui);
  cursor: pointer;
}

.guild-tabs button.active {
  border-color: var(--ca-gold-dark);
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.09);
}

.quest-list,
.history-list {
  display: grid;
  gap: 10px;
}

.quest-list article,
.task-grid article {
  padding: 14px;
  border: 1px solid var(--ca-border);
  border-radius: 11px;
  background: var(--ca-surface-soft);
}

.quest-list header,
.quest-list footer,
.task-grid header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.quest-list header > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quest-list header span,
.task-grid header span {
  color: var(--ca-gold);
  font-size: 10px;
}

.quest-list h3,
.task-grid h3 {
  margin: 0;
  color: var(--ca-text-bright);
  font: 700 15px var(--ca-serif);
}

.quest-list header b,
.task-grid header b {
  color: var(--ca-muted);
  font-size: 10px;
}

.quest-list p,
.task-grid p {
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.5;
}

.quest-list footer {
  align-items: stretch;
  flex-direction: column;
  margin-top: 9px;
  color: var(--ca-muted);
  font-size: 9px;
}

.quest-meta,
.quest-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.quest-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.tracking-state {
  color: var(--ca-gold-light) !important;
}

.required-action {
  padding: 8px 10px;
  border: 1px solid rgba(212, 168, 67, 0.28);
  border-radius: 8px;
  color: var(--ca-text) !important;
  background: rgba(212, 168, 67, 0.07);
}

.story-grid {
  margin-bottom: 20px;
}

.story-grid + .ca-section-title {
  padding-top: 16px;
  border-top: 1px solid var(--ca-border);
}

.story-empty {
  margin-bottom: 20px;
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.task-grid article {
  display: flex;
  flex-direction: column;
}

.task-grid p {
  flex: 1;
}

.task-grid dl {
  display: grid;
  gap: 4px;
  margin: 8px 0 12px;
}

.task-grid dl div {
  display: flex;
  justify-content: space-between;
  color: var(--ca-muted);
  font-size: 10px;
}

.task-grid dd {
  margin: 0;
  color: var(--ca-text);
}

.history-list > div {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--ca-border);
}

.history-list strong {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.history-list span,
.guild-notice {
  color: var(--ca-muted);
  font-size: 10px;
}

.guild-notice {
  color: #9bdfb9;
  text-align: center;
}

@media (max-width: 650px) {
  .guild-card {
    grid-template-columns: auto 1fr;
  }

  .rank-panel {
    grid-column: 1 / -1;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    padding: 10px 0 0;
    border-top: 1px solid var(--ca-border);
    border-left: 0;
    text-align: left;
  }

  .task-grid {
    grid-template-columns: 1fr;
  }

  .quest-list footer {
    align-items: flex-start;
  }

  .quest-meta {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
