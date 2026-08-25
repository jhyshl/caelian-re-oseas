<script setup lang="ts">
/* global Window, window */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import {
  FEEDBACK_LIMITS,
  feedbackReceiptDisplayStatus,
  readFeedbackReceipts,
  refreshFeedbackReceipt,
  submitFeedback,
  validateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackKind,
  type FeedbackReceipt,
  type FeedbackReceiptDisplayStatus,
} from '@/feedback/feedback-service';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const LAST_SUBMITTED_AT_KEY = 'caelian_feedback_last_submitted_at_v1';
const SUBMISSION_COOLDOWN_MS = 30_000;

const runtime = props.context.api.getRuntimeInfo();
const draft = reactive<FeedbackDraft>({
  kind: 'bug',
  title: '',
  details: '',
  reproductionSteps: '',
  expectedResult: '',
  actualResult: '',
  contact: '',
});
const website = ref('');
const errors = ref<string[]>([]);
const submitting = ref(false);
const submittedId = ref('');
const submittedReceiptPersisted = ref<boolean | null>(null);
const serviceError = ref('');
const view = ref<'submit' | 'receipts'>('submit');
const receipts = ref<FeedbackReceipt[]>([]);
const refreshingReceipts = ref(false);
const refreshingReceiptId = ref('');
const receiptNotice = ref('');
const receiptError = ref('');
const isBug = computed(() => draft.kind === 'bug');
let previousBodyOverflow = '';
let previousRootOverflow = '';

const writingTips = computed(() =>
  isBug.value
    ? [
        '先写一句能定位功能和现象的标题。',
        '按顺序列出每一步操作，并说明问题是否每次都会出现。',
        '分别写清你原本期待看到什么，以及实际发生了什么。',
      ]
    : [
        '说明建议会用在什么场景，以及现在最不方便的地方。',
        '描述你希望怎样改；如果有取舍，也可以一起写出来。',
        '尽量聚焦一个需求，多个无关建议请分开提交。',
      ],
);

function hostWindow(): Window {
  return props.context.document.defaultView ?? window;
}

function selectKind(kind: FeedbackKind): void {
  draft.kind = kind;
  errors.value = [];
  serviceError.value = '';
}

const receiptStatusLabels: Record<FeedbackReceiptDisplayStatus, string> = {
  pending: '待查看',
  viewed: '已查看',
  resolved: '已解决',
  rejected: '已处理',
};

function receiptState(
  receipt: FeedbackReceipt,
): FeedbackReceiptDisplayStatus {
  return feedbackReceiptDisplayStatus(receipt);
}

function receiptStatusLabel(receipt: FeedbackReceipt): string {
  return receiptStatusLabels[receiptState(receipt)];
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function loadReceipts(): void {
  receipts.value = readFeedbackReceipts(hostWindow());
}

async function refreshReceipts(options?: { silent?: boolean }): Promise<void> {
  if (refreshingReceipts.value) return;
  const local = readFeedbackReceipts(hostWindow());
  receipts.value = local;
  if (!local.length) return;

  refreshingReceipts.value = true;
  receiptError.value = '';
  if (!options?.silent) receiptNotice.value = '';
  const results = await Promise.allSettled(
    local.map((receipt) => refreshFeedbackReceipt(receipt, hostWindow())),
  );
  loadReceipts();
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed === results.length) {
    if (!options?.silent) {
      receiptError.value = '暂时无法查询反馈进度，请稍后重试。';
    }
  } else if (!options?.silent) {
    receiptNotice.value = failed
      ? `已更新 ${results.length - failed} 条回执，${failed} 条暂时无法查询。`
      : `已更新 ${results.length} 条反馈回执。`;
  }
  refreshingReceipts.value = false;
}

async function refreshOneReceipt(receipt: FeedbackReceipt): Promise<void> {
  refreshingReceiptId.value = receipt.id;
  receiptError.value = '';
  receiptNotice.value = '';
  try {
    const updated = await refreshFeedbackReceipt(receipt, hostWindow());
    loadReceipts();
    receiptNotice.value = `“${updated.title}”当前状态：${receiptStatusLabel(updated)}。`;
  } catch (error) {
    receiptError.value =
      error instanceof Error ? error.message : '查询失败，请稍后再试。';
  } finally {
    refreshingReceiptId.value = '';
  }
}

function showSubmissionForm(): void {
  view.value = 'submit';
  submittedId.value = '';
  submittedReceiptPersisted.value = null;
  receiptError.value = '';
  receiptNotice.value = '';
}

