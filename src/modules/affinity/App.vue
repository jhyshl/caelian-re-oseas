<script setup lang="ts">
/* global window */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { GameSnapshot } from '@/domain/types';
import type { PanelContext } from '@/kernel/public-api';
import {
  AFFINITY_MAX,
  createAffinityViewModel,
} from '@/modules/affinity/view-model';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';
import AdjustableAvatar from '@/ui/AdjustableAvatar.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const characterAvatarUrl = ref('');
const characterAvatarFallbackUrl = ref('');
const error = ref('');
const disposers: Array<() => void> = [];
let refreshSequence = 0;
let avatarRetryTimer: number | undefined;
let avatarRetryIndex = 0;
let avatarDisposed = false;
const AVATAR_RETRY_DELAYS = [250, 700, 1500, 3000] as const;

const status = computed(() =>
  snapshot.value
    ? createAffinityViewModel(snapshot.value.social)
    : undefined,
);

const updatedAt = computed(() => {
  const timestamp = snapshot.value?.social.updatedAt;
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
});

async function refreshState(): Promise<void> {
  const sequence = ++refreshSequence;
  try {
    const next = await props.context.api.query('state');
    if (sequence !== refreshSequence) return;
    snapshot.value = next;
    error.value = '';
  } catch (caught) {
    if (sequence !== refreshSequence) return;
    error.value =
      caught instanceof Error ? caught.message : '凯利安状态读取失败';
  }
}

function clearAvatarRetry(): void {
  if (avatarRetryTimer === undefined) return;
  const win = props.context.document.defaultView ?? window;
  win.clearTimeout(avatarRetryTimer);
  avatarRetryTimer = undefined;
}

function scheduleAvatarRetry(): void {
  if (
    avatarDisposed ||
    avatarRetryTimer !== undefined ||
    avatarRetryIndex >= AVATAR_RETRY_DELAYS.length
  ) {
    return;
  }
  const win = props.context.document.defaultView ?? window;
  const delay = AVATAR_RETRY_DELAYS[avatarRetryIndex] ?? 3000;
  avatarRetryTimer = win.setTimeout(() => {
    avatarRetryTimer = undefined;
    avatarRetryIndex += 1;
    void refreshAvatar(true);
  }, delay);
}

async function refreshAvatar(force = false): Promise<void> {
  try {
    const next = await props.context.api.getAvatarUrls(
      force ? { refresh: 'character' } : undefined,
    );
    if (avatarDisposed) return;
    characterAvatarUrl.value =
      next.characterOriginal || next.character;
    characterAvatarFallbackUrl.value =
      next.characterOriginal && next.characterOriginal !== next.character
        ? next.character
        : '';
    if (!characterAvatarUrl.value) scheduleAvatarRetry();
  } catch {
    if (!avatarDisposed) scheduleAvatarRetry();
  }
}

async function refresh(): Promise<void> {
  await props.context.api.refreshNarrativeFromMvu();
  await Promise.all([refreshState(), refreshAvatar()]);
}

function handleCharacterAvatarError(): void {
  characterAvatarUrl.value = '';
  characterAvatarFallbackUrl.value = '';
  scheduleAvatarRetry();
}

function handleCharacterAvatarLoad(): void {
  avatarRetryIndex = 0;
  clearAvatarRetry();
}

onMounted(async () => {
  avatarDisposed = false;
  await refresh();
  disposers.push(
    props.context.api.on('state.changed', async () => {
      await refreshState();
      if (!characterAvatarUrl.value) scheduleAvatarRetry();
    }),
    props.context.api.on('tavern.changed', async ({ event }) => {
      await refreshState();
      if (event === 'CHAT_CHANGED' || event === 'CHARACTER_EDITED') {
        avatarRetryIndex = 0;
        clearAvatarRetry();
        await refreshAvatar(true);
      } else if (!characterAvatarUrl.value) {
        scheduleAvatarRetry();
      }
    }),
  );
});

