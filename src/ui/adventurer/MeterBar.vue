<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    max: number;
    color?: string;
  }>(),
  {
    color: 'var(--ca-gold)',
  },
);

const percent = computed(() =>
  props.max > 0
    ? Math.max(0, Math.min(100, (props.value / props.max) * 100))
    : 0,
);
</script>

<template>
  <div class="ca-meter">
    <div class="ca-meter-header">
      <span>{{ label }}</span>
      <b>{{ Math.round(value) }} / {{ Math.round(max) }}</b>
    </div>
    <div class="ca-meter-track">
      <i :style="{ width: `${percent}%`, background: color }"></i>
      <span>{{ Math.round(percent) }}%</span>
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

.ca-meter-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.25s ease;
}

.ca-meter-track span {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.82);
  font-size: 8px;
  font-weight: 800;
  text-shadow: 0 1px 2px #000;
}
</style>
