<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { GameSnapshot, SettingsRecord } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import type { QuestJudgeModel } from '@/quests/judge-client';
import {
  prepareThemePreviews,
  subscribeThemeAssets,
} from '@/themes/theme-manager';
import type { CaelianThemeOption } from '@/themes/types';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const draft = ref<Pick<SettingsRecord, 'preserveAdventureSave' | 'battleDifficulty'>>({
  preserveAdventureSave: false,
  battleDifficulty: 'normal',
});
const notice = ref('');
const saving = ref(false);
const themeSaving = ref(false);
const themeState = ref(props.context.api.getThemeState());
let disposeTheme: (() => void) | undefined;
let disposeThemeAssets: (() => void) | undefined;
const contentSyncing = ref(false);
const managedContentAutoUpdate = ref(
  props.context.api.getManagedContentAutoUpdate(),
);
const questJudgeStatus = ref(props.context.api.getQuestJudgeStatus());
const questJudgeDraft = ref({
  endpoint: questJudgeStatus.value.endpoint ?? '',
  modelsEndpoint: questJudgeStatus.value.modelsEndpoint ?? '',
  apiKey: '',
  model: questJudgeStatus.value.model ?? '',
  jsonMode: questJudgeStatus.value.jsonMode ?? true,
});
const questJudgeModels = ref<QuestJudgeModel[]>([]);
const fetchingQuestModels = ref(false);
const applyingQuestJudge = ref(false);
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

async function selectTheme(theme: CaelianThemeOption) {
  if (theme.locked) {
    const prompt = theme.unlockPrompt;
    notice.value = prompt?.notice ?? '需要导入对应的社区奖励脚本后才能使用这个主题。';
    props.context.api.notify({
      kind: 'info',
      title: prompt?.title ?? '主题尚未解锁',
      description:
        prompt?.description ?? '请先导入对应的社区奖励脚本。',
      duration: 6_000,
    });
    return;
  }
  if (themeSaving.value || themeState.value.active === theme.id) return;
  themeSaving.value = true;
  notice.value = '';
  const result = await props.context.api.execute({
    id: commandId('settings.update-theme'),
    type: 'settings.update',
    payload: { uiTheme: theme.id },
  });
  themeSaving.value = false;
  if (result.status === 'rejected') {
    notice.value = result.message ?? '主题切换失败';
    return;
  }
  themeState.value = props.context.api.getThemeState();
  notice.value = `已切换为“${
    themeState.value.available.find(
      (candidate) => candidate.id === themeState.value.active,
    )?.name ?? '欧西亚斯经典'
  }”。`;
}

async function syncMvu() {
  const written = await props.context.api.syncProjection();
  notice.value = written
    ? '已刷新 MVU 中的精简 AI 摘要。'
    : '当前没有可用的 MVU 接口；本地档案不受影响。';
}

async function syncManagedContent() {
  contentSyncing.value = true;
  const result = await props.context.api.syncManagedContent({ force: true });
  contentSyncing.value = false;
  if (result.status === 'wrong-character') {
    notice.value =
      '当前角色不是“凯利安”“凯利安alpha”或“凯利安beta”，未读取或修改任何角色卡内容。';
    return;
  }
  if (result.status === 'wrong-worldbook') {
    notice.value = '当前角色未绑定指定世界书，未修改任何内容。';
    return;
  }
  if (result.status === 'unavailable') {
    notice.value = '酒馆助手角色卡/世界书编辑接口尚未连接。';
    return;
  }
  if (result.status === 'offline') {
    notice.value = '暂时无法读取内容更新清单，请稍后重试。';
    return;
  }
  notice.value =
    result.conflicts.length > 0
      ? `已更新 ${result.applied} 项；${result.conflicts.length} 项检测到玩家修改，已保留玩家版本。`
      : result.applied > 0
        ? `已安全更新 ${result.applied} 项角色卡/世界书内容。`
        : '角色卡与绑定世界书内容已经是最新版本。';
}

function updateManagedContentPreference() {
  props.context.api.setManagedContentAutoUpdate(
    managedContentAutoUpdate.value,
  );
  notice.value = managedContentAutoUpdate.value
    ? '已开启角色卡/世界书安全增量更新。'
    : '已关闭自动内容更新；仍可随时手动检查。';
}

