<script setup lang="ts">
/* global Event, HTMLInputElement */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import type { PanelContext } from '@/kernel/public-api';
import type {
  SurveyAnswer,
  SurveyAnswers,
  SurveyListEntry,
  SurveyQuestion,
} from '@/surveys/types';

const props = defineProps<{ context: PanelContext }>();
const entries = ref<SurveyListEntry[]>([]);
const selectedId = ref('');
const answers = reactive<SurveyAnswers>({});
const discordId = ref('');
const loading = ref(true);
const submitting = ref(false);
const serviceError = ref('');
const formErrors = ref<string[]>([]);
const successMessage = ref('');
let previousBodyOverflow = '';
let previousRootOverflow = '';

const selected = computed(
  () =>
    entries.value.find(
      (entry) => entry.definition.id === selectedId.value,
    ) ?? entries.value[0],
);
const submitted = computed(
  () => selected.value?.response?.status === 'submitted',
);
const ignored = computed(
  () => selected.value?.response?.status === 'ignored',
);
const canSubmit = computed(
  () => Boolean(selected.value?.acceptingResponses && !submitted.value),
);

function cloneAnswers(source: SurveyAnswers): SurveyAnswers {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

function resetDraft(entry: SurveyListEntry | undefined): void {
  for (const key of Object.keys(answers)) delete answers[key];
  if (!entry) {
    discordId.value = '';
    return;
  }
  const restored = cloneAnswers(entry.response?.answers ?? {});
  for (const question of entry.definition.questions) {
    answers[question.id] =
      restored[question.id] ??
      (question.type === 'multiple-choice' ? [] : '');
  }
  discordId.value = entry.response?.discordId ?? '';
  formErrors.value = [];
  serviceError.value = '';
  successMessage.value = '';
}

function selectSurvey(entry: SurveyListEntry): void {
  selectedId.value = entry.definition.id;
  resetDraft(entry);
}

async function load(refresh = true): Promise<void> {
  loading.value = true;
  serviceError.value = '';
  try {
    const next = await props.context.api.listSurveys({ refresh });
    entries.value = next;
    const entry =
      next.find((candidate) => candidate.definition.id === selectedId.value) ??
      next[0];
    selectedId.value = entry?.definition.id ?? '';
    resetDraft(entry);
  } catch (error) {
    serviceError.value =
      error instanceof Error ? error.message : '问卷清单读取失败。';
  } finally {
    loading.value = false;
  }
}

function stringAnswer(questionId: string): string {
  const answer = answers[questionId];
  return typeof answer === 'string' ? answer : '';
}

function setStringAnswer(questionId: string, event: Event): void {
  answers[questionId] = (event.target as HTMLInputElement).value;
}

function selectedOptions(questionId: string): string[] {
  const answer = answers[questionId];
  return Array.isArray(answer) ? answer : [];
}

function toggleOption(questionId: string, value: string): void {
  const current = selectedOptions(questionId);
  answers[questionId] = current.includes(value)
    ? current.filter((candidate) => candidate !== value)
    : [...current, value];
}

function answerLabel(
  question: SurveyQuestion,
  answer: SurveyAnswer | undefined,
): string {
  if (answer === undefined || answer === '') return '未填写';
  const values = Array.isArray(answer) ? answer : [answer];
  if (
    question.type === 'single-choice' ||
    question.type === 'multiple-choice'
  ) {
    const labels = new Map(
      (question.options ?? []).map((option) => [option.value, option.label]),
    );
    return values.map((value) => labels.get(value) ?? value).join('、');
  }
  return values.join('');
}

function statusLabel(entry: SurveyListEntry): string {
  if (entry.response?.status === 'submitted') return '已提交';
  if (entry.response?.status === 'ignored') return '已忽略提醒';
  if (!entry.acceptingResponses) return '已结束';
  return '待填写';
}

function formattedTime(value: number | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '';
}

async function ignoreCurrent(): Promise<void> {
  const entry = selected.value;
  if (!entry || submitted.value) return;
  serviceError.value = '';
  try {
    await props.context.api.ignoreSurvey(entry.definition.id);
    await load(false);
    successMessage.value = '已忽略自动提醒，你仍可从悬浮窗再次打开并填写。';
  } catch (error) {
    serviceError.value =
      error instanceof Error ? error.message : '忽略问卷失败。';
  }
}

async function submitCurrent(): Promise<void> {
  const entry = selected.value;
  if (!entry || !canSubmit.value || submitting.value) return;
  formErrors.value = [];
  serviceError.value = '';
  successMessage.value = '';
  submitting.value = true;
  try {
    await props.context.api.submitSurvey(entry.definition.id, {
      answers: cloneAnswers(answers),
      discordId: discordId.value,
    });
    await load(false);
    successMessage.value = '问卷已提交。答案现已锁定，只能查看。';
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '问卷提交失败。';
    formErrors.value = [message];
  } finally {
    submitting.value = false;
  }
}

function close(): void {
  void props.context.api.closePanel('surveys');
}

onMounted(() => {
  const document = props.context.document;
  previousBodyOverflow = document.body.style.overflow;
  previousRootOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  void load(true);
});

onUnmounted(() => {
  const document = props.context.document;
  document.body.style.overflow = previousBodyOverflow;
  document.documentElement.style.overflow = previousRootOverflow;
});
</script>

<template>
  <div class="survey-overlay" @click.self="close">
    <section
      class="survey-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="survey-title"
    >
      <header class="survey-header">
        <div>
          <span>PLAYER VOICE</span>
          <h1 id="survey-title">调查与意见收集</h1>
          <p>每份问卷只能提交一次，提交后答案不可修改。</p>
        </div>
        <button type="button" class="close" aria-label="关闭问卷" @click="close">
          ×
        </button>
      </header>

      <div v-if="loading" class="center-state">
        <i></i>
        <p>正在读取最新问卷…</p>
      </div>

      <div v-else-if="serviceError && entries.length === 0" class="center-state error">
        <b>!</b>
        <h2>暂时无法打开问卷</h2>
        <p>{{ serviceError }}</p>
        <button type="button" @click="load(true)">重新读取</button>
      </div>

      <div v-else-if="entries.length === 0" class="center-state">
        <b>◇</b>
        <h2>目前没有问卷</h2>
        <p>有新的调查或单项意见收集时，这里会自动出现。</p>
        <button type="button" @click="load(true)">检查更新</button>
      </div>

      <div v-else class="survey-layout">
        <aside class="survey-list" aria-label="问卷列表">
          <button
            v-for="entry in entries"
            :key="entry.definition.id"
            type="button"
            :class="{
              selected: entry.definition.id === selected?.definition.id,
              completed: entry.response?.status === 'submitted',
            }"
            @click="selectSurvey(entry)"
          >
            <small>{{ entry.definition.kind === 'single' ? '单项征集' : '调查问卷' }}</small>
            <strong>{{ entry.definition.title }}</strong>
            <em>{{ statusLabel(entry) }}</em>
          </button>
          <button type="button" class="refresh" @click="load(true)">
            ↻ 检查新问卷
          </button>
        </aside>

        <main v-if="selected" class="survey-content">
          <div class="survey-intro">
            <div>
              <span>{{ selected.definition.kind === 'single' ? 'QUICK POLL' : 'SURVEY' }}</span>
              <h2>{{ selected.definition.title }}</h2>
            </div>
            <b :class="selected.response?.status">
              {{ statusLabel(selected) }}
            </b>
          </div>
          <p v-if="selected.definition.description" class="description">
            {{ selected.definition.description }}
          </p>

          <div v-if="successMessage" class="notice success">
            {{ successMessage }}
          </div>
          <div v-if="serviceError" class="notice error">{{ serviceError }}</div>

          <section v-if="submitted" class="readonly-summary">
            <header>
              <div>
                <span>SUBMITTED</span>
                <h3>你的回答</h3>
              </div>
              <time :datetime="String(selected.response?.submittedAt ?? '')">
                {{ formattedTime(selected.response?.submittedAt) }}
              </time>
            </header>
            <article
              v-for="(question, index) in selected.definition.questions"
              :key="question.id"
            >
              <small>问题 {{ index + 1 }}</small>
              <h4>{{ question.title }}</h4>
              <p>{{ answerLabel(question, selected.response?.answers[question.id]) }}</p>
            </article>
            <article>
              <small>选填信息</small>
              <h4>Discord ID</h4>
              <p>{{ selected.response?.discordId || '未填写' }}</p>
            </article>
            <footer>
              该问卷已经锁定，无法再次填写或修改。
            </footer>
          </section>

          <form v-else class="survey-form" @submit.prevent="submitCurrent">
            <fieldset
              v-for="(question, index) in selected.definition.questions"
              :key="question.id"
              class="question"
            >
              <legend>
                <small>问题 {{ index + 1 }}</small>
                <strong>
                  {{ question.title }}
                  <i v-if="question.required">必填</i>
                </strong>
                <span v-if="question.description">{{ question.description }}</span>
              </legend>

              <div
                v-if="question.type === 'single-choice'"
                class="choice-list"
              >
                <label v-for="option in question.options" :key="option.value">
                  <input
                    type="radio"
                    :name="question.id"
                    :value="option.value"
                    :checked="stringAnswer(question.id) === option.value"
                    @change="answers[question.id] = option.value"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>

              <div
                v-else-if="question.type === 'multiple-choice'"
                class="choice-list"
              >
                <label v-for="option in question.options" :key="option.value">
                  <input
                    type="checkbox"
                    :value="option.value"
                    :checked="selectedOptions(question.id).includes(option.value)"
                    @change="toggleOption(question.id, option.value)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>

              <input
                v-else-if="question.type === 'short-text'"
                class="text-answer"
                type="text"
                :value="stringAnswer(question.id)"
                :maxlength="question.maxLength ?? 300"
                placeholder="请输入回答"
                @input="setStringAnswer(question.id, $event)"
              />

              <textarea
                v-else
                class="text-answer long"
                :value="stringAnswer(question.id)"
                :maxlength="question.maxLength ?? 2000"
                placeholder="请输入回答"
                @input="setStringAnswer(question.id, $event)"
              ></textarea>
            </fieldset>

            <label class="discord-field">
              <span>
                Discord ID
                <small>选填</small>
              </span>
              <input
                v-model="discordId"
                type="text"
                maxlength="100"
                placeholder="如希望后续联系，可填写 Discord ID"
              />
              <em>除非你主动填写，否则问卷不会收集任何账号身份。</em>
            </label>

            <ul v-if="formErrors.length" class="form-errors">
              <li v-for="error in formErrors" :key="error">{{ error }}</li>
            </ul>

            <footer class="form-actions">
              <button
                v-if="!ignored"
                type="button"
                class="secondary"
                @click="ignoreCurrent"
              >
                忽略提醒
              </button>
              <span v-else>已忽略自动提醒，仍可自愿填写。</span>
              <button
                type="submit"
                class="primary"
                :disabled="!canSubmit || submitting"
              >
                {{ submitting ? '正在提交…' : canSubmit ? '提交并锁定答案' : '已停止收集' }}
              </button>
            </footer>
          </form>
        </main>
      </div>
    </section>
  </div>
