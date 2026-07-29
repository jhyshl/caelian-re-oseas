<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { GameSnapshot, SettingsRecord } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const draft = ref<Pick<SettingsRecord, 'preserveAdventureSave' | 'battleDifficulty'>>({
  preserveAdventureSave: false,
  battleDifficulty: 'normal',
});
const notice = ref('');
const saving = ref(false);
const runtime = props.context.api.getRuntimeInfo();

async function save() {
  saving.value = true;
  notice.value = '';
  const result = await props.context.api.execute({
    id: commandId('settings.update'),
    type: 'settings.update',
    payload: { ...draft.value },
  });
  saving.value = false;
  if (result.status === 'rejected') {
    notice.value = result.message ?? '设置保存失败';
    return;
  }
  snapshot.value = await props.context.api.query('state');
  notice.value = draft.value.preserveAdventureSave
    ? '设置已保存。之后新建或切换聊天会继续使用当前冒险存档。'
    : '设置已保存。之后新建聊天会创建独立冒险存档。';
}

async function syncMvu() {
  const written = await props.context.api.syncProjection();
  notice.value = written
    ? '已刷新 MVU 中的精简 AI 摘要。'
    : '当前没有可用的 MVU 接口；本地档案不受影响。';
}

onMounted(async () => {
  snapshot.value = await props.context.api.query('state');
  draft.value = {
    preserveAdventureSave: snapshot.value.settings.preserveAdventureSave,
    battleDifficulty: snapshot.value.settings.battleDifficulty,
  };
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="settings"
    :date="snapshot?.world.location"
  >
    <div v-if="!snapshot" class="ca-empty">正在读取本地设置……</div>
    <template v-else>
      <section class="ca-section settings-title">
        <div>
          <span>SYSTEM SETTINGS</span>
          <h1>冒险者面板设置</h1>
          <p>这些选项保存在浏览器 IndexedDB，不会把完整配置写入 MVU。</p>
        </div>
        <button type="button" class="ca-button" @click="context.api.openPanel('diagnostics')">
          打开诊断
        </button>
      </section>

      <section class="ca-section">
        <h2 class="ca-section-title">游戏设置</h2>
        <label class="setting-row">
          <div>
            <strong>战斗难度</strong>
            <span>供战斗领域模块计算敌方强度与奖励倍率。</span>
          </div>
          <select v-model="draft.battleDifficulty">
            <option value="easy">简单</option>
            <option value="normal">标准</option>
            <option value="hard">困难</option>
            <option value="hell">炼狱</option>
          </select>
        </label>
        <label class="setting-row">
          <div>
            <strong>切换聊天时保留冒险存档</strong>
            <span>
              关闭时角色卡每个新聊天使用独立冒险档；开启后，新聊天继续使用当前冒险档。
              该开关在浏览器内全局同步，不会因新建聊天而重置。
            </span>
          </div>
          <input v-model="draft.preserveAdventureSave" type="checkbox" />
        </label>
        <div class="settings-actions">
          <button
            type="button"
            class="ca-button primary"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? '保存中……' : '保存设置' }}
          </button>
        </div>
      </section>

      <section class="ca-section">
        <h2 class="ca-section-title">数据边界</h2>
        <div class="boundary-grid">
          <article>
            <strong>浏览器本地数据库</strong>
            <p>
              角色、卡牌、牌组、背包、装备、藏品、任务、地图、战斗、成就、设置等完整数据。
            </p>
          </article>
          <article>
            <strong>MVU 精简投影</strong>
            <p>
              仅角色概要、当前位置、当前任务概要和战斗概要，供 AI 理解当下场景。
            </p>
          </article>
          <article>
            <strong>GitHub 内容通道</strong>
            <p>
              Alpha 接入口只读取通道清单，自动加载最新不可变构建，不要求玩家修改版本号。
            </p>
          </article>
        </div>
        <button type="button" class="ca-button" @click="syncMvu">
          立即刷新 MVU 精简摘要
        </button>
      </section>

      <section class="ca-section runtime-grid">
        <div><span>通道</span><strong>{{ runtime.channel }}</strong></div>
        <div><span>版本</span><strong>{{ runtime.version }}</strong></div>
        <div><span>构建</span><strong>{{ runtime.buildId }}</strong></div>
        <div><span>数据库</span><strong>schema v{{ runtime.databaseVersion }}</strong></div>
        <div><span>MVU</span><strong>{{ runtime.mvuAvailable ? '可用' : '未连接' }}</strong></div>
        <div><span>运行状态</span><strong>{{ runtime.status }}</strong></div>
      </section>

      <p v-if="notice" class="settings-notice">{{ notice }}</p>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.settings-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settings-title span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.17em;
}

.settings-title h1 {
  margin: 5px 0;
  color: var(--ca-text-bright);
  font: 700 23px var(--ca-serif);
}

.settings-title p,
.setting-row span,
.boundary-grid p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.5;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 13px 0;
  border-bottom: 1px solid var(--ca-border);
}

.setting-row > div {
  display: grid;
  gap: 4px;
}

.setting-row strong,
.boundary-grid strong {
  color: var(--ca-text-bright);
  font-size: 13px;
}

.setting-row select {
  min-width: 110px;
  padding: 7px 9px;
  border: 1px solid var(--ca-border-light);
  border-radius: 8px;
  color: var(--ca-text);
  background: #11141b;
  font: inherit;
}

.setting-row input[type="checkbox"] {
  width: 19px;
  height: 19px;
  accent-color: var(--ca-gold);
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 13px;
}

.boundary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin-bottom: 13px;
}

.boundary-grid article {
  padding: 12px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  background: var(--ca-surface-soft);
}

.boundary-grid p {
  margin-top: 6px;
}

.runtime-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.runtime-grid > div {
  display: grid;
  gap: 3px;
  padding: 10px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.022);
}

.runtime-grid span {
  color: var(--ca-muted);
  font-size: 9px;
}

.runtime-grid strong {
  overflow: hidden;
  color: var(--ca-text-bright);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-notice {
  color: #9bdfb9;
  font-size: 11px;
  text-align: center;
}

@media (max-width: 650px) {
  .settings-title {
    align-items: flex-start;
    flex-direction: column;
  }

  .boundary-grid,
  .runtime-grid {
    grid-template-columns: 1fr;
  }
}
</style>