onUnmounted(() => {
  avatarDisposed = true;
  clearAvatarRetry();
  refreshSequence += 1;
  for (const dispose of disposers.splice(0)) dispose();
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="affinity"
    :date="
      snapshot
        ? `${snapshot.world.gameDate} · ${snapshot.world.gameTime} · ${snapshot.world.weather}`
        : ''
    "
  >
    <div v-if="!status && !error" class="ca-empty">
      正在读取凯利安状态……
    </div>

    <section v-else-if="error" class="status-error" role="alert">
      <strong>状态暂时无法读取</strong>
      <span>{{ error }}</span>
      <button type="button" class="ca-button" @click="refresh">重新读取</button>
    </section>

    <template v-else-if="status && snapshot">
      <header class="companion-heading">
        <AdjustableAvatar
          class="crest"
          :src="characterAvatarUrl"
          :fallback-src="characterAvatarFallbackUrl"
          alt="凯利安的头像"
          fallback="C"
          preference-id="caelian"
          :teleport-target="context.document.body"
          @image-load="handleCharacterAvatarLoad"
          @image-error="handleCharacterAvatarError"
        />
        <div>
          <span>COMPANION STATUS</span>
          <h1>凯利安状态栏</h1>
          <p>
            {{ snapshot.player.name || '冒险者' }}的同行者记录
            <small v-if="updatedAt">最后同步 {{ updatedAt }}</small>
          </p>
        </div>
        <div class="sync-badge">
          <i></i>
          角色卡变量已接入
        </div>
      </header>

      <section class="legacy-status" aria-label="凯利安状态栏">
        <div class="affinity-heading">
          <div>
            <span>好感度</span>
            <strong>{{ status.affinity }}</strong>
            <small>/{{ AFFINITY_MAX }}</small>
          </div>
          <span class="stage">{{ status.relationshipStage }}</span>
        </div>

        <div
          class="affinity-track"
          role="progressbar"
          aria-label="凯利安好感度"
          :aria-valuenow="status.affinity"
          aria-valuemin="0"
          :aria-valuemax="AFFINITY_MAX"
        >
          <i :style="{ width: `${status.percent}%` }"></i>
        </div>

        <p class="milestone">
          <template v-if="status.isMaximum">
            已达到最高关系阶段
          </template>
          <template v-else>
            距离「{{ status.nextStageLabel }}」还需
            <strong>{{ status.nextStageRemaining }}</strong> 点好感度
          </template>
        </p>

        <div class="status-grid">
          <article>
            <b>情绪</b>
            <span>{{ status.mood }}</span>
          </article>
          <article>
            <b>关系</b>
            <span>{{ status.relationshipStage }}</span>
          </article>
          <article>
            <b>位置</b>
            <span>{{ status.location }}</span>
          </article>
          <article>
            <b>衣着</b>
            <span>{{ status.clothing }}</span>
          </article>
        </div>

        <article class="thought">
          <b>内心想法</b>
          <p>{{ status.innerThought }}</p>
        </article>
      </section>

      <footer class="data-note">
        <span>AI 只更新叙事字段；牌组、背包、战斗等完整数据仍保存在本地。</span>
        <button
          type="button"
          class="ca-button"
          @click="context.api.navigatePanel('character')"
        >
          打开玩家面板
        </button>
      </footer>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.companion-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 15px;
  margin-bottom: 14px;
  padding: 7px 5px;
}

.crest {
  width: 58px;
  height: 58px;
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 1px solid rgba(212, 168, 67, 0.55);
  border-radius: 50%;
  color: #f0d68a;
  background:
    radial-gradient(circle at 35% 25%, rgba(255, 238, 171, 0.36), transparent 11%),
    linear-gradient(145deg, #664719, #21170c);
  box-shadow:
    inset 0 0 0 4px rgba(255, 255, 255, 0.035),
    0 8px 24px rgba(0, 0, 0, 0.3);
  font: 700 28px/1 Georgia, serif;
}

.companion-heading > div:nth-child(2) > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.22em;
}

.companion-heading h1 {
  margin: 4px 0 5px;
  color: var(--ca-text-bright);
  font: 700 25px/1.1 var(--ca-serif);
}

.companion-heading p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
}

