<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { loadRegions } from '@/content/catalogs/world';
import type { RegionDefinition } from '@/content/types';
import type { PanelContext } from '@/kernel/public-api';
import type {
  RegionWorldbookOverview,
  RegionWorldbookRegionStatus,
} from '@/worldbook/region-switcher';

const props = defineProps<{ context: PanelContext }>();
const regions = ref<RegionDefinition[]>([]);
const overview = ref<RegionWorldbookOverview>();
const busyRegion = ref('');
const notice = ref('');
const refreshing = ref(false);
let refreshTask: Promise<void> | undefined;
let disposed = false;
let disposeListener: (() => void) | undefined;

const rows = computed(() => {
  const statusByRegion = new Map(
    (overview.value?.regions ?? []).map((entry) => [entry.region, entry]),
  );
  return regions.value.flatMap((region) => {
    const status = statusByRegion.get(region.name);
    return status ? [{ region, status }] : [];
  });
});

function stateLabel(status: RegionWorldbookRegionStatus): string {
  if (status.state === 'on') return `已开启 ${status.enabled}/${status.total}`;
  if (status.state === 'mixed') return `部分开启 ${status.enabled}/${status.total}`;
  return `已关闭 0/${status.total}`;
}

function refresh(): Promise<void> {
  if (refreshTask) return refreshTask;
  refreshing.value = true;
  notice.value = '';
  refreshTask = (async () => {
    try {
      const result = await props.context.api.getRegionWorldbookStatus();
      if (disposed) return;
      overview.value = result;
      if (result.status !== 'current') {
        notice.value = result.message || (result.status === 'wrong-character'
          ? '当前角色尚未识别为凯利安，请重试读取。'
          : result.status === 'wrong-worldbook'
            ? '未找到可确认的凯利安世界书，请检查角色绑定。'
            : '酒馆世界书接口暂不可用，请重试读取。');
      }
    } catch (error) {
      if (!disposed) {
        overview.value = { status: 'failed', regions: [] };
        notice.value = error instanceof Error ? error.message : '世界书读取失败，请重试。';
      }
    } finally {
      refreshing.value = false;
      refreshTask = undefined;
    }
  })();
  return refreshTask;
}

async function toggle(status: RegionWorldbookRegionStatus) {
  busyRegion.value = status.region;
  notice.value = '';
  try {
    const enabled = status.state !== 'on';
    const result = await props.context.api.setRegionWorldbook(
      status.region,
      enabled,
    );
    if (!['applied', 'current'].includes(result.status)) {
      throw new Error(result.message || `世界书切换失败：${result.status}`);
    }
    await refresh();
    notice.value = `${status.region}相关条目已${enabled ? '全部开启' : '全部关闭'}。`;
  } catch (caught) {
    notice.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busyRegion.value = '';
  }
}

onMounted(async () => {
  disposeListener = props.context.api.on?.('tavern.changed', ({ event }) => {
    if (['CHAT_CHANGED', 'CHAT_LOADED', 'CHARACTER_EDITED'].includes(event) && !busyRegion.value) return refresh();
  });
  regions.value = await loadRegions();
  if (!disposed) await refresh();
});

onUnmounted(() => {
  disposed = true;
  disposeListener?.();
});
</script>

