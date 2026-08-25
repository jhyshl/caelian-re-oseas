import { z } from 'zod';
import type { CaelianDatabase } from '@/storage/database';
import type {
  SurveyAnswer,
  SurveyAnswers,
  SurveyCatalog,
  SurveyCatalogSyncResult,
  SurveyDefinition,
  SurveyListEntry,
  SurveyQuestion,
  SurveyResponseRecord,
  SurveySubmissionDraft,
  SurveyValidation,
} from '@/surveys/types';

const SUPABASE_URL = 'https://tlsdyacdkbcjxbwvyeim.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_EIYn8wiMd0O4tJXQI5Ub4Q_066Uizi1';
const SURVEY_RESPONSE_ENDPOINT =
  `${SUPABASE_URL}/rest/v1/caelian_survey_responses`;

const ALPHA_CATALOG_SOURCES = [
  'https://jhyshl.github.io/caelian-re-oseas/managed-content/surveys/alpha.json',
  'https://caelian-re-oseas-alpha.jianghailou7.chatgpt.site/managed-content/surveys/alpha.json',
] as const;

const identifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);

const optionSchema = z.object({
  value: identifierSchema,
  label: z.string().min(1).max(160),
  freeText: z.boolean().optional(),
  textPlaceholder: z.string().max(160).optional(),
  textMaxLength: z.number().int().min(1).max(1_000).optional(),
});

const questionSchema = z
  .object({
    id: identifierSchema,
    type: z.enum([
      'single-choice',
      'multiple-choice',
      'short-text',
      'long-text',
    ]),
    title: z.string().min(1).max(300),
    description: z.string().max(800).optional(),
    required: z.boolean().default(false),
    options: z.array(optionSchema).max(30).optional(),
    minSelections: z.number().int().min(0).max(30).optional(),
    maxSelections: z.number().int().min(1).max(30).optional(),
    minLength: z.number().int().min(0).max(2_000).optional(),
    maxLength: z.number().int().min(1).max(4_000).optional(),
    legacyFallbackFor: z
      .object({
        questionId: identifierSchema,
        optionValue: identifierSchema,
      })
      .optional(),
  })
  .superRefine((question, context) => {
    const isChoice =
      question.type === 'single-choice' ||
      question.type === 'multiple-choice';
    if (isChoice && (!question.options || question.options.length < 2)) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '选择题至少需要两个选项',
      });
    }
    if (question.options) {
      const values = question.options.map((option) => option.value);
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: '同一题的选项值不能重复',
        });
      }
      if (
        question.type !== 'multiple-choice' &&
        question.options.some((option) => option.freeText)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: '自由填写选项仅支持多选题',
        });
      }
      if (
        question.options.some(
          (option) => option.freeText && option.value.includes('::'),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: '自由填写选项值不能包含双冒号',
        });
      }
    }
    if (
      question.minSelections !== undefined &&
      question.maxSelections !== undefined &&
      question.minSelections > question.maxSelections
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minSelections'],
        message: '最少选择数不能大于最多选择数',
      });
    }
    if (
      question.minLength !== undefined &&
      question.maxLength !== undefined &&
      question.minLength > question.maxLength
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minLength'],
        message: '最短字数不能大于最长字数',
      });
    }
  });

