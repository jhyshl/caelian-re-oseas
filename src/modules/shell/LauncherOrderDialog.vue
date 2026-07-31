<script setup lang="ts">
/* global HTMLElement */
import type { PanelName } from '@/kernel/public-api';

const props = defineProps<{
  items: Array<{ panel: PanelName; icon: string; label: string }>;
  selected: PanelName[];
  teleportTarget: HTMLElement;
}>();
const emit = defineEmits<{
  toggle: [panel: PanelName];
  clear: [];
  reset: [];
  cancel: [];
  save: [];
}>();

function orderNumber(panel: PanelName): number | undefined {
  const index = props.selected.indexOf(panel);
  return index >= 0 ? index + 1 : undefined;
}
</script>

<template>
  <Teleport :to="teleportTarget">
    <div class="order-dialog-backdrop" @pointerdown.self="emit('cancel')">
      <section
        class="order-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launcher-order-title"
      >
        <header>
          <div>
            <small>LAUNCHER ORDER</small>
            <h2 id="launcher-order-title">自定义入口顺序</h2>
          </div>
          <button
            type="button"
            aria-label="关闭入口排序"
            @click="emit('cancel')"
          >
            ×
          </button>
        </header>

        <p class="order-dialog-hint">
          按你希望的顺序依次点击入口，角标会显示 1、2、3……。已选择入口排在最前，其余入口保持当前顺序。
        </p>

        <div class="order-pick-grid">
          <button
            v-for="item in items"
            :key="item.panel"
            type="button"
            :class="{ selected: orderNumber(item.panel) }"
            :aria-pressed="Boolean(orderNumber(item.panel))"
            @click="emit('toggle', item.panel)"
          >
            <i v-if="orderNumber(item.panel)">
              {{ orderNumber(item.panel) }}
            </i>
            <b>{{ item.icon }}</b>
            <span>{{ item.label }}</span>
          </button>
        </div>

        <footer class="order-dialog-actions">
          <button type="button" @click="emit('clear')">清空选择</button>
          <button type="button" @click="emit('reset')">恢复默认</button>
          <span></span>
          <button type="button" @click="emit('cancel')">取消</button>
          <button type="button" class="primary" @click="emit('save')">
            保存排序
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.order-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  place-items: center;
  padding: 16px;
  color: #e8e0d4;
  background: rgba(4, 5, 8, 0.78);
  font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  backdrop-filter: blur(8px);
}

.order-dialog {
  width: min(620px, 100%);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 18px;
  border: 1px solid rgba(212, 168, 67, 0.46);
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 0, rgba(212, 168, 67, 0.14), transparent 38%),
    #111318;
  box-shadow: 0 26px 90px rgba(0, 0, 0, 0.68);
}

.order-dialog > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.order-dialog > header small {
  color: #d4a843;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.order-dialog h2 {
  margin: 4px 0 0;
  color: #fff5e6;
  font: 700 22px/1.2 Georgia, "Noto Serif SC", serif;
}

.order-dialog > header > button {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #343843;
  border-radius: 50%;
  color: #b9b0a2;
  background: rgba(255, 255, 255, 0.035);
  font: 400 22px/1 inherit;
  cursor: pointer;
}

.order-dialog-hint {
  margin: 14px 0;
  padding: 10px 12px;
  border: 1px solid rgba(212, 168, 67, 0.16);
  border-radius: 10px;
  color: #aaa397;
  background: rgba(212, 168, 67, 0.045);
  font-size: 11px;
  line-height: 1.6;
}

.order-pick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.order-pick-grid > button {
  position: relative;
  min-height: 76px;
  display: grid;
  place-items: center;
  gap: 3px;
  padding: 10px 6px;
  border: 1px solid #2d323d;
  border-radius: 12px;
  color: #aaa397;
  background: rgba(255, 255, 255, 0.025);
  font: inherit;
  cursor: pointer;
}

.order-pick-grid > button:hover,
.order-pick-grid > button.selected {
  border-color: rgba(212, 168, 67, 0.72);
  color: #f0d68a;
  background: rgba(212, 168, 67, 0.1);
}

.order-pick-grid > button > i {
  position: absolute;
  top: 5px;
  right: 5px;
  min-width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  padding: 0 4px;
  border-radius: 8px;
  color: #21170c;
  background: linear-gradient(135deg, #f6df9f, #c8922e);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  font: normal 800 10px/1 inherit;
}

.order-pick-grid > button > b {
  color: currentColor;
  font-size: 22px;
  font-weight: 400;
}

.order-pick-grid > button > span {
  font-size: 10px;
}

.order-dialog-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
}

.order-dialog-actions > span {
  flex: 1;
}

.order-dialog-actions button {
  min-height: 34px;
  padding: 7px 11px;
  border: 1px solid #343843;
  border-radius: 8px;
  color: #aaa397;
  background: rgba(255, 255, 255, 0.025);
  font: 700 10px/1 inherit;
  cursor: pointer;
}

.order-dialog-actions button:hover {
  border-color: rgba(212, 168, 67, 0.55);
  color: #f0d68a;
}

.order-dialog-actions button.primary {
  border-color: #9d7528;
  color: #1c160d;
  background: linear-gradient(135deg, #f0d68a, #d4a843);
}

@media (max-width: 520px) {
  .order-dialog-backdrop {
    align-items: end;
    padding: 0;
  }

  .order-dialog {
    width: 100%;
    max-height: min(88dvh, 720px);
    padding:
      16px
      max(13px, env(safe-area-inset-right))
      max(16px, env(safe-area-inset-bottom))
      max(13px, env(safe-area-inset-left));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 18px 18px 0 0;
  }

  .order-pick-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .order-dialog-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .order-dialog-actions > span {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .order-dialog-backdrop {
    animation: none;
    transition: none;
  }
}
</style>
