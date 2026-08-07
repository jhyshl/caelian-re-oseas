<script setup lang="ts">
/* global KeyboardEvent */
import { onMounted, onUnmounted } from 'vue';
import { releaseNotesFor } from '@/content/release-notes';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const runtime = props.context.api.getRuntimeInfo();
const releases = releaseNotesFor(runtime.channel, runtime.version);
const currentRelease = releases[0];
let previousBodyOverflow = '';
let previousRootOverflow = '';

function close(): void {
  void props.context.api.closePanel('release-notes');
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

onMounted(() => {
  const document = props.context.document;
  previousBodyOverflow = document.body.style.overflow;
  previousRootOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  const document = props.context.document;
  document.body.style.overflow = previousBodyOverflow;
  document.documentElement.style.overflow = previousRootOverflow;
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="release-overlay">
    <section
      class="release-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-title"
    >
      <header class="release-header">
        <div class="release-heading">
          <span>UPDATE COMPLETE</span>
          <h1 id="release-title">版本更新公告</h1>
          <p v-if="currentRelease">
            已更新至 <strong>{{ currentRelease.label }}</strong>
            <code>{{ runtime.version }}</code>
          </p>
        </div>
        <button
          type="button"
          class="close-button"
          aria-label="关闭更新公告"
          @click="close"
        >
          ×
        </button>
      </header>

      <div class="release-list">
        <article
          v-for="(release, releaseIndex) in releases"
          :key="release.version"
          class="release-card"
          :class="{ current: releaseIndex === 0 }"
        >
          <div class="version-rail" aria-hidden="true">
            <span>{{ String(releases.length - releaseIndex).padStart(2, '0') }}</span>
          </div>
          <div class="release-content">
            <header>
              <div>
                <span v-if="releaseIndex === 0" class="current-badge">
                  当前版本
                </span>
                <h2>{{ release.label }}</h2>
              </div>
              <time :datetime="release.releasedAt">{{ release.releasedAt }}</time>
            </header>
            <code>{{ release.version }}</code>
            <ol>
              <li v-for="change in release.changes" :key="change">
                {{ change }}
              </li>
            </ol>
          </div>
        </article>
      </div>

      <footer class="release-footer">
        <p>这里会保留全部历史版本公告；之后可从悬浮面板的“公告”入口随时重读。</p>
        <button type="button" @click="close">知道了，开始冒险</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.release-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  overflow: auto;
  color: #ddd6ca;
  background:
    radial-gradient(circle at 50% 20%, rgba(149, 113, 47, 0.18), transparent 36%),
    rgba(4, 5, 8, 0.8);
  backdrop-filter: blur(8px);
  font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}

.release-dialog {
  width: min(760px, calc(100vw - 28px));
  max-height: calc(100vh - 36px);
  overflow: auto;
  border: 1px solid rgba(212, 168, 67, 0.48);
  border-radius: 22px;
  background:
    linear-gradient(135deg, rgba(212, 168, 67, 0.08), transparent 30%),
    #101218;
  box-shadow: 0 32px 100px rgba(0, 0, 0, 0.72);
}

.release-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 24px 26px 19px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(16, 18, 24, 0.96);
}

.release-heading > span {
  color: #d4a843;
  font-size: 9px;
  letter-spacing: 0.22em;
}

.release-heading h1 {
  margin: 5px 0 8px;
  color: #f5ead0;
  font: 700 27px Georgia, "Noto Serif SC", serif;
}

.release-heading p {
  margin: 0;
  color: #989187;
  font-size: 11px;
}

.release-heading strong {
  color: #e6c76f;
}

.release-heading code {
  margin-left: 7px;
  color: #817a70;
  font-size: 9px;
}

.close-button {
  padding: 0 5px;
  border: 0;
  color: #8e887f;
  background: transparent;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
}

.close-button:hover {
  color: #f0d68a;
}

.release-list {
  display: grid;
  gap: 11px;
  padding: 18px 22px 6px;
}

.release-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid #292d35;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.018);
}

.release-card.current {
  border-color: rgba(212, 168, 67, 0.52);
  background: rgba(212, 168, 67, 0.055);
  box-shadow: inset 0 0 0 1px rgba(212, 168, 67, 0.04);
}

.version-rail {
  display: grid;
  place-items: center;
  color: #565961;
  background: rgba(0, 0, 0, 0.17);
  font: 700 11px/1 Georgia, serif;
  letter-spacing: 0.08em;
}

.current .version-rail {
  color: #d4a843;
  background: rgba(212, 168, 67, 0.08);
}

.release-content {
  padding: 14px 16px 15px;
}

.release-content > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.release-content > header > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.release-content h2 {
  margin: 0;
  color: #e6dfd4;
  font: 700 16px Georgia, "Noto Serif SC", serif;
}

.release-content time {
  color: #686a70;
  font-size: 9px;
}

.release-content > code {
  display: inline-block;
  margin-top: 4px;
  color: #74767d;
  font-size: 8px;
}

.current-badge {
  padding: 3px 6px;
  border: 1px solid rgba(212, 168, 67, 0.42);
  border-radius: 999px;
  color: #dfbd61;
  background: rgba(212, 168, 67, 0.08);
  font-size: 8px;
}

.release-content ol {
  display: grid;
  gap: 5px;
  margin: 11px 0 0;
  padding-left: 21px;
  color: #aaa399;
  font-size: 10px;
  line-height: 1.55;
}

.release-content li::marker {
  color: #8c7440;
}

.release-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px 20px;
  background: linear-gradient(transparent, #101218 24%);
}

.release-footer p {
  margin: 0;
  color: #74716c;
  font-size: 9px;
}

.release-footer button {
  min-width: 148px;
  padding: 11px 17px;
  border: 1px solid #d4a843;
  border-radius: 9px;
  color: #1b150a;
  background: linear-gradient(180deg, #e2bd61, #bb8c2c);
  font: 700 11px inherit;
  cursor: pointer;
}

@media (max-width: 600px) {
  .release-overlay {
    align-items: start;
    padding: 9px;
  }

  .release-dialog {
    width: 100%;
    max-height: calc(100vh - 18px);
    border-radius: 16px;
  }

  .release-header {
    padding: 19px 17px 16px;
  }

  .release-heading h1 {
    font-size: 23px;
  }

  .release-list {
    padding: 13px 12px 4px;
  }

  .release-card {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .release-content {
    padding: 12px;
  }

  .release-content > header {
    align-items: center;
  }

  .release-content time {
    display: none;
  }

  .release-footer {
    align-items: stretch;
    flex-direction: column;
    padding: 14px 12px 15px;
  }

  .release-footer button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .release-overlay {
    backdrop-filter: none;
  }
}
</style>