function showReceipts(): void {
  view.value = 'receipts';
  submittedId.value = '';
  loadReceipts();
  if (receipts.value.length) void refreshReceipts({ silent: true });
}

function readLastSubmittedAt(): number {
  try {
    return Number(
      hostWindow().localStorage.getItem(LAST_SUBMITTED_AT_KEY) || 0,
    );
  } catch {
    return 0;
  }
}

function rememberSubmission(): void {
  try {
    hostWindow().localStorage.setItem(
      LAST_SUBMITTED_AT_KEY,
      String(Date.now()),
    );
  } catch {
    // Submission still succeeded when local storage is unavailable.
  }
}

async function submit(): Promise<void> {
  errors.value = [];
  serviceError.value = '';
  submittedReceiptPersisted.value = null;

  if (website.value) {
    submittedId.value = 'received';
    return;
  }

  const validation = validateFeedbackDraft(draft);
  if (!validation.valid) {
    errors.value = validation.errors;
    return;
  }

  const remaining = SUBMISSION_COOLDOWN_MS - (Date.now() - readLastSubmittedAt());
  if (remaining > 0) {
    serviceError.value = `请等待 ${Math.ceil(remaining / 1000)} 秒后再提交下一条反馈。`;
    return;
  }

  submitting.value = true;
  try {
    const result = await submitFeedback(draft, runtime, hostWindow());
    rememberSubmission();
    submittedId.value = result.id;
    submittedReceiptPersisted.value = result.receiptPersisted;
    loadReceipts();
  } catch (error) {
    serviceError.value =
      error instanceof Error ? error.message : '提交失败，请稍后再试。';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  const document = props.context.document;
  previousBodyOverflow = document.body.style.overflow;
  previousRootOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  loadReceipts();
  if (receipts.value.length) void refreshReceipts({ silent: true });
});

onUnmounted(() => {
  const document = props.context.document;
  document.body.style.overflow = previousBodyOverflow;
  document.documentElement.style.overflow = previousRootOverflow;
});
</script>

