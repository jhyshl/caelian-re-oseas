import type { RuntimeInfo } from '@/domain/types';

export type FeedbackKind = 'bug' | 'suggestion';

export interface FeedbackDraft {
  kind: FeedbackKind;
  title: string;
  details: string;
  reproductionSteps: string;
  expectedResult: string;
  actualResult: string;
  contact: string;
}

export interface FeedbackValidation {
  valid: boolean;
  errors: string[];
}

export interface SubmittedFeedback {
  id: string;
}

interface FeedbackClientContext {
  channel: RuntimeInfo['channel'];
  locale: string;
  timeZone: string;
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
}

interface FeedbackPayload {
  id: string;
  kind: FeedbackKind;
  title: string;
  details: string;
  reproduction_steps: string | null;
  expected_result: string | null;
  actual_result: string | null;
  contact: string | null;
  app_version: string;
  build_id: string;
  client_context: FeedbackClientContext;
}

const SUPABASE_URL = 'https://tlsdyacdkbcjxbwvyeim.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_EIYn8wiMd0O4tJXQI5Ub4Q_066Uizi1';
const FEEDBACK_ENDPOINT = `${SUPABASE_URL}/rest/v1/caelian_feedback`;

export const FEEDBACK_LIMITS = {
  title: 120,
  details: 4000,
  reproductionSteps: 4000,
  expectedResult: 2000,
  actualResult: 2000,
  contact: 160,
} as const;

function trimmed(value: string): string {
  return value.trim();
}

function requiredLengthError(
  value: string,
  label: string,
  minimum: number,
): string | undefined {
  if (trimmed(value).length >= minimum) return undefined;
  return `${label}至少需要 ${minimum} 个字。`;
}

export function validateFeedbackDraft(
  draft: FeedbackDraft,
): FeedbackValidation {
  const errors = [
    requiredLengthError(draft.title, '标题', 4),
    requiredLengthError(
      draft.details,
      draft.kind === 'bug' ? '问题说明' : '建议内容',
      10,
    ),
  ];

  if (draft.kind === 'bug') {
    errors.push(
      requiredLengthError(draft.reproductionSteps, '复现步骤', 10),
      requiredLengthError(draft.expectedResult, '期望结果', 4),
      requiredLengthError(draft.actualResult, '实际结果', 4),
    );
  } else {
    errors.push(
      requiredLengthError(draft.expectedResult, '希望达到的效果', 4),
    );
  }

  const fieldLengths: Array<[string, string, number]> = [
    [draft.title, '标题', FEEDBACK_LIMITS.title],
    [draft.details, '详细内容', FEEDBACK_LIMITS.details],
    [
      draft.reproductionSteps,
      '复现步骤',
      FEEDBACK_LIMITS.reproductionSteps,
    ],
    [draft.expectedResult, '期望结果', FEEDBACK_LIMITS.expectedResult],
    [draft.actualResult, '实际结果', FEEDBACK_LIMITS.actualResult],
    [draft.contact, '联系方式', FEEDBACK_LIMITS.contact],
  ];
  for (const [value, label, maximum] of fieldLengths) {
    if (value.length > maximum) {
      errors.push(`${label}不能超过 ${maximum} 个字。`);
    }
  }

  const filtered = errors.filter(
    (error): error is string => error !== undefined,
  );
  return { valid: filtered.length === 0, errors: filtered };
}

function collectClientContext(
  runtime: RuntimeInfo,
  sourceWindow: Window,
): FeedbackClientContext {
  const navigator = sourceWindow.navigator;
  return {
    channel: runtime.channel,
    locale: navigator.language || 'unknown',
    timeZone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    userAgent: navigator.userAgent.slice(0, 512),
    viewport: {
      width: Math.max(0, Math.round(sourceWindow.innerWidth)),
      height: Math.max(0, Math.round(sourceWindow.innerHeight)),
    },
  };
}

function createSubmissionId(sourceWindow: Window): string {
  return sourceWindow.crypto.randomUUID();
}

function createPayload(
  draft: FeedbackDraft,
  runtime: RuntimeInfo,
  sourceWindow: Window,
): FeedbackPayload {
  const bugOnly = (value: string): string | null =>
    draft.kind === 'bug' && trimmed(value) ? trimmed(value) : null;

  return {
    id: createSubmissionId(sourceWindow),
    kind: draft.kind,
    title: trimmed(draft.title),
    details: trimmed(draft.details),
    reproduction_steps: bugOnly(draft.reproductionSteps),
    expected_result: trimmed(draft.expectedResult) || null,
    actual_result: bugOnly(draft.actualResult),
    contact: trimmed(draft.contact) || null,
    app_version: runtime.version,
    build_id: runtime.buildId,
    client_context: collectClientContext(runtime, sourceWindow),
  };
}

async function responseMessage(response: Response): Promise<string> {
  if (response.status === 429) {
    return '提交过于频繁，请稍后再试。';
  }
  if (response.status >= 500) {
    return '反馈服务暂时不可用，请稍后再试。';
  }
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Supabase may return an empty body or a non-JSON proxy error.
  }
  return `提交失败（HTTP ${response.status}），请稍后再试。`;
}

export async function submitFeedback(
  draft: FeedbackDraft,
  runtime: RuntimeInfo,
  sourceWindow: Window,
): Promise<SubmittedFeedback> {
  const validation = validateFeedbackDraft(draft);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  const payload = createPayload(draft, runtime, sourceWindow);
  const response = await sourceWindow.fetch(FEEDBACK_ENDPOINT, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }
  return { id: payload.id };
}
