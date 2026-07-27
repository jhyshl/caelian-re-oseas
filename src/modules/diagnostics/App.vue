<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { EventLogRecord, RuntimeInfo } from '@/domain/types';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const info = ref<RuntimeInfo>(props.context.api.getRuntimeInfo());
const events = ref<EventLogRecord[]>([]);
const syncMessage = ref('');

async function refresh() {
  info.value = await props.context.api.query('runtime');
  if (info.value.profileId) {
    events.value = await props.context.api.query('events');
  }
}

async function sync() {
  const written = await props.context.api.syncProjection();
  syncMessage.value = written
    ? 'MVU 精简投影已刷新'
    : '当前未连接 MVU，权威本地状态不受影响';
  await refresh();
}

function renderPayload(payload: unknown) {
  return JSON.stringify(payload);
}

onMounted(() => void refresh());
</script>

<template>
  <section class="panel">
    <header>
      <div>
        <small>独立 Vue 应用</small>
        <h2>Alpha 诊断</h2>
      </div>
      <button
        type="button"
        class="close"
        aria-label="关闭诊断面板"
        @click="context.api.closePanel('diagnostics')"
      >
        ×
      </button>
    </header>

    <dl>
      <div><dt>状态</dt><dd>{{ info.status }}</dd></div>
      <div><dt>版本</dt><dd>{{ info.version }}</dd></div>
      <div><dt>构建</dt><dd>{{ info.buildId }}</dd></div>
      <div><dt>数据库</dt><dd>{{ info.databaseName }}</dd></div>
      <div><dt>MVU</dt><dd>{{ info.mvuAvailable ? '已连接' : '未连接' }}</dd></div>
      <div><dt>档案</dt><dd>{{ info.profileId || '未激活' }}</dd></div>
    </dl>

    <p v-if="info.lastError" class="error">{{ info.lastError }}</p>
    <div class="actions">
      <button type="button" @click="sync">刷新 MVU 投影</button>
      <button type="button" @click="refresh">刷新诊断</button>
    </div>
    <p v-if="syncMessage" class="message">{{ syncMessage }}</p>

    <h3>最近领域事件</h3>
    <ol v-if="events.length">
      <li v-for="event in events" :key="event.id">
        <strong>{{ event.type }}</strong>
        <code>{{ renderPayload(event.payload) }}</code>
      </li>
    </ol>
    <p v-else class="empty">尚无领域事件。</p>
  </section>
</template>

<style scoped>
.panel {
  width: min(700px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 24px;
  border: 1px solid rgba(199, 165, 240, 0.45);
  border-radius: 22px;
  color: #f8f2ff;
  background: #191323;
  box-shadow: 0 28px 80px rgba(7, 3, 13, 0.58);
  font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
}
header {
  display: flex;
  align-items: start;
  justify-content: space-between;
}
h2 {
  margin: 2px 0 18px;
}
small,
dt,
.empty {
  color: #bba9c9;
}
.close {
  border: 0;
  color: #d9cce6;
  background: transparent;
  font-size: 28px;
  cursor: pointer;
}
dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
dl div {
  min-width: 0;
  padding: 10px;
  border-radius: 10px;
  background: rgba(102, 75, 128, 0.16);
}
dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}
.actions button {
  padding: 10px 13px;
  border: 1px solid #72558d;
  border-radius: 10px;
  color: #fff;
  background: #2b2038;
  cursor: pointer;
}
.error {
  color: #ffc6ae;
}
.message {
  color: #bce8cd;
}
ol {
  display: grid;
  gap: 7px;
  padding-left: 22px;
}
li {
  padding: 8px;
  border-radius: 8px;
  background: #110d18;
}
code {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: #c9b8d8;
}
@media (max-width: 560px) {
  dl {
    grid-template-columns: 1fr;
  }
}
</style>
