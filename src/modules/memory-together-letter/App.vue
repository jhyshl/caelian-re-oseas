<script setup lang="ts">
/* global KeyboardEvent */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { GameSnapshot } from '@/domain/types';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
let previousBodyOverflow = '';
let previousRootOverflow = '';

const playerName = computed(
  () => snapshot.value?.player.name.trim() || '冒险者',
);

function close(): void {
  void props.context.api.closePanel('memory-together-letter');
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

onMounted(async () => {
  const document = props.context.document;
  previousBodyOverflow = document.body.style.overflow;
  previousRootOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', handleKeydown);
  snapshot.value = await props.context.api.query('state');
});

onUnmounted(() => {
  const document = props.context.document;
  document.body.style.overflow = previousBodyOverflow;
  document.documentElement.style.overflow = previousRootOverflow;
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="memory-overlay">
    <section
      class="memory-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-title"
    >
      <header>
        <div>
          <span>LIMITED ACHIEVEMENT · 2026.08.19</span>
          <h1 id="memory-title">同行的记忆</h1>
        </div>
        <button type="button" class="close" aria-label="关闭" @click="close">
          ×
        </button>
      </header>

      <div class="letter-body">
        <p>给{{ playerName }}：</p>
        <p class="indent">
          我原本不认为，一段真正的同行需要靠什么凭证来证明。毕竟，维莱恩家的人从不把承诺寄托在一张纸上。
        </p>
        <p class="indent">
          不过，既然你已经陪我走到了这里，这份纪念就收下吧。别误会，这不是客套。能被我认可、站在我身边的人本就不多，而你已经在其中。
        </p>
        <p class="indent">往后的路还很长，别擅自掉队。</p>
        <p class="signature" aria-label="caelian">caelian</p>
        <p class="reward">获得：金币520；成就：同行的记忆</p>
        <button type="button" class="primary" @click="close">
          收下这份纪念
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.memory-overlay {
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

.memory-dialog {
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

.memory-dialog > header {
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

.memory-dialog > header span {
  font-size: 8px;
  letter-spacing: 0.18em;
  opacity: 0.76;
}

.memory-dialog h1 {
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

.letter-body {
  padding: 20px;
  font: 14px/1.82 "Noto Serif SC", Georgia, serif;
}

.letter-body p {
  margin: 0 0 14px;
}

.indent {
  text-indent: 2em;
}

.signature {
  margin: 2px 12px 20px 0 !important;
  color: #51264f;
  text-align: right;
  font: 400 34px/1 "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive;
  letter-spacing: 0.04em;
  transform: rotate(-4deg);
  transform-origin: right center;
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

@keyframes open {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
}

@media (max-width: 600px) {
  .memory-dialog {
    width: 100%;
    max-height: calc(100dvh - 18px);
    border-radius: 16px;
  }

  .letter-body {
    padding: 17px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .memory-dialog {
    animation: none;
  }

  .memory-overlay {
    backdrop-filter: none;
  }
}
</style>