async function fetchQuestModels() {
  const endpoint = questJudgeDraft.value.endpoint.trim();
  if (!endpoint) {
    notice.value = '请先填写副 API 聊天补全地址。';
    return;
  }
  fetchingQuestModels.value = true;
  notice.value = '';
  try {
    questJudgeModels.value = await props.context.api.fetchQuestJudgeModels({
      endpoint,
      modelsEndpoint:
        questJudgeDraft.value.modelsEndpoint.trim() || undefined,
      apiKey: questJudgeDraft.value.apiKey.trim() || undefined,
    });
    notice.value = `已拉取 ${questJudgeModels.value.length} 个模型，请在模型栏中选择。`;
  } catch (error) {
    notice.value =
      error instanceof Error ? error.message : '模型列表拉取失败';
  } finally {
    fetchingQuestModels.value = false;
  }
}

async function applyQuestJudge() {
  const endpoint = questJudgeDraft.value.endpoint.trim();
  const model = questJudgeDraft.value.model.trim();
  if (!endpoint || !model) {
    notice.value = '请填写副 API 地址并选择模型。';
    return;
  }
  applyingQuestJudge.value = true;
  notice.value = '';
  try {
    props.context.api.configureQuestJudge({
      endpoint,
      modelsEndpoint:
        questJudgeDraft.value.modelsEndpoint.trim() || undefined,
      model,
      apiKey: questJudgeDraft.value.apiKey.trim() || undefined,
      jsonMode: questJudgeDraft.value.jsonMode,
    });
    questJudgeDraft.value.apiKey = '';
    questJudgeStatus.value = props.context.api.getQuestJudgeStatus();
    notice.value = `任务剧情判定器已启用，当前模型：${model}。`;
  } catch (error) {
    notice.value =
      error instanceof Error ? error.message : '副 API 配置失败';
  } finally {
    applyingQuestJudge.value = false;
  }
}

function clearQuestJudge() {
  props.context.api.configureQuestJudge(null);
  questJudgeStatus.value = props.context.api.getQuestJudgeStatus();
  questJudgeDraft.value = {
    endpoint: '',
    modelsEndpoint: '',
    apiKey: '',
    model: '',
    jsonMode: true,
  };
  questJudgeModels.value = [];
  notice.value = '已停用任务剧情判定器，并清除保存的连接信息。';
}

onMounted(async () => {
  const host = props.context.document.defaultView ?? globalThis.window;
  disposeThemeAssets = subscribeThemeAssets(host, () => {
    themeState.value = props.context.api.getThemeState();
  });
  void prepareThemePreviews(host);
  disposeTheme = props.context.api.on('theme.changed', (state) => {
    themeState.value = state;
  });
  snapshot.value = await props.context.api.query('state');
  draft.value = {
    preserveAdventureSave: snapshot.value.settings.preserveAdventureSave,
    battleDifficulty: snapshot.value.settings.battleDifficulty,
  };
});