const surveySchema = z
  .object({
    id: identifierSchema,
    revision: z.number().int().min(1),
    kind: z.enum(['survey', 'single']),
    title: z.string().min(1).max(200),
    description: z.string().max(2_000).default(''),
    active: z.boolean(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    questions: z.array(questionSchema).min(1).max(40),
  })
  .superRefine((survey, context) => {
    const questionIds = survey.questions.map((question) => question.id);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: '同一问卷的问题 ID 不能重复',
      });
    }
    for (const field of ['startsAt', 'endsAt'] as const) {
      const value = survey[field];
      if (value && Number.isNaN(Date.parse(value))) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} 必须是有效日期`,
        });
      }
    }
    if (survey.kind === 'single' && survey.questions.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: '单项意见收集只能包含一个问题',
      });
    }
  });

const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    channel: z.literal('alpha'),
    revision: z.string().min(1).max(80),
    surveys: z.array(surveySchema).max(100),
  })
  .superRefine((catalog, context) => {
    const surveyIds = catalog.surveys.map((survey) => survey.id);
    if (new Set(surveyIds).size !== surveyIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['surveys'],
        message: '问卷 ID 不能重复',
      });
    }
  });

const RESPONSE_ID_PREFIX = 'survey:';
const FETCH_TIMEOUT_MS = 8_000;

function responseId(surveyId: string): string {
  return `${RESPONSE_ID_PREFIX}${surveyId}`;
}

export function isSurveyActive(
  survey: SurveyDefinition,
  now = Date.now(),
): boolean {
  if (!survey.active) return false;
  if (survey.startsAt && Date.parse(survey.startsAt) > now) return false;
  if (survey.endsAt && Date.parse(survey.endsAt) <= now) return false;
  return true;
}

function answerIsEmpty(answer: SurveyAnswer | undefined): boolean {
  if (Array.isArray(answer)) return answer.length === 0;
  return typeof answer !== 'string' || answer.trim().length === 0;
}

function allowedOptions(question: SurveyQuestion): Set<string> {
  return new Set((question.options ?? []).map((option) => option.value));
}

function normalizeMultipleChoiceValue(
  question: SurveyQuestion,
  value: string,
): { value?: string; optionValue?: string; error?: string } {
  const exact = question.options?.find((option) => option.value === value);
  if (exact && !exact.freeText) {
    return { value, optionValue: exact.value };
  }
  const freeTextOption = question.options?.find(
    (option) => option.freeText && value.startsWith(`${option.value}::`),
  );
  if (!freeTextOption) {
    if (exact?.freeText) {
      return { error: `“${exact.label}”需要填写具体内容。` };
    }
    return { error: '包含无效选项。' };
  }
  const text = value.slice(freeTextOption.value.length + 2).trim();
  const maximum = freeTextOption.textMaxLength ?? 500;
  if (text.length === 0 || text.length > maximum) {
    return {
      error: `“${freeTextOption.label}”需要填写 1–${maximum} 个字。`,
    };
  }
  return {
    value: `${freeTextOption.value}::${text}`,
    optionValue: freeTextOption.value,
  };
}

function validateQuestionAnswer(
  question: SurveyQuestion,
  rawAnswer: SurveyAnswer | undefined,
): { answer?: SurveyAnswer; error?: string } {
  if (answerIsEmpty(rawAnswer)) {
    return question.required
      ? { error: `“${question.title}”为必填项。` }
      : {};
  }

  if (question.type === 'single-choice') {
    if (
      typeof rawAnswer !== 'string' ||
      !allowedOptions(question).has(rawAnswer)
    ) {
      return { error: `“${question.title}”包含无效选项。` };
    }
    return { answer: rawAnswer };
  }

  if (question.type === 'multiple-choice') {
    if (!Array.isArray(rawAnswer)) {
      return { error: `“${question.title}”的答案格式不正确。` };
    }
    const answer: string[] = [];
    const selectedOptionValues = new Set<string>();
    for (const value of rawAnswer) {
      const normalized = normalizeMultipleChoiceValue(question, value);
      if (
        normalized.error ||
        !normalized.value ||
        !normalized.optionValue
      ) {
        return {
          error: `“${question.title}”${normalized.error ?? '包含无效选项。'}`,
        };
      }
      if (selectedOptionValues.has(normalized.optionValue)) continue;
      selectedOptionValues.add(normalized.optionValue);
      answer.push(normalized.value);
    }
    const minimum = question.minSelections ?? (question.required ? 1 : 0);
    const maximum = question.maxSelections ?? question.options?.length ?? 30;
    if (answer.length < minimum || answer.length > maximum) {
      return {
        error: `“${question.title}”需要选择 ${minimum}–${maximum} 项。`,
      };
    }
    return { answer };
  }

  if (typeof rawAnswer !== 'string') {
    return { error: `“${question.title}”的答案格式不正确。` };
  }
  const answer = rawAnswer.trim();
  const minimum = question.minLength ?? (question.required ? 1 : 0);
  const maximum =
    question.maxLength ?? (question.type === 'short-text' ? 300 : 2_000);
  if (answer.length < minimum || answer.length > maximum) {
    return {
      error: `“${question.title}”需要填写 ${minimum}–${maximum} 个字。`,
    };
  }
  return { answer };
}

export function validateSurveySubmission(
  survey: SurveyDefinition,
  draft: SurveySubmissionDraft,
): SurveyValidation {
  const answers: SurveyAnswers = {};
  const errors: string[] = [];
  for (const question of survey.questions) {
    const result = validateQuestionAnswer(
      question,
      draft.answers[question.id],
    );
    if (result.error) errors.push(result.error);
    if (result.answer !== undefined) answers[question.id] = result.answer;
  }

  const discordId = draft.discordId.trim();
  if (discordId.length > 100) {
    errors.push('Discord ID 不能超过 100 个字。');
  }
  if (JSON.stringify(answers).length > 30_000) {
    errors.push('回答内容过长，请适当精简。');
  }
  return {
    valid: errors.length === 0,
    errors,
    answers,
    discordId,
  };
}

interface SurveySubmissionPayload {
  id: string;
  survey_id: string;
  survey_revision: number;
  survey_kind: SurveyDefinition['kind'];
  submission_token: string;
  answers: SurveyAnswers;
  discord_id: string | null;
}

async function responseMessage(response: Response): Promise<string> {
  if (response.status === 409) {
    return '这台设备已经提交过这份问卷，不能重复填写。';
  }
  if (response.status === 429) {
    return '提交过于频繁，请稍后再试。';
  }
  if (response.status >= 500) {
    return '问卷服务暂时不可用，请稍后再试。';
  }
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message;
    }
  } catch {
    // PostgREST may return an empty response or a non-JSON proxy error.
  }
  return `提交失败（HTTP ${response.status}），请稍后再试。`;
}

export class SurveyService {
  private catalog?: SurveyCatalog;
  private catalogFingerprint = '';
  private refreshInFlight?: Promise<SurveyCatalogSyncResult>;
  private readonly submissions = new Map<
    string,
    Promise<SurveyResponseRecord>
  >();

  constructor(
    private readonly db: CaelianDatabase,
    private readonly sourceWindow: Window,
    private readonly channel: 'alpha' | 'beta' = 'alpha',
    private readonly catalogSources = defaultCatalogSources(channel),
  ) {}

  private acceptsResponses(survey: SurveyDefinition): boolean {
    return this.channel === 'alpha' && isSurveyActive(survey);
  }

  async refreshCatalog(): Promise<SurveyCatalogSyncResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const task = this.performCatalogRefresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    this.refreshInFlight = task;
    return task;
  }

  private async performCatalogRefresh(): Promise<SurveyCatalogSyncResult> {
    const errors: string[] = [];
    for (const source of this.catalogSources) {
      const controller = new AbortController();
      const timeout = this.sourceWindow.setTimeout(
        () => controller.abort(),
        FETCH_TIMEOUT_MS,
      );
      try {
        const url = new URL(source);
        url.searchParams.set('survey-check', String(Date.now()));
        const response = await this.sourceWindow.fetch(url.toString(), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const catalog = catalogSchema.parse(
          await response.json(),
        ) as SurveyCatalog;
        const fingerprint = JSON.stringify(catalog);
        const changed = fingerprint !== this.catalogFingerprint;
        this.catalog = catalog;
        this.catalogFingerprint = fingerprint;
        return {
          source,
          revision: catalog.revision,
          changed,
          active: catalog.surveys.filter((survey) =>
            this.acceptsResponses(survey),
          ).length,
        };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        this.sourceWindow.clearTimeout(timeout);
      }
    }
    throw new Error(
      `暂时无法读取问卷清单。${errors.length ? `（${errors.join('；')}）` : ''}`,
    );
  }

  async list(options: { refresh?: boolean } = {}): Promise<SurveyListEntry[]> {
    let refreshError: unknown;
    if (options.refresh || !this.catalog) {
      try {
        await this.refreshCatalog();
      } catch (error) {
        refreshError = error;
      }
    }

    const records = await this.db.surveyResponses.toArray();
    if (!this.catalog && records.length === 0 && refreshError) {
      throw refreshError;
    }
    const recordsBySurvey = new Map(
      records.map((record) => [record.surveyId, record]),
    );
    const definitions = [...(this.catalog?.surveys ?? [])];
    const catalogIds = new Set(definitions.map((survey) => survey.id));
    for (const record of records) {
      if (!catalogIds.has(record.surveyId)) definitions.push(record.definition);
    }

    return definitions
      .map((definition) => ({
        definition,
        response: recordsBySurvey.get(definition.id),
        acceptingResponses: this.acceptsResponses(definition),
      }))
      .sort((left, right) => {
        const leftPending = left.acceptingResponses && !left.response;
        const rightPending = right.acceptingResponses && !right.response;
        if (leftPending !== rightPending) return leftPending ? -1 : 1;
        return right.definition.id.localeCompare(left.definition.id);
      });
  }

  async pending(): Promise<SurveyDefinition[]> {
    const entries = await this.list();
    return entries
      .filter((entry) => entry.acceptingResponses && !entry.response)
      .map((entry) => entry.definition);
  }

  async ignore(surveyId: string): Promise<SurveyResponseRecord> {
    const existing = await this.db.surveyResponses.get(responseId(surveyId));
    if (existing?.status === 'submitted') return existing;
    const definition = await this.definition(surveyId, existing?.definition);
    const now = Date.now();
    const record: SurveyResponseRecord = {
      id: responseId(surveyId),
      surveyId,
      surveyRevision: definition.revision,
      status: 'ignored',
      definition,
      answers: existing?.answers ?? {},
      discordId: existing?.discordId ?? '',
      ignoredAt: existing?.ignoredAt ?? now,
      updatedAt: now,
    };
    await this.db.surveyResponses.put(record);
    return record;
  }

  async submit(
    surveyId: string,
    draft: SurveySubmissionDraft,
  ): Promise<SurveyResponseRecord> {
    const existingTask = this.submissions.get(surveyId);
    if (existingTask) return existingTask;
    const task = this.performSubmission(surveyId, draft).finally(() =>
      this.submissions.delete(surveyId),
    );
    this.submissions.set(surveyId, task);
    return task;
  }

  private async performSubmission(
    surveyId: string,
    draft: SurveySubmissionDraft,
  ): Promise<SurveyResponseRecord> {
    const existing = await this.db.surveyResponses.get(responseId(surveyId));
    if (existing?.status === 'submitted') return existing;
    const definition = await this.definition(surveyId, existing?.definition);
    if (!this.acceptsResponses(definition)) {
      throw new Error('这份问卷已过期，无法继续提交。');
    }

    const validation = validateSurveySubmission(definition, draft);
    if (!validation.valid) throw new Error(validation.errors[0]);

    let tokenRecord = await this.db.surveyTokens.get(surveyId);
    if (!tokenRecord) {
      tokenRecord = {
        surveyId,
        token: this.sourceWindow.crypto.randomUUID(),
        createdAt: Date.now(),
      };
      await this.db.surveyTokens.add(tokenRecord);
    }

    const submissionId = this.sourceWindow.crypto.randomUUID();
    const payload: SurveySubmissionPayload = {
      id: submissionId,
      survey_id: definition.id,
      survey_revision: definition.revision,
      survey_kind: definition.kind,
      submission_token: tokenRecord.token,
      answers: validation.answers,
      discord_id: validation.discordId || null,
    };
    const response = await this.sourceWindow.fetch(SURVEY_RESPONSE_ENDPOINT, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await responseMessage(response));

    const now = Date.now();
    const record: SurveyResponseRecord = {
      id: responseId(surveyId),
      surveyId,
      surveyRevision: definition.revision,
      status: 'submitted',
      definition,
      answers: validation.answers,
      discordId: validation.discordId,
      submissionId,
      submittedAt: now,
      updatedAt: now,
    };
    await this.db.surveyResponses.put(record);
    return record;
  }

  private async definition(
    surveyId: string,
    fallback?: SurveyDefinition,
  ): Promise<SurveyDefinition> {
    if (!this.catalog) {
      try {
        await this.refreshCatalog();
      } catch {
        if (fallback) return fallback;
        throw new Error('暂时无法读取这份问卷。');
      }
    }
    const definition = this.catalog?.surveys.find(
      (survey) => survey.id === surveyId,
    );
    if (definition) return definition;
    if (fallback) return fallback;
    throw new Error('找不到这份问卷，可能已经被撤回。');
  }
}

function defaultCatalogSources(channel: 'alpha' | 'beta'): readonly string[] {
  if (channel === 'alpha') return ALPHA_CATALOG_SOURCES;
  return [
    new URL('../managed-content/surveys/alpha.json', import.meta.url).href,
  ];
}