</template>

<style scoped>
.survey-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  color: #e9e2d7;
  background: rgba(4, 6, 10, 0.82);
  backdrop-filter: blur(12px);
  font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}

.survey-dialog {
  width: min(980px, 100%);
  height: min(760px, calc(100vh - 36px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(212, 168, 67, 0.48);
  border-radius: 22px;
  background:
    radial-gradient(circle at 0 0, rgba(212, 168, 67, 0.12), transparent 34%),
    #0d1016;
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.68);
}

.survey-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid #292c34;
  background: rgba(255, 255, 255, 0.018);
}

.survey-header > div { display: grid; gap: 3px; }
.survey-header span,
.survey-intro span,
.readonly-summary header span {
  color: #d4a843;
  font: 700 10px/1.2 Georgia, serif;
  letter-spacing: 0.24em;
}
.survey-header h1 { margin: 0; color: #f7f1e8; font: 600 24px/1.25 Georgia, "Noto Serif SC", serif; }
.survey-header p { margin: 0; color: #8f8a82; font-size: 11px; }
.close {
  width: 40px;
  height: 40px;
  border: 1px solid #343842;
  border-radius: 12px;
  color: #a9a296;
  background: transparent;
  font-size: 25px;
  cursor: pointer;
}
.close:hover { color: #f0d68a; border-color: rgba(212, 168, 67, 0.5); }

.survey-layout { min-height: 0; display: grid; grid-template-columns: 245px minmax(0, 1fr); }
.survey-list {
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  border-right: 1px solid #272a31;
  background: rgba(0, 0, 0, 0.16);
}
.survey-list button {
  width: 100%;
  display: grid;
  gap: 6px;
  margin: 0 0 8px;
  padding: 13px;
  border: 1px solid #2c3039;
  border-radius: 13px;
  color: #aca69c;
  text-align: left;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
}
.survey-list button:hover,
.survey-list button.selected { border-color: rgba(212, 168, 67, 0.56); background: rgba(212, 168, 67, 0.08); }
.survey-list button small { color: #827d74; font-size: 9px; letter-spacing: 0.12em; }
.survey-list button strong { color: #ded6ca; font-size: 13px; line-height: 1.45; }
.survey-list button em { color: #d1ad5e; font: normal 10px/1.2 inherit; }
.survey-list button.completed em { color: #79cda4; }
.survey-list button.refresh { place-items: center; margin-top: 12px; text-align: center; }

.survey-content { min-width: 0; overflow-y: auto; padding: 24px clamp(18px, 4vw, 38px) 36px; }
.survey-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.survey-intro > div { display: grid; gap: 6px; }
.survey-intro h2 { margin: 0; color: #f4ede3; font: 600 clamp(22px, 4vw, 30px)/1.25 Georgia, "Noto Serif SC", serif; }
.survey-intro > b { flex: 0 0 auto; padding: 7px 10px; border: 1px solid rgba(212, 168, 67, 0.35); border-radius: 999px; color: #d1ad5e; font-size: 10px; }
.survey-intro > b.submitted { color: #74d1a0; border-color: rgba(84, 191, 137, 0.35); }
.description { margin: 14px 0 22px; color: #a59f95; font-size: 13px; line-height: 1.75; }

.question { min-width: 0; margin: 0 0 15px; padding: 18px; border: 1px solid #2a2e36; border-radius: 15px; background: rgba(255, 255, 255, 0.018); }
.question legend { width: 100%; display: grid; gap: 6px; padding: 0; }
.question legend small { color: #7d786f; font-size: 9px; letter-spacing: 0.12em; }
.question legend strong { color: #e5ddd2; font-size: 14px; line-height: 1.5; }
.question legend strong i { margin-left: 6px; color: #d5ab4e; font: normal 9px/1 inherit; }
.question legend > span { color: #8d887f; font-size: 11px; line-height: 1.55; }
.choice-list { display: grid; gap: 8px; margin-top: 13px; }
.choice-list label { display: flex; align-items: center; gap: 9px; padding: 10px 12px; border: 1px solid #30343d; border-radius: 10px; color: #bbb4a9; background: rgba(0, 0, 0, 0.14); cursor: pointer; }
.choice-list label:has(input:checked) { border-color: rgba(212, 168, 67, 0.58); color: #f0d68a; background: rgba(212, 168, 67, 0.08); }
.choice-list input { accent-color: #d4a843; }
.text-answer,
.discord-field input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 13px;
  padding: 11px 12px;
  border: 1px solid #30343d;
  border-radius: 10px;
  color: #e5ddd2;
  background: rgba(0, 0, 0, 0.22);
  font: inherit;
}
.text-answer.long { min-height: 120px; resize: vertical; line-height: 1.6; }
.text-answer:focus,
.discord-field input:focus { outline: none; border-color: rgba(212, 168, 67, 0.62); }

.discord-field { display: grid; gap: 4px; margin-top: 20px; padding: 17px; border: 1px solid rgba(131, 99, 157, 0.32); border-radius: 14px; background: rgba(102, 72, 126, 0.08); }
.discord-field > span { color: #d7c8e1; font-weight: 700; font-size: 13px; }
.discord-field small { margin-left: 6px; color: #9b8aa6; font-weight: 400; }
.discord-field em { color: #817789; font: normal 10px/1.5 inherit; }

.form-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; }
.form-actions > span { color: #8e897f; font-size: 10px; }
.form-actions button,
.center-state button {
  min-height: 40px;
  padding: 0 16px;
  border-radius: 11px;
  font: 700 12px/1 inherit;
  cursor: pointer;
}
.form-actions .secondary,
.center-state button { border: 1px solid #353943; color: #aaa398; background: transparent; }
.form-actions .primary { border: 1px solid rgba(212, 168, 67, 0.72); color: #17120b; background: linear-gradient(135deg, #e2bd62, #b5812e); }
.form-actions button:disabled { cursor: not-allowed; opacity: 0.45; }

.notice { margin: 12px 0; padding: 10px 12px; border-radius: 10px; font-size: 11px; line-height: 1.5; }
.notice.success { color: #bcebd3; background: rgba(54, 148, 104, 0.14); }
.notice.error,
.form-errors { color: #ffd4c6; background: rgba(164, 67, 45, 0.16); }
.form-errors { margin: 13px 0 0; padding: 10px 12px 10px 30px; border-radius: 10px; font-size: 11px; }

.readonly-summary { display: grid; gap: 11px; }
.readonly-summary > header { display: flex; justify-content: space-between; gap: 14px; padding: 14px 0; border-bottom: 1px solid #2a2d34; }
.readonly-summary h3 { margin: 4px 0 0; color: #e8e0d5; }
.readonly-summary time { color: #858077; font-size: 10px; }
.readonly-summary article { padding: 15px; border: 1px solid #2a2e36; border-radius: 13px; background: rgba(255, 255, 255, 0.018); }
.readonly-summary article small { color: #7e786f; font-size: 9px; }
.readonly-summary article h4 { margin: 5px 0 8px; color: #dcd4c9; font-size: 13px; }
.readonly-summary article p { margin: 0; color: #b8b1a6; font-size: 12px; line-height: 1.7; white-space: pre-wrap; }
.readonly-summary > footer { padding-top: 8px; color: #8d877e; font-size: 10px; }

.center-state { height: 100%; display: grid; place-content: center; justify-items: center; gap: 11px; padding: 30px; text-align: center; }
.center-state i { width: 26px; height: 26px; border: 2px solid #383b43; border-top-color: #d4a843; border-radius: 50%; animation: spin 0.8s linear infinite; }
.center-state b { color: #d4a843; font: 400 34px/1 Georgia, serif; }
.center-state h2,
.center-state p { margin: 0; }
.center-state h2 { color: #e6ded3; }
.center-state p { max-width: 460px; color: #8f8a82; font-size: 12px; line-height: 1.65; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 720px) {
  .survey-overlay { padding: 0; }
  .survey-dialog { width: 100%; height: 100%; border: 0; border-radius: 0; }
  .survey-header { padding: 15px 16px; }
  .survey-header h1 { font-size: 20px; }
  .survey-header p { display: none; }
  .survey-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .survey-list { display: flex; gap: 8px; overflow-x: auto; padding: 10px; border-right: 0; border-bottom: 1px solid #272a31; }
  .survey-list button { flex: 0 0 185px; margin: 0; }
  .survey-list button.refresh { flex-basis: 130px; margin-top: 0; }
  .survey-content { padding: 18px 15px 28px; }
  .form-actions { align-items: stretch; flex-direction: column-reverse; }
  .form-actions button { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .center-state i { animation: none; }
}
</style>