onBeforeUnmount(() => {
  disposeTheme?.();
  disposeThemeAssets?.();
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
          <p>这些选项只保存在本机浏览器，不会把完整配置写入 MVU。</p>
        </div>
        <button type="button" class="ca-button" @click="context.api.openPanel('diagnostics')">
          打开诊断
        </button>
      </section>

      <section class="ca-section theme-settings">
        <div class="theme-heading">
          <div>
            <h2 class="ca-section-title">界面主题</h2>
            <p>主题可由社区奖励或角色进度解锁；图片首次按需下载，之后从玩家本地缓存读取。</p>
          </div>
          <span>{{ themeState.available.length }} 个主题</span>
        </div>
        <div class="theme-grid" role="radiogroup" aria-label="界面主题">
          <button
            v-for="theme in themeState.available"
            :key="theme.id"
            type="button"
            class="theme-card"
            :class="{
              active: themeState.active === theme.id,
              locked: theme.locked,
            }"
            role="radio"
            :aria-checked="themeState.active === theme.id"
            :disabled="themeSaving"
            @click="selectTheme(theme)"
          >
            <span class="theme-preview" :class="{ artwork: theme.previewUrl }">
              <img v-if="theme.previewUrl" :src="theme.previewUrl" alt="" loading="lazy" />
              <b v-else>∞</b>
            </span>
            <span class="theme-copy">
              <strong>{{ theme.name }}</strong>
              <small>{{ theme.description }}</small>
            </span>
            <em>{{
              themeState.active === theme.id
                ? '使用中'
                : theme.locked
                  ? theme.unlockPrompt?.badge ?? '需要脚本解锁'
                  : theme.badge
            }}</em>
          </button>
        </div>
      </section>

      <section class="ca-section judge-settings">
        <div class="judge-heading">
          <div>
            <h2 class="ca-section-title">任务剧情判定器</h2>
            <p>
              副 API 只判断当前任务节点是否推进、偏离或离场，不负责续写正文。
            </p>
          </div>
          <span :class="{ active: questJudgeStatus.configured }">
            {{ questJudgeStatus.configured ? '已启用' : '未配置' }}
          </span>
        </div>

        <div class="judge-form">
          <label>
            <span>聊天补全地址（支持服务根地址）</span>
            <input
              v-model="questJudgeDraft.endpoint"
              type="url"
              placeholder="https://example.com 或 https://example.com/v1/chat/completions"
              spellcheck="false"
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              v-model="questJudgeDraft.apiKey"
              type="password"
              :placeholder="
                questJudgeStatus.apiKeyPresent
                  ? '本机已有保存的密钥；留空则继续使用'
                  : '保存在当前浏览器本机并自动恢复'
              "
              autocomplete="new-password"
              spellcheck="false"
            />
          </label>
          <label>
            <span>模型列表地址（可选）</span>
            <input
              v-model="questJudgeDraft.modelsEndpoint"
              type="url"
              placeholder="留空时根据聊天补全地址自动推导"
              spellcheck="false"
            />
          </label>
          <label>
            <span>判定模型</span>
            <div class="model-picker">
              <div class="model-fields">
                <select
                  v-if="questJudgeModels.length"
                  v-model="questJudgeDraft.model"
                  aria-label="拉取到的模型列表"
                >
                  <option value="">请选择拉取到的模型</option>
                  <option
                    v-for="model in questJudgeModels"
                    :key="model.id"
                    :value="model.id"
                  >
                    {{ model.ownedBy ? `${model.id} · ${model.ownedBy}` : model.id }}
                  </option>
                </select>
                <input
                  v-model="questJudgeDraft.model"
                  placeholder="也可以手动填写模型名称"
                  spellcheck="false"
                />
              </div>
              <button
                type="button"
                class="ca-button"
                :disabled="fetchingQuestModels"
                @click="fetchQuestModels"
              >
                {{ fetchingQuestModels ? '拉取中……' : '拉取模型' }}
              </button>
            </div>
          </label>
          <label class="judge-toggle">
            <div>
              <strong>JSON 模式</strong>
              <small>接口支持 response_format 时建议开启。</small>
            </div>
            <input v-model="questJudgeDraft.jsonMode" type="checkbox" />
          </label>
        </div>

        <div class="judge-actions">
          <button
            type="button"
            class="ca-button primary"
            :disabled="applyingQuestJudge"
            @click="applyQuestJudge"
          >
            {{ applyingQuestJudge ? '应用中……' : '应用副 API 配置' }}
          </button>
          <button
            v-if="questJudgeStatus.configured"
            type="button"
            class="ca-button"
            @click="clearQuestJudge"
          >
            停用并清除
          </button>
        </div>
        <p class="judge-security">
          地址、模型、JSON 模式和 API Key 都保存在当前浏览器本机，重新打开时会自动恢复。
        </p>
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
            <strong>角色卡 / 世界书安全增量更新</strong>
            <span>
              仅允许修改“凯利安”“凯利安alpha”“凯利安beta”及其指定绑定世界书。更新只处理管理端标记的精确片段；
              与玩家修改冲突时保留玩家版本，不会整卡覆盖。
            </span>
          </div>
          <input
            v-model="managedContentAutoUpdate"
            type="checkbox"
            @change="updateManagedContentPreference"
          />
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
              {{ runtime.channel === 'beta' ? 'Beta' : 'Alpha' }} 接入口只读取自己的通道清单，自动加载该通道最新的不可变构建，不要求玩家修改版本号。
            </p>
          </article>
        </div>
        <button type="button" class="ca-button" @click="syncMvu">
          立即刷新 MVU 精简摘要
        </button>
        <button
          type="button"
          class="ca-button"
          :disabled="contentSyncing"
          @click="syncManagedContent"
        >
          {{ contentSyncing ? '正在检查内容……' : '检查角色卡 / 世界书更新' }}
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
.boundary-grid p,
.theme-heading p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.5;
}