<template>
  <div class="feedback-overlay" @click.self="context.api.closePanel('feedback')">
    <section
      class="feedback-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
    >
      <header class="dialog-header">
        <div>
          <span>ALPHA FEEDBACK</span>
          <h1 id="feedback-title">Bug 与意见反馈</h1>
        </div>
        <button
          type="button"
          class="close"
          aria-label="关闭反馈窗口"
          @click="context.api.closePanel('feedback')"
        >
          ×
        </button>
      </header>

      <nav class="feedback-tabs" aria-label="反馈窗口">
        <button
          type="button"
          :class="{ active: view === 'submit' }"
          @click="showSubmissionForm"
        >
          提交反馈
        </button>
        <button
          type="button"
          :class="{ active: view === 'receipts' }"
          @click="showReceipts"
        >
          我的回执 <span>{{ receipts.length }}</span>
        </button>
      </nav>

      <div v-if="submittedId" class="success-state">
        <div class="success-mark">✓</div>
        <h2>反馈已送达</h2>
        <p v-if="submittedId === 'received'">
          谢谢你帮助完善欧西亚斯 {{ runtime.channel === 'beta' ? 'Beta' : 'Alpha' }}。
        </p>
        <p v-else-if="submittedReceiptPersisted">
          谢谢你帮助完善欧西亚斯 {{ runtime.channel === 'beta' ? 'Beta' : 'Alpha' }}。回执已保存在当前终端，可随时查看作者是否已读、是否解决以及给你的留言。
        </p>
        <p v-else class="persistence-warning">
          反馈已经成功送达，但当前终端未能保存回执。请先复制下面的反馈编号留存；关闭窗口后，本终端将无法在“我的回执”中查询这条反馈。
        </p>
        <code v-if="submittedId !== 'received'">
          反馈编号：{{ submittedId }}
        </code>
        <div class="success-actions">
          <button
            type="button"
            class="secondary-button"
            @click="context.api.closePanel('feedback')"
          >
            完成
          </button>
          <button
            v-if="submittedReceiptPersisted"
            type="button"
            class="primary-button"
            @click="showReceipts"
          >
            查看我的回执
          </button>
        </div>
      </div>

      <main v-else-if="view === 'receipts'" class="receipt-center">
        <div class="receipt-toolbar">
          <div>
            <strong>保存在当前终端的反馈回执</strong>
            <p>回执查询凭证不会公开给其他玩家。打开本窗口时会自动检查一次进度。</p>
          </div>
          <button
            type="button"
            class="primary-button"
            :disabled="refreshingReceipts || receipts.length === 0"
            @click="refreshReceipts()"
          >
            {{ refreshingReceipts ? '查询中……' : '查询最新进度' }}
          </button>
        </div>

        <div v-if="receipts.length === 0" class="receipt-empty">
          <strong>此终端还没有反馈回执</strong>
          <p>成功提交 Bug 或意见后，回执会自动保存在这里。</p>
          <button type="button" class="primary-button" @click="showSubmissionForm">
            提交第一条反馈
          </button>
        </div>

        <div v-else class="receipt-list">
          <article
            v-for="receipt in receipts"
            :key="receipt.id"
            :class="`receipt-status-${receiptState(receipt)}`"
          >
            <header>
              <div>
                <small>{{ receipt.kind === 'bug' ? 'BUG' : '意见 / 建议' }}</small>
                <h2>{{ receipt.title }}</h2>
              </div>
              <strong>{{ receiptStatusLabel(receipt) }}</strong>
            </header>

            <p v-if="receipt.authorReply" class="author-reply">
              <b>作者留言</b>
              <span>{{ receipt.authorReply }}</span>
            </p>

            <dl>
              <div>
                <dt>提交时间</dt>
                <dd>{{ formatTime(receipt.createdAt) }}</dd>
              </div>
              <div v-if="receipt.reviewedAt">
                <dt>查看时间</dt>
                <dd>{{ formatTime(receipt.reviewedAt) }}</dd>
              </div>
              <div v-if="receipt.resolvedAt">
                <dt>解决时间</dt>
                <dd>{{ formatTime(receipt.resolvedAt) }}</dd>
              </div>
              <div>
                <dt>最后查询</dt>
                <dd>{{ formatTime(receipt.lastCheckedAt) }}</dd>
              </div>
            </dl>

            <footer>
              <code>编号：{{ receipt.id }}</code>
              <button
                type="button"
                class="secondary-button"
                :disabled="refreshingReceipts || Boolean(refreshingReceiptId)"
                @click="refreshOneReceipt(receipt)"
              >
                {{ refreshingReceiptId === receipt.id ? '查询中……' : '查询此回执' }}
              </button>
            </footer>
          </article>
        </div>

        <p v-if="receiptNotice" class="receipt-notice" aria-live="polite">
          {{ receiptNotice }}
        </p>
        <p v-if="receiptError" class="service-error" aria-live="polite">
          {{ receiptError }}
        </p>
      </main>

      <form v-else @submit.prevent="submit">
        <div class="kind-switch" aria-label="反馈类型">
          <button
            type="button"
            :class="{ active: isBug }"
            @click="selectKind('bug')"
          >
            <b>BUG</b>
            <span>遇到了错误或异常</span>
          </button>
          <button
            type="button"
            :class="{ active: !isBug }"
            @click="selectKind('suggestion')"
          >
            <b>意见 / 建议</b>
            <span>希望增加或改进功能</span>
          </button>
        </div>

        <aside class="writing-guide">
          <strong>{{ isBug ? '怎样写出容易复现的 Bug？' : '怎样写出清楚的建议？' }}</strong>
          <ol>
            <li v-for="tip in writingTips" :key="tip">{{ tip }}</li>
          </ol>
        </aside>

        <label class="field">
          <span>
            标题
            <small>{{ draft.title.length }}/{{ FEEDBACK_LIMITS.title }}</small>
          </span>
          <input
            v-model="draft.title"
            required
            minlength="4"
            :maxlength="FEEDBACK_LIMITS.title"
            :placeholder="
              isBug
                ? '例如：背包里装备卡片后数量没有减少'
                : '例如：希望地图能标记已采集的资源'
            "
          />
        </label>

        <label class="field">
          <span>
            {{ isBug ? '问题说明' : '建议内容' }}
            <small>{{ draft.details.length }}/{{ FEEDBACK_LIMITS.details }}</small>
          </span>
          <textarea
            v-model="draft.details"
            required
            minlength="10"
            :maxlength="FEEDBACK_LIMITS.details"
            :placeholder="
              isBug
                ? '问题发生在哪个界面？大约从什么时候开始？出现频率如何？'
                : '使用场景是什么？现在有什么不方便？你希望怎样改？'
            "
          ></textarea>
        </label>

        <label v-if="isBug" class="field">
          <span>
            复现步骤
            <small>
              {{ draft.reproductionSteps.length }}/{{ FEEDBACK_LIMITS.reproductionSteps }}
            </small>
          </span>
          <textarea
            v-model="draft.reproductionSteps"
            required
            minlength="10"
            :maxlength="FEEDBACK_LIMITS.reproductionSteps"
            placeholder="1. 打开……&#10;2. 点击……&#10;3. 选择……&#10;4. 问题出现"
          ></textarea>
        </label>

        <div class="result-grid">
          <label class="field">
            <span>{{ isBug ? '期望结果' : '希望达到的效果' }}</span>
            <textarea
              v-model="draft.expectedResult"
              required
              minlength="4"
              :maxlength="FEEDBACK_LIMITS.expectedResult"
              :placeholder="isBug ? '你原本期待发生什么？' : '改完后理想的使用体验是什么？'"
            ></textarea>
          </label>
          <label v-if="isBug" class="field">
            <span>实际结果</span>
            <textarea
              v-model="draft.actualResult"
              required
              minlength="4"
              :maxlength="FEEDBACK_LIMITS.actualResult"
              placeholder="实际发生了什么？有报错文字的话请原样贴上。"
            ></textarea>
          </label>
        </div>

        <label class="field">
          <span>
            联系方式
            <em>选填</em>
            <small>{{ draft.contact.length }}/{{ FEEDBACK_LIMITS.contact }}</small>
          </span>
          <input
            v-model="draft.contact"
            :maxlength="FEEDBACK_LIMITS.contact"
            placeholder="Discord 用户名或其他方便联系你的方式"
          />
        </label>

        <label class="honeypot" aria-hidden="true">
          网站
          <input v-model="website" tabindex="-1" autocomplete="off" />
        </label>

        <p class="privacy-note">
          提交时会自动附带 {{ runtime.channel === 'beta' ? 'Beta' : 'Alpha' }}
          版本、构建号和基本浏览器环境，方便定位问题；不会上传聊天正文、角色存档或
          MVU 内容。
        </p>

        <ul v-if="errors.length" class="form-errors" aria-live="polite">
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>
        <p v-if="serviceError" class="service-error" aria-live="polite">
          {{ serviceError }}
        </p>

        <footer class="dialog-actions">
          <button
            type="button"
            class="secondary-button"
            @click="context.api.closePanel('feedback')"
          >
            取消
          </button>
          <button type="submit" class="primary-button" :disabled="submitting">
            {{ submitting ? '提交中……' : '提交反馈' }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.feedback-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  overflow: auto;
  background: rgba(4, 5, 8, 0.72);
  backdrop-filter: blur(6px);
  font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}

