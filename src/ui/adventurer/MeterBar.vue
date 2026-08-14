<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    max: number;
    color?: string;
    previewDelta?: number;
  }>(),
  {
    color: 'var(--ca-gold)',
    previewDelta: 0,
  },
);

const clampValue = (value: number) =>
  props.max > 0 ? Math.max(0, Math.min(props.max, value)) : 0;
const currentValue = computed(() => clampValue(props.value));
const previewValue = computed(() => clampValue(props.value + props.previewDelta));
const effectivePreviewDelta = computed(
  () => previewValue.value - currentValue.value,
);
const percent = computed(() =>
  props.max > 0 ? (currentValue.value / props.max) * 100 : 0,
);
const previewPercent = computed(() =>
  props.max > 0 ? (previewValue.value / props.max) * 100 : 0,
);
const previewStyle = computed(() => ({
  left: `${Math.min(percent.value, previewPercent.value)}%`,
  width: `${Math.abs(previewPercent.value - percent.value)}%`,
}));
</script>

<template>
  <div
    class="ca-meter"
    :class="{
      'is-preview': effectivePreviewDelta !== 0,
      'is-loss': effectivePreviewDelta < 0,
      'is-recovery': effectivePreviewDelta > 0,
    }"
  >
    <div class="ca-meter-header">
      <span>{{ label }}</span>
      <b v-if="effectivePreviewDelta !== 0">
        预计 {{ effectivePreviewDelta > 0 ? '+' : '−'
        }}{{ Math.abs(Math.round(effectivePreviewDelta)) }} ·
        {{ Math.round(previewValue) }} / {{ Math.round(max) }}
      </b>
      <b v-else>{{ Math.round(value) }} / {{ Math.round(max) }}</b>
    </div>
    <div class="ca-meter-track">
      <i class="ca-meter-fill" :style="{ width: `${percent}%`, background: color }"></i>
      <i
        v-if="effectivePreviewDelta !== 0"
        class="ca-meter-preview"
        :style="previewStyle"
      ></i>
      <span v-if="effectivePreviewDelta !== 0">
        {{ Math.round(previewValue) }} / {{ Math.round(max) }}
      </span>
      <span v-else>{{ Math.round(percent) }}%</span>
    </div>
  </div>
</template>

<style scoped>
.ca-meter-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  color: var(--ca-muted);
  font-size: 10px;
}

.ca-meter-header b {
  color: var(--ca-text-bright);
  font: 700 11px/1 var(--ca-serif);
}

.ca-meter-track {
  position: relative;
  height: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.4);
}

.ca-meter-fill {
  position: relative;
  z-index: 1;
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.25s ease;
}

.ca-meter-preview {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  display: block;
  pointer-events: none;
}

.ca-meter.is-loss .ca-meter-preview {
  background: linear-gradient(90deg, rgba(255, 245, 110, 0.98), rgba(255, 190, 45, 0.96));
  box-shadow: 0 0 10px rgba(255, 238, 92, 0.78);
}

.ca-meter.is-recovery .ca-meter-preview {
  background: linear-gradient(90deg, rgba(85, 232, 137, 0.94), rgba(143, 255, 183, 0.98));
  box-shadow: 0 0 10px rgba(91, 247, 151, 0.72);
}

.ca-meter.is-preview .ca-meter-track {
  animation: ca-meter-preview-pulse 0.72s ease-in-out infinite alternate;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2), 0 0 14px rgba(255, 226, 91, 0.46);
}

.ca-meter-track span {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.82);
  font-size: 8px;
  font-weight: 800;
  text-shadow: 0 1px 2px #000;
}

@keyframes ca-meter-preview-pulse {
  from {
    filter: brightness(1);
    outline: 1px solid rgba(255, 255, 255, 0.08);
  }
  to {
    filter: brightness(1.34);
    outline: 2px solid rgba(255, 244, 120, 0.78);
  }
}
</style>