<template>
  <aside class="worldbook-floater" aria-label="地区世界书快捷开关">
    <header class="worldbook-header">
      <div class="worldbook-heading">
        <span>WORLDBOOK</span>
        <h2>地区条目快捷开关</h2>
      </div>
      <button
        class="worldbook-close"
        type="button"
        aria-label="关闭地区世界书快捷窗"
        @click="context.api.closePanel('worldbook')"
      >
        ×
      </button>
    </header>
    <p class="explanation">
      只处理凯利安官方世界书中带 AUTO_REGION 标记的地区资料，不再根据 AI 输出自动切换。
    </p>
    <div v-if="!overview" class="empty">正在读取世界书条目……</div>
    <div v-else-if="rows.length" class="region-list">
      <button
        v-for="row in rows"
        :key="row.region.id"
        type="button"
        :class="['region-row', row.status.state]"
        :disabled="Boolean(busyRegion) || refreshing"
        @click="toggle(row.status)"
      >
        <span class="region-copy">
          <b>{{ row.region.name }}</b>
          <small>{{ stateLabel(row.status) }}</small>
        </span>
        <em class="region-action">
          {{ row.status.state === 'on' ? '一键关闭' : '一键开启' }}
        </em>
      </button>
    </div>
    <div v-else class="empty">没有找到可手动控制的地区条目。</div>
    <p v-if="notice" class="notice">{{ notice }}</p>
    <footer class="worldbook-footer">
      <button type="button" :disabled="Boolean(busyRegion) || refreshing" @click="refresh">
        {{ refreshing ? '正在重新读取…' : '重新读取状态' }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.worldbook-floater,
.worldbook-floater * {
  box-sizing: border-box;
}

.worldbook-floater {
  position: fixed;
  z-index: 2147483645;
  top: max(74px, calc(env(safe-area-inset-top) + 12px));
  right: max(16px, env(safe-area-inset-right));
  width: min(410px, calc(100vw - 28px));
  max-height: min(720px, calc(100dvh - 94px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  overflow: hidden;
  border: 1px solid rgba(212, 168, 67, 0.52);
  border-radius: 16px;
  color: #e8e0d4;
  background: rgba(13, 15, 20, 0.985);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.72);
  font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
  pointer-events: auto;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 16px 12px;
  border-bottom: 1px solid rgba(212, 168, 67, 0.22);
  background: linear-gradient(135deg, #17130f, #292016);
}

header span {
  color: #d4a843;
  font-size: 8px;
  letter-spacing: 0.2em;
}

header h2 {
  margin: 4px 0 0;
  color: #fff5e6;
  font: 700 17px/1.1 Georgia, "Noto Serif SC", serif;
}

header > button {
  width: 34px;
  height: 34px;
  border: 1px solid #3a4055;
  border-radius: 9px;
  color: #f0d68a;
  background: rgba(255, 255, 255, 0.03);
  font-size: 22px;
  cursor: pointer;
}

.explanation {
  margin: 0;
  padding: 11px 16px;
  color: #938d82;
  font-size: 10px;
  line-height: 1.55;
}

.region-list {
  display: grid;
  gap: 7px;
  overflow-y: auto;
  padding: 0 12px 12px;
  overscroll-behavior: contain;
}

.region-list > button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 11px;
  border: 1px solid #2a2f3d;
  border-radius: 10px;
  color: #e8e0d4;
  background: #161a24;
  text-align: left;
  cursor: pointer;
}

.region-list > button.on {
  border-color: rgba(56, 169, 107, 0.5);
  background: rgba(56, 169, 107, 0.09);
}

.region-list > button.mixed {
  border-color: rgba(212, 168, 67, 0.5);
  background: rgba(212, 168, 67, 0.08);
}

.region-list > button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.region-list span {
  display: grid;
  gap: 3px;
}

.region-list b {
  color: #fff5e6;
  font-size: 12px;
}

.region-list small {
  color: #938d82;
  font-size: 9px;
}

.region-list em {
  flex: 0 0 auto;
  padding: 6px 8px;
  border-radius: 7px;
  color: #1b150c;
  background: #d4a843;
  font-size: 9px;
  font-style: normal;
  font-weight: 800;
}

.empty,
.notice {
  margin: 0 12px 12px;
  padding: 13px;
  border-radius: 9px;
  color: #938d82;
  background: rgba(255, 255, 255, 0.025);
  font-size: 10px;
  line-height: 1.5;
}

.notice {
  color: #f0d68a;
  background: rgba(212, 168, 67, 0.08);
}

footer {
  display: flex;
  justify-content: flex-end;
  padding: 10px 12px 12px;
  border-top: 1px solid rgba(212, 168, 67, 0.16);
}

footer button {
  padding: 7px 11px;
  border: 1px solid #3a4055;
  border-radius: 8px;
  color: #e8e0d4;
  background: rgba(255, 255, 255, 0.035);
  font-size: 10px;
  cursor: pointer;
}

@media (max-width: 560px) {
  .worldbook-floater {
    top: max(66px, calc(env(safe-area-inset-top) + 8px));
    right: max(8px, env(safe-area-inset-right));
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 78px - env(safe-area-inset-bottom));
  }
}
</style>
