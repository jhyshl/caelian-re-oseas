<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const expanded = ref(false);
const info = computed(() => props.context.api.getRuntimeInfo());

function open(panel: 'character' | 'inventory' | 'diagnostics') {
  if (info.value.status !== 'ready' && panel !== 'diagnostics') return;
  void props.context.api.openPanel(panel);
  expanded.value = false;
}
</script>

<template>
  <div class="shell">
    <div v-if="expanded" class="menu" role="menu">
      <header>
        <span>Re∞：欧西亚斯</span>
        <small>{{ info.version }}</small>
      </header>
      <p v-if="info.status !== 'ready'" class="warning">
        {{ info.lastError || `内核状态：${info.status}` }}
      </p>
      <button
        type="button"
        :disabled="info.status !== 'ready'"
        @click="open('character')"
      >
        <span>人物</span><small>AI 摘要</small>
      </button>
      <button
        type="button"
        :disabled="info.status !== 'ready'"
        @click="open('inventory')"
      >
        <span>背包</span><small>仅本地</small>
      </button>
      <button type="button" @click="open('diagnostics')">
        <span>诊断</span><small>Alpha</small>
      </button>
    </div>
    <button
      type="button"
      class="orb"
      :aria-expanded="expanded"
      aria-label="打开 Re∞：欧西亚斯"
      @click="expanded = !expanded"
    >
      <span>∞</span>
      <i :class="{ ready: info.status === 'ready' }"></i>
    </button>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
}
.orb {
  position: relative;
  width: 58px;
  height: 58px;
  border: 1px solid rgba(221, 194, 255, 0.68);
  border-radius: 50%;
  color: #fff;
  background:
    radial-gradient(circle at 34% 28%, #b58be4 0 8%, transparent 9%),
    linear-gradient(145deg, #57406f, #22192f);
  box-shadow: 0 14px 34px rgba(13, 8, 22, 0.45);
  cursor: pointer;
}
.orb span {
  font-size: 28px;
}
.orb i {
  position: absolute;
  right: 2px;
  bottom: 5px;
  width: 10px;
  height: 10px;
  border: 2px solid #281e35;
  border-radius: 50%;
  background: #e8a347;
}
.orb i.ready {
  background: #67d49a;
}
.menu {
  position: absolute;
  right: 0;
  bottom: 70px;
  width: 246px;
  padding: 12px;
  border: 1px solid rgba(199, 165, 240, 0.45);
  border-radius: 18px;
  color: #f8f2ff;
  background: rgba(24, 18, 34, 0.96);
  box-shadow: 0 18px 50px rgba(8, 4, 14, 0.5);
  backdrop-filter: blur(14px);
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 5px 7px 11px;
}
header span {
  font-weight: 700;
}
small {
  color: #bcaaca;
}
.menu > button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding: 11px 12px;
  border: 0;
  border-radius: 12px;
  color: #f6efff;
  background: rgba(116, 84, 147, 0.2);
  cursor: pointer;
}
.menu > button:hover {
  background: rgba(143, 104, 181, 0.34);
}
.menu > button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}
.warning {
  margin: 0 6px 8px;
  padding: 9px;
  border-radius: 10px;
  color: #ffd9bf;
  background: rgba(156, 71, 42, 0.25);
  font-size: 12px;
  line-height: 1.45;
}
</style>