.companion-heading p small {
  margin-left: 9px;
  color: #6f6a62;
}

.sync-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid rgba(56, 169, 107, 0.25);
  border-radius: 999px;
  color: #89d8ab;
  background: rgba(56, 169, 107, 0.08);
  font-size: 10px;
}

.sync-badge i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #62cf94;
  box-shadow: 0 0 8px rgba(98, 207, 148, 0.65);
}

.legacy-status {
  padding: clamp(18px, 3vw, 28px);
  border: 1px solid rgba(212, 168, 67, 0.42);
  border-radius: 20px;
  color: #513414;
  background:
    radial-gradient(circle at 95% 0, rgba(212, 168, 67, 0.15), transparent 26%),
    linear-gradient(180deg, #fffdf7, #fff5e8);
  box-shadow:
    0 14px 38px rgba(0, 0, 0, 0.25),
    inset 0 1px rgba(255, 255, 255, 0.9);
}

.affinity-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.affinity-heading > div {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: #6e4517;
  font-weight: 800;
}

.affinity-heading > div > span {
  font-size: 13px;
}

.affinity-heading strong {
  color: #b96d2b;
  font: 700 clamp(27px, 5vw, 38px)/1 Georgia, serif;
}

.affinity-heading small {
  color: #a48257;
  font-size: 12px;
}

.stage {
  padding: 6px 11px;
  border: 1px solid rgba(185, 109, 43, 0.25);
  border-radius: 999px;
  color: #8b5423;
  background: rgba(212, 168, 67, 0.12);
  font-size: 11px;
  font-weight: 900;
}

.affinity-track {
  height: 12px;
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid rgba(212, 168, 67, 0.3);
  border-radius: 999px;
  background: rgba(139, 95, 39, 0.14);
}

.affinity-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background:
    linear-gradient(90deg, #c69235, #efc265 72%, #ffe6a6);
  box-shadow: 0 0 12px rgba(212, 168, 67, 0.45);
  transition: width 0.35s ease;
}

.milestone {
  margin: 8px 0 17px;
  color: #9a7142;
  font-size: 10px;
}

.milestone strong {
  color: #b96d2b;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.status-grid article {
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid rgba(212, 168, 67, 0.2);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.62);
}

.status-grid b,
.thought b {
  display: block;
  margin-bottom: 5px;
  color: #9a7142;
  font-size: 10px;
}

.status-grid span {
  display: block;
  color: #573817;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.thought {
  margin-top: 10px;
  padding: 13px 14px;
  border: 1px solid rgba(80, 52, 104, 0.14);
  border-radius: 14px;
  background: rgba(80, 52, 104, 0.065);
}

.thought b {
  color: #7d5a91;
}

.thought p {
  min-height: 1.55em;
  margin: 0;
  color: #5a3970;
  font: 600 13px/1.65 var(--ca-serif);
  overflow-wrap: anywhere;
}

.data-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 5px 0;
  color: var(--ca-muted);
  font-size: 10px;
}

.status-error {
  display: grid;
  justify-items: start;
  gap: 8px;
  padding: 18px;
  border: 1px solid rgba(201, 74, 67, 0.35);
  border-radius: 14px;
  color: #e9b1ad;
  background: rgba(201, 74, 67, 0.09);
}

.status-error span {
  font-size: 11px;
}

@media (max-width: 620px) {
  .companion-heading {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 11px;
  }

  .crest {
    width: 48px;
    height: 48px;
    font-size: 23px;
  }

  .companion-heading h1 {
    font-size: 20px;
  }

  .companion-heading p small {
    display: block;
    margin: 4px 0 0;
  }

  .sync-badge {
    grid-column: 1 / 3;
    width: fit-content;
  }

  .legacy-status {
    padding: 16px;
    border-radius: 15px;
  }

  .status-grid {
    grid-template-columns: 1fr;
    gap: 7px;
  }

  .data-note {
    align-items: stretch;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .affinity-track i {
    transition: none;
  }
}
</style>
