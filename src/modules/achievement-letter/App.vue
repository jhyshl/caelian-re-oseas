<script setup lang="ts">
/* global KeyboardEvent */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  AchievementSpecialState,
  GameSnapshot,
} from '@/domain/types';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const special = ref<AchievementSpecialState>();
const stage = ref<'loading' | 'envelope' | 'letter' | 'gift' | 'creator-gift'>('loading');
const busy = ref(false);
const error = ref('');
let previousBodyOverflow = '';
let previousRootOverflow = '';

const playerName = computed(
  () => snapshot.value?.player.name.trim() || '冒险者',
);

function commandId(kind: string): string {
  return `achievement-special:${kind}:${Date.now()}`;
}

async function refresh(): Promise<void> {
  [snapshot.value, special.value] = await Promise.all([
    props.context.api.query('state'),
    props.context.api.query('achievement-special'),
  ]);
}

async function openLetter(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.context.api.execute({
      id: commandId('claim-letter'),
      type: 'achievement.claim-poem-letter',
      payload: {},
    });
    if (result.status === 'rejected') {
      throw new Error(result.message || '信件开启失败');
    }
    await refresh();
    stage.value = 'letter';
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}

async function claimDailyGift(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.context.api.execute({
      id: commandId('daily-gift'),
      type: 'achievement.claim-daily-gift',
      payload: {},
    });
    if (result.status === 'rejected') {
      throw new Error(result.message || '今日赠礼领取失败');
    }
    await refresh();
    stage.value = 'gift';
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}

async function claimCreatorGift(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.context.api.execute({
      id: commandId('creator-gift'),
      type: 'achievement.claim-creator-gift',
      payload: {},
    });
    if (result.status === 'rejected') {
      throw new Error(result.message || '特殊赠礼领取失败');
    }
    await refresh();
    stage.value = 'creator-gift';
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}

async function continueFromLetter(): Promise<void> {
  if (special.value?.creatorGiftAvailable) {
    await claimCreatorGift();
    return;
  }
  if (special.value?.dailyGiftAvailable) {
    await claimDailyGift();
    return;
  }
  close();
}

async function continueFromCreatorGift(): Promise<void> {
  if (!special.value?.letterClaimed) {
    stage.value = 'envelope';
    return;
  }
  if (special.value.dailyGiftAvailable) {
    await claimDailyGift();
    return;
  }
  close();
}

function close(): void {
  void props.context.api.closePanel('achievement-letter');
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !busy.value) close();
}