.feedback-dialog {
  width: min(720px, calc(100vw - 28px));
  max-height: calc(100vh - 36px);
  overflow: auto;
  padding: 22px;
  border: 1px solid rgba(212, 168, 67, 0.44);
  border-radius: 20px;
  color: #ddd6ca;
  background:
    radial-gradient(circle at 0 0, rgba(212, 168, 67, 0.12), transparent 32%),
    #101218;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.66);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 17px;
}

.dialog-header span {
  color: #d4a843;
  font-size: 9px;
  letter-spacing: 0.18em;
}

.dialog-header h1 {
  margin: 4px 0 0;
  color: #f5ead0;
  font: 700 24px Georgia, "Noto Serif SC", serif;
}

.feedback-tabs {
  display: flex;
  gap: 5px;
  margin: -3px 0 17px;
  padding: 5px;
  border: 1px solid #292d35;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.018);
}

.feedback-tabs button {
  flex: 1;
  padding: 8px 12px;
  border: 0;
  border-radius: 7px;
  color: #8f8a82;
  background: transparent;
  font: 700 10px inherit;
  cursor: pointer;
}

.feedback-tabs button.active {
  color: #f1d784;
  background: rgba(212, 168, 67, 0.11);
}

.feedback-tabs span {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  margin-left: 4px;
  border-radius: 999px;
  color: #d5c9af;
  background: rgba(255, 255, 255, 0.07);
  font-size: 9px;
}

.close {
  padding: 0 5px;
  border: 0;
  color: #9d968a;
  background: transparent;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
}

.close:hover {
  color: #f0d68a;
}

.kind-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.kind-switch button {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid #30343e;
  border-radius: 11px;
  color: #979187;
  background: rgba(255, 255, 255, 0.025);
  text-align: left;
  cursor: pointer;
}

