<script setup lang="ts">
/* global HTMLElement */
import type { CollectibleDetails } from '@/modules/inventory/collectible-details';

defineProps<{
  details: CollectibleDetails;
  teleportTarget: HTMLElement;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport :to="teleportTarget">
    <div class="collectible-detail-overlay" @click.self="emit('close')">
      <section
        class="collectible-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collectible-detail-title"
      >
        <header>
          <div class="collectible-detail-mark" aria-hidden="true">
            {{ details.kind === 'special' ? '✧' : '✦' }}
          </div>
          <div>
            <small>
              {{ details.kind === 'special' ? 'SPECIAL COLLECTIBLE' : 'COLLECTIBLE' }}
            </small>
            <h2 id="collectible-detail-title">{{ details.name }}</h2>
          </div>
          <button
            type="button"
            class="collectible-detail-close"
            aria-label="关闭藏品详情"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="collectible-detail-body">
          <section>
            <small>展示文本</small>
            <p data-collectible-display-text>{{ details.displayText }}</p>
          </section>
          <section v-if="details.kind === 'special'" class="effect-block">
            <small>效果文本</small>
            <p data-collectible-effect-text>{{ details.effectText }}</p>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.collectible-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  place-items: center;
  padding: 18px;
  color: var(--ca-text, #e8e0d4);
  background: rgba(3, 5, 8, 0.76);
  font-family: var(--ca-ui, "Noto Sans SC", "Microsoft YaHei", sans-serif);
  backdrop-filter: blur(7px);
}

.collectible-detail-dialog {
  width: min(520px, 100%);
  max-height: calc(100dvh - 36px);
  overflow: auto;
  border: 1px solid var(--ca-border-light, #3a4055);
  border-radius: 18px;
  background:
    radial-gradient(circle at 14% 0, rgba(212, 168, 67, 0.13), transparent 34%),
    var(--ca-bg, #0d0f14);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.65);
}

.collectible-detail-dialog > header {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) 36px;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border-bottom: 1px solid var(--ca-border, #2a2f3d);
}

.collectible-detail-mark {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ca-gold, #d4a843) 55%, transparent);
  border-radius: 13px;
  color: var(--ca-gold-light, #f0d68a);
  background: color-mix(in srgb, var(--ca-gold, #d4a843) 12%, transparent);
  font-size: 22px;
}

.collectible-detail-dialog header small,
.collectible-detail-body small {
  color: var(--ca-gold, #d4a843);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.collectible-detail-dialog h2 {
  margin: 3px 0 0;
  color: var(--ca-text-bright, #fff5e6);
  font: 700 22px/1.25 var(--ca-serif, Georgia, serif);
}

.collectible-detail-close {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--ca-border, #2a2f3d);
  border-radius: 50%;
  color: var(--ca-muted, #938d82);
  background: var(--ca-surface, #161a24);
  font: 400 22px/1 inherit;
  cursor: pointer;
}

.collectible-detail-close:hover {
  border-color: var(--ca-gold, #d4a843);
  color: var(--ca-gold-light, #f0d68a);
}

.collectible-detail-body {
  display: grid;
  gap: 10px;
  padding: 18px;
}

.collectible-detail-body section {
  padding: 14px 15px;
  border: 1px solid var(--ca-border, #2a2f3d);
  border-radius: 12px;
  background: var(--ca-surface, #161a24);
}

.collectible-detail-body section.effect-block {
  border-color: color-mix(in srgb, var(--ca-gold, #d4a843) 46%, transparent);
  background: color-mix(in srgb, var(--ca-gold, #d4a843) 7%, var(--ca-surface, #161a24));
}

.collectible-detail-body p {
  margin: 7px 0 0;
  color: var(--ca-text, #e8e0d4);
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
}

@media (max-width: 520px) {
  .collectible-detail-overlay {
    align-items: end;
    padding: 0;
  }

  .collectible-detail-dialog {
    width: 100%;
    max-height: min(82dvh, 640px);
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 18px 18px 0 0;
  }
}
</style>