.theme-settings {
  display: grid;
  gap: 13px;
}

.theme-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.theme-heading > span {
  flex: 0 0 auto;
  padding: 4px 8px;
  border: 1px solid var(--ca-border);
  border-radius: 999px;
  color: var(--ca-muted);
  font-size: 9px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.theme-card {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  min-height: 82px;
  padding: 10px 11px;
  border: 1px solid var(--ca-border);
  border-radius: 14px;
  color: var(--ca-text);
  background: var(--ca-surface-soft);
  text-align: left;
  cursor: pointer;
}

.theme-card:hover:not(:disabled),
.theme-card.active {
  border-color: var(--ca-gold);
  background: color-mix(in srgb, var(--ca-gold) 9%, var(--ca-surface-soft));
}

.theme-card.active {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ca-gold) 18%, transparent);
}

.theme-card.locked:not(:disabled) {
  border-style: dashed;
  opacity: 0.78;
}

.theme-card.locked:hover:not(:disabled) {
  opacity: 1;
}

.theme-preview {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--ca-border-light);
  border-radius: 17px;
  color: var(--ca-gold-light);
  background: var(--ca-bg);
  font: 700 31px/1 Georgia, serif;
}

.theme-preview.artwork {
  background: linear-gradient(145deg, #fff5cf, #f6c567);
}

.theme-preview img {
  width: 52px;
  height: 52px;
  object-fit: contain;
}

.theme-copy {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.theme-copy strong {
  color: var(--ca-text-bright);
  font-size: 13px;
}

.theme-copy small {
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.4;
}

.theme-card em {
  align-self: flex-start;
  padding: 3px 6px;
  border-radius: 999px;
  color: var(--ca-gold);
  background: color-mix(in srgb, var(--ca-gold) 10%, transparent);
  font: normal 8px/1.3 inherit;
  white-space: nowrap;
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

.judge-settings {
  display: grid;
  gap: 14px;
}

.judge-heading,
.judge-actions,
.model-picker,
.judge-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}

.judge-heading {
  justify-content: space-between;
}

.judge-heading p,
.judge-security,
.judge-toggle small {
  margin: 4px 0 0;
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.5;
}

.judge-heading > span {
  padding: 4px 8px;
  border: 1px solid var(--ca-border);
  border-radius: 99px;
  color: var(--ca-muted);
  font-size: 9px;
}

.judge-heading > span.active {
  border-color: rgba(93, 190, 133, 0.45);
  color: #9bdfb9;
  background: rgba(93, 190, 133, 0.08);
}

.judge-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
}

.judge-form > label {
  display: grid;
  gap: 6px;
  color: var(--ca-text-bright);
  font-size: 10px;
}

.judge-form input:not([type="checkbox"]),
.judge-form select {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--ca-border-light);
  border-radius: 8px;
  color: var(--ca-text);
  background: #11141b;
  font: inherit;
}

.model-fields {
  flex: 1;
  display: grid;
  gap: 6px;
}

.judge-toggle {
  justify-content: space-between;
  padding: 9px 10px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  background: var(--ca-surface-soft);
}

.judge-toggle > div {
  display: grid;
}

.judge-toggle input {
  width: 19px;
  height: 19px;
  accent-color: var(--ca-gold);
}

.judge-actions {
  justify-content: flex-end;
}

.judge-security {
  text-align: right;
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
  .runtime-grid,
  .judge-form,
  .theme-grid {
    grid-template-columns: 1fr;
  }

  .model-picker {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