.kind-switch button.active {
  border-color: rgba(212, 168, 67, 0.7);
  color: #f1d784;
  background: rgba(212, 168, 67, 0.09);
  box-shadow: inset 0 0 0 1px rgba(212, 168, 67, 0.08);
}

.kind-switch b {
  font-size: 12px;
}

.kind-switch span {
  font-size: 10px;
}

.writing-guide {
  margin: 12px 0 16px;
  padding: 12px 14px;
  border-left: 3px solid #7d6bb3;
  border-radius: 0 9px 9px 0;
  color: #c9bfda;
  background: rgba(100, 79, 140, 0.13);
}

.writing-guide strong {
  font-size: 11px;
}

.writing-guide ol {
  display: grid;
  gap: 3px;
  margin: 7px 0 0;
  padding-left: 19px;
  color: #9f96ad;
  font-size: 10px;
  line-height: 1.45;
}

form {
  display: grid;
  gap: 11px;
}

.field {
  display: grid;
  gap: 6px;
}

.field > span {
  display: flex;
  align-items: baseline;
  gap: 7px;
  color: #d8d0c3;
  font-size: 11px;
  font-weight: 700;
}

.field small {
  margin-left: auto;
  color: #6f6c67;
  font-size: 9px;
  font-weight: 400;
}

.field em {
  color: #77736d;
  font-size: 9px;
  font-style: normal;
  font-weight: 400;
}

.field input,
.field textarea {
  width: 100%;
  padding: 10px 11px;
  border: 1px solid #30343e;
  border-radius: 9px;
  outline: none;
  color: #e7e0d6;
  background: #0b0d12;
  font: 11px/1.55 inherit;
  resize: vertical;
}

.field textarea {
  min-height: 82px;
}

.field input:focus,
.field textarea:focus {
  border-color: rgba(212, 168, 67, 0.72);
  box-shadow: 0 0 0 3px rgba(212, 168, 67, 0.08);
}

.field input::placeholder,
.field textarea::placeholder {
  color: #5f5e5b;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.result-grid > :only-child {
  grid-column: 1 / -1;
}

.honeypot {
  position: absolute;
  left: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.privacy-note {
  margin: 2px 0 0;
  padding: 9px 11px;
  border-radius: 8px;
  color: #858077;
  background: rgba(255, 255, 255, 0.025);
  font-size: 9px;
  line-height: 1.5;
}

.form-errors,
.service-error {
  margin: 0;
  padding: 10px 12px 10px 30px;
  border: 1px solid rgba(194, 93, 65, 0.35);
  border-radius: 9px;
  color: #f3b5a2;
  background: rgba(145, 56, 34, 0.13);
  font-size: 10px;
  line-height: 1.5;
}

.service-error {
  padding-left: 12px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding-top: 4px;
}

.primary-button,
.secondary-button {
  min-width: 96px;
  padding: 10px 16px;
  border-radius: 9px;
  font: 700 11px inherit;
  cursor: pointer;
}

.secondary-button:disabled {
  cursor: wait;
  opacity: 0.5;
}

.receipt-center {
  display: grid;
  gap: 13px;
}

.receipt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 13px 14px;
  border: 1px solid rgba(212, 168, 67, 0.24);
  border-radius: 10px;
  background: rgba(212, 168, 67, 0.055);
}

.receipt-toolbar strong {
  color: #ead99f;
  font-size: 11px;
}

.receipt-toolbar p {
  margin: 5px 0 0;
  color: #8f897f;
  font-size: 9px;
  line-height: 1.5;
}

.receipt-toolbar .primary-button {
  flex: 0 0 auto;
}

.receipt-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 44px 15px 34px;
  color: #918b82;
  text-align: center;
}

.receipt-empty strong {
  color: #d8d0c4;
  font: 700 18px Georgia, "Noto Serif SC", serif;
}

.receipt-empty p {
  margin: 0 0 8px;
  font-size: 10px;
}

.receipt-list {
  display: grid;
  gap: 11px;
}

.receipt-list article {
  padding: 14px;
  border: 1px solid #30343d;
  border-left: 3px solid #8a8174;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.022);
}

.receipt-list article.receipt-status-viewed {
  border-left-color: #7b9bd0;
}

.receipt-list article.receipt-status-resolved {
  border-left-color: #62bb82;
}

.receipt-list article.receipt-status-rejected {
  border-left-color: #b98667;
}