onMounted(async () => {
  const document = props.context.document;
  previousBodyOverflow = document.body.style.overflow;
  previousRootOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', handleKeydown);

  try {
    await refresh();
    if (special.value?.creatorGiftAvailable) {
      await claimCreatorGift();
    } else if (!special.value?.letterClaimed) {
      stage.value = 'envelope';
    } else if (special.value.dailyGiftAvailable) {
      await claimDailyGift();
    } else {
      stage.value = 'letter';
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
    stage.value = 'letter';
  }
});

onUnmounted(() => {
  const document = props.context.document;
  document.body.style.overflow = previousBodyOverflow;
  document.documentElement.style.overflow = previousRootOverflow;
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="poem-overlay">
    <button
      v-if="stage === 'envelope'"
      type="button"
      class="envelope"
      :disabled="busy"
      aria-label="打开写给今昔的感谢信"
      @click="openLetter"
    >
      <span class="flap"></span>
      <span class="seal">✉</span>
      <strong>一封写给今昔的感谢信</strong>
      <small>{{ busy ? '正在开启……' : '点击打开' }}</small>
    </button>

    <section
      v-else
      class="poem-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="poem-title"
    >
      <header>
        <div>
          <span>PAST &amp; PRESENT</span>
          <h1 id="poem-title">
            {{ stage === 'creator-gift' ? '江海有声 · 特殊赠礼' : stage === 'gift' ? '空白的书页 · 今日赠礼' : '写给今昔的感谢信' }}
          </h1>
        </div>
        <button
          type="button"
          class="close"
          aria-label="关闭"
          :disabled="busy"
          @click="close"
        >
          ×
        </button>
      </header>

      <div v-if="stage === 'loading'" class="loading">正在展开信纸……</div>

      <div v-else-if="stage === 'creator-gift'" class="gift-body">
        <div class="gift-mark">✦</div>
        <p>收到一份来自江海有声的特殊赠礼~</p>
        <div class="gift-list">
          <span>金币 × {{ special?.creatorGiftGold ?? 0 }}</span>
          <span>小血瓶合成材料包 × 10</span>
          <span>小魔药瓶合成材料包 × 10</span>
          <span>小血瓶 × 15</span>
          <span>小魔药瓶 × 15</span>
        </div>
        <p class="signature">江海有声</p>
        <button type="button" class="primary" @click="continueFromCreatorGift">收下赠礼</button>
      </div>

      <div v-else-if="stage === 'gift'" class="gift-body">
        <div class="gift-mark">♛</div>
        <p>特莱奥今天不知道从哪里为你找来了这些东西：</p>
        <div class="gift-list">
          <span
            v-for="item in special?.lastDailyGiftItems ?? []"
            :key="item.itemId"
          >
            {{ item.name }} × {{ item.quantity }}
          </span>
        </div>
        <button type="button" class="primary" @click="close">收下赠礼</button>
      </div>

      <div v-else class="letter-body">
        <p>亲爱的{{ playerName }}：</p>
        <p class="indent">
          在新的冒险，新的篇章，感谢你的支持，感谢我们的相遇。是你的支持与反馈让欧西亚斯一步步走到今天，变得更加美好。同样的，也是你的爱让凯利安与欧西亚斯的一切不再是数据，而成为了鲜活他与他们。
        </p>
        <p class="indent">
          向着更光明的未来出发吧，前路与冒险都愿美好与你同在，愿荣光的诗行与你共同写就。
        </p>
        <p class="indent">再次感谢，爱你，爱你们，爱世界。</p>
        <p class="signature">江海有声</p>
        <p class="reward">
          获得：金币1834，特殊藏品：空白的书页；成就：今昔的诗行
        </p>
        <button
          type="button"
          class="primary"
          :disabled="busy"
          @click="continueFromLetter"
        >
          {{ busy ? '正在领取……' : '继续冒险' }}
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
.poem-overlay {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  padding: max(14px, env(safe-area-inset-top))
    max(14px, env(safe-area-inset-right))
    max(14px, env(safe-area-inset-bottom))
    max(14px, env(safe-area-inset-left));
  overflow: auto;
  background:
    radial-gradient(circle at 50% 24%, rgba(239, 200, 101, 0.2), transparent 36%),
    rgba(18, 10, 28, 0.66);
  backdrop-filter: blur(6px);
  font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}

.envelope {
  position: relative;
  width: min(430px, calc(100vw - 28px));
  min-height: 258px;
  overflow: hidden;
  border: 1px solid rgba(238, 203, 116, 0.78);
  border-radius: 22px;
  color: #5b3516;
  background: #fff7e8;
  box-shadow: 0 24px 78px rgba(0, 0, 0, 0.48);
  cursor: pointer;
  animation: pop 0.36s cubic-bezier(0.18, 1.08, 0.22, 1);
}

.envelope::after {
  position: absolute;
  inset: auto 0 0;
  z-index: 1;
  height: 61%;
  background: linear-gradient(135deg, #fffaf0, #efd5a3);
  clip-path: polygon(0 0, 50% 48%, 100% 0, 100% 100%, 0 100%);
  content: "";
}

.flap {
  position: absolute;
  inset: 0 -10% auto;
  z-index: 2;
  height: 59%;
  background: linear-gradient(135deg, #fff0ad, #d4a843);
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}

.seal {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 4;
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border: 2px solid rgba(238, 203, 116, 0.9);
  border-radius: 50%;
  color: #f7dd91;
  background: #311848;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
  font-size: 29px;
  transform: translate(-50%, -50%);
}

.envelope strong,
.envelope small {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 4;
  text-align: center;
}

.envelope strong {
  bottom: 34px;
  font-size: 13px;
}

.envelope small {
  bottom: 18px;
  opacity: 0.72;
}

.poem-dialog {
  width: min(560px, calc(100vw - 28px));
  max-height: calc(100dvh - 28px);
  overflow: auto;
  border: 1px solid rgba(238, 203, 116, 0.66);
  border-radius: 22px;
  color: #4b2b15;
  background: #fffaf2;
  box-shadow: 0 24px 78px rgba(0, 0, 0, 0.48);
  animation: open 0.38s cubic-bezier(0.18, 1.08, 0.22, 1);
}

.poem-dialog > header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
  border-bottom: 1px solid rgba(238, 203, 116, 0.42);
  color: #f7dd91;
  background: #311848;
}

.poem-dialog > header span {
  font-size: 8px;
  letter-spacing: 0.18em;
  opacity: 0.76;
}

.poem-dialog h1 {
  margin: 3px 0 0;
  font: 700 17px Georgia, "Noto Serif SC", serif;
}

.close {
  width: 31px;
  height: 31px;
  border: 0;
  border-radius: 10px;
  color: #f7dd91;
  background: rgba(255, 255, 255, 0.12);
  font-size: 18px;
  cursor: pointer;
}

.letter-body,
.gift-body,
.loading {
  padding: 20px;
  font-size: 14px;
  line-height: 1.82;
}

.letter-body p {
  margin: 0 0 14px;
}

.indent {
  text-indent: 2em;
}

.signature {
  text-align: right;
  font-weight: 700;
}

.reward {
  padding: 12px;
  border: 1px solid rgba(212, 168, 67, 0.38);
  border-radius: 15px;
  color: #7b4b16;
  background: rgba(212, 168, 67, 0.13);
  text-align: center;
  font-weight: 900;
}

.gift-body {
  text-align: center;
}

.gift-mark {
  color: #8d6218;
  font: 700 38px Georgia, serif;
}

.gift-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 14px 0 20px;
  padding: 12px;
  border: 1px solid rgba(212, 168, 67, 0.34);
  border-radius: 15px;
  background: rgba(212, 168, 67, 0.1);
}

.gift-list span {
  padding: 6px 10px;
  border: 1px solid rgba(212, 168, 67, 0.42);
  border-radius: 999px;
  color: #704315;
  background: #fff4d6;
  font-weight: 800;
}

.primary {
  width: 100%;
  padding: 11px 16px;
  border: 1px solid #5d306f;
  border-radius: 10px;
  color: #fff0bd;
  background: linear-gradient(180deg, #553064, #311848);
  font: 700 12px inherit;
  cursor: pointer;
}

.error {
  margin: 0 20px 18px;
  color: #a12626;
  font-size: 11px;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.86) translateY(12px);
  }
}

@keyframes open {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
}

@media (max-width: 600px) {
  .poem-dialog {
    width: 100%;
    max-height: calc(100dvh - 18px);
    border-radius: 16px;
  }

  .letter-body,
  .gift-body {
    padding: 17px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .envelope,
  .poem-dialog {
    animation: none;
  }

  .poem-overlay {
    backdrop-filter: none;
  }
}
</style>