.receipt-list article > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.receipt-list small {
  color: #d4a843;
  font-size: 8px;
  letter-spacing: 0.13em;
}

.receipt-list h2 {
  margin: 4px 0 0;
  color: #eee5d7;
  font: 700 16px/1.3 Georgia, "Noto Serif SC", serif;
}

.receipt-list article > header > strong {
  flex: 0 0 auto;
  padding: 5px 9px;
  border-radius: 999px;
  color: #ded6ca;
  background: #292e37;
  font-size: 9px;
}

.receipt-status-viewed > header > strong {
  color: #b9d1f5 !important;
  background: rgba(75, 111, 166, 0.22) !important;
}

.receipt-status-resolved > header > strong {
  color: #a8e2bd !important;
  background: rgba(63, 143, 94, 0.2) !important;
}

.receipt-status-rejected > header > strong {
  color: #e1b89e !important;
  background: rgba(153, 96, 62, 0.2) !important;
}

.author-reply {
  display: grid;
  gap: 5px;
  margin: 12px 0;
  padding: 11px 12px;
  border: 1px solid rgba(212, 168, 67, 0.2);
  border-radius: 8px;
  color: #d9d1c4;
  background: rgba(212, 168, 67, 0.055);
  font-size: 10px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.author-reply b {
  color: #e3c875;
  font-size: 9px;
}

.receipt-list dl {
  display: grid;
  gap: 4px;
  margin: 12px 0 0;
}

.receipt-list dl div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 9px;
}

.receipt-list dt {
  color: #77736d;
}

.receipt-list dd {
  margin: 0;
  color: #bdb5a9;
  text-align: right;
}

.receipt-list footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 13px;
}

.receipt-list code {
  min-width: 0;
  color: #77736d;
  font-size: 8px;
  overflow-wrap: anywhere;
}

.receipt-list footer button {
  flex: 0 0 auto;
  min-width: 86px;
  padding: 7px 10px;
}

.receipt-notice {
  margin: 0;
  padding: 9px 11px;
  border: 1px solid rgba(80, 171, 115, 0.27);
  border-radius: 8px;
  color: #9ed4b2;
  background: rgba(54, 132, 83, 0.1);
  font-size: 10px;
}

.primary-button {
  border: 1px solid #d4a843;
  color: #1b150a;
  background: linear-gradient(180deg, #e2bd61, #bb8c2c);
}

.primary-button:disabled {
  cursor: wait;
  opacity: 0.58;
}

.secondary-button {
  border: 1px solid #373a42;
  color: #aaa399;
  background: transparent;
}

.success-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 36px 16px 25px;
  text-align: center;
}

.success-mark {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  border: 1px solid rgba(100, 207, 145, 0.54);
  border-radius: 50%;
  color: #79dda4;
  background: rgba(67, 166, 109, 0.1);
  font-size: 27px;
}

.success-state h2 {
  margin: 4px 0 0;
  color: #f0e7d8;
  font: 700 22px Georgia, "Noto Serif SC", serif;
}

.success-state p {
  max-width: 480px;
  margin: 0;
  color: #9b958c;
  font-size: 11px;
  line-height: 1.6;
}

.success-state .persistence-warning {
  padding: 10px 12px;
  border: 1px solid rgba(210, 150, 67, 0.34);
  border-radius: 9px;
  color: #e3bf8b;
  background: rgba(155, 96, 33, 0.11);
}

.success-state code {
  padding: 7px 9px;
  border-radius: 7px;
  color: #b9b0a3;
  background: #090a0e;
  font-size: 9px;
  overflow-wrap: anywhere;
}

.success-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

@media (max-width: 600px) {
  .feedback-overlay {
    align-items: start;
    padding: 9px;
  }

  .feedback-dialog {
    width: 100%;
    max-height: calc(100vh - 18px);
    padding: 17px 14px;
    border-radius: 15px;
  }

  .dialog-header h1 {
    font-size: 21px;
  }

  .result-grid {
    grid-template-columns: 1fr;
  }

  .receipt-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .receipt-toolbar .primary-button {
    width: 100%;
  }

  .receipt-list footer {
    align-items: stretch;
    flex-direction: column;
  }

  .receipt-list footer button {
    width: 100%;
  }

  .dialog-actions {
    position: sticky;
    bottom: -17px;
    margin: 0 -14px -17px;
    padding: 11px 14px 14px;
    background: linear-gradient(transparent, #101218 24%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .feedback-overlay {
    backdrop-filter: none;
  }
}
</style>
