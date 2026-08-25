import { z } from 'zod';
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

export type FeedbackReceiptStatus = 'open' | 'resolved' | 'rejected';
export type FeedbackReceiptDisplayStatus =
  | 'pending'
  | 'viewed'
  | 'resolved'
  | 'rejected';

export interface FeedbackReceipt {
  id: string;
  receiptToken: string;
  kind: FeedbackKind;
  title: string;
  status: FeedbackReceiptStatus;
  authorReply: string | null;
  createdAt: string;
  reviewedAt: string | null;
  resolvedAt: string | null;
  lastCheckedAt: string;
}

export interface SubmittedFeedback {
  id: string;
  receipt: FeedbackReceipt;
  receiptPersisted: boolean;
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
  submission_token: string;
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
const FEEDBACK_STATUS_ENDPOINT = `${SUPABASE_URL}/functions/v1/caelian-feedback-status`;

export const FEEDBACK_RECEIPTS_KEY = 'caelian_feedback_receipts_v1';

const receiptSchema = z.object({
  id: z.string().uuid(),
  receiptToken: z.string().uuid(),
  kind: z.enum(['bug', 'suggestion']),
  title: z.string().trim().min(1).max(120),
  status: z.enum(['open', 'resolved', 'rejected']),
  authorReply: z.string().max(1000).nullable(),
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  lastCheckedAt: z.string().datetime(),
});

const remoteTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const receiptStatusBaseSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['bug', 'suggestion']),
  title: z.string().trim().min(1).max(120),
  reviewed_at: remoteTimestampSchema.nullable(),
  resolved_at: remoteTimestampSchema.nullable(),
});

const receiptStatusSchema = z
  .union([
    receiptStatusBaseSchema.extend({
      status: z.enum(['open', 'resolved', 'rejected']),
      author_reply: z.string().max(1000).nullable(),
    }),
    receiptStatusBaseSchema.extend({
      admin_status: z.enum(['open', 'resolved', 'rejected']),
      admin_note: z.string().max(1000).nullable(),
    }),
  ])
  .transform((value) => ({
    ...value,
    status: 'status' in value ? value.status : value.admin_status,
    authorReply:
      'author_reply' in value ? value.author_reply : value.admin_note,
  }));

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

function createPayload(
  draft: FeedbackDraft,
  runtime: RuntimeInfo,
  sourceWindow: Window,
  id: string,
  receiptToken: string,
): FeedbackPayload {
  const bugOnly = (value: string): string | null =>
    draft.kind === 'bug' && trimmed(value) ? trimmed(value) : null;

  return {
    id,
    submission_token: receiptToken,
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

async function responseMessage(
  response: Response,
  action: '提交' | '查询' = '提交',
): Promise<string> {
  if (response.status === 429) {
    return `${action}过于频繁，请稍后再试。`;
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
  return `${action}失败（HTTP ${response.status}），请稍后再试。`;
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

  const id = sourceWindow.crypto.randomUUID();
  const receiptToken = sourceWindow.crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const payload = createPayload(
    draft,
    runtime,
    sourceWindow,
    id,
    receiptToken,
  );
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
  const receipt = receiptSchema.parse({
    id,
    receiptToken,
    kind: draft.kind,
    title: payload.title,
    status: 'open',
    authorReply: null,
    createdAt,
    reviewedAt: null,
    resolvedAt: null,
    lastCheckedAt: createdAt,
  });
  try {
    saveFeedbackReceipt(receipt, sourceWindow);
    return { id, receipt, receiptPersisted: true };
  } catch {
    // The server already accepted this feedback. Do not report the submission
    // as failed or encourage a duplicate merely because this terminal cannot
    // write to localStorage.
    return { id, receipt, receiptPersisted: false };
  }
}

export function readFeedbackReceipts(
  sourceWindow: Window,
): FeedbackReceipt[] {
  try {
    const values = JSON.parse(
      sourceWindow.localStorage.getItem(FEEDBACK_RECEIPTS_KEY) ?? '[]',
    ) as unknown;
    if (!Array.isArray(values)) return [];
    return values
      .flatMap((value) => {
        const parsed = receiptSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 500);
  } catch {
    return [];
  }
}

export function saveFeedbackReceipt(
  receipt: FeedbackReceipt,
  sourceWindow: Window,
): FeedbackReceipt {
  const normalized = receiptSchema.parse(receipt);
  const receipts = readFeedbackReceipts(sourceWindow).filter(
    (entry) => entry.id !== normalized.id,
  );
  sourceWindow.localStorage.setItem(
    FEEDBACK_RECEIPTS_KEY,
    JSON.stringify([normalized, ...receipts].slice(0, 500)),
  );
  return normalized;
}

export function feedbackReceiptDisplayStatus(
  receipt: FeedbackReceipt,
): FeedbackReceiptDisplayStatus {
  if (receipt.status === 'resolved') return 'resolved';
  if (receipt.status === 'rejected') return 'rejected';
  return receipt.reviewedAt ? 'viewed' : 'pending';
}

export async function refreshFeedbackReceipt(
  receipt: FeedbackReceipt,
  sourceWindow: Window,
): Promise<FeedbackReceipt> {
  const response = await sourceWindow.fetch(FEEDBACK_STATUS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Receipt ${receipt.receiptToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: receipt.id }),
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('这份反馈回执的查询凭证无效。');
    }
    if (response.status === 404) {
      throw new Error('服务器中没有找到这条反馈记录。');
    }
    throw new Error(await responseMessage(response, '查询'));
  }
  const envelope = (await response.json()) as { result?: unknown };
  const parsed = receiptStatusSchema.safeParse(envelope.result);
  if (!parsed.success) {
    throw new Error('服务器返回的反馈状态格式无法识别，请稍后重试。');
  }
  const current = parsed.data;
  if (current.id !== receipt.id || current.kind !== receipt.kind) {
    throw new Error('反馈回执与服务器记录不匹配。');
  }
  return saveFeedbackReceipt(
    {
      ...receipt,
      title: current.title,
      status: current.status,
      authorReply: current.authorReply,
      reviewedAt: current.reviewed_at,
      resolvedAt: current.resolved_at,
      lastCheckedAt: new Date().toISOString(),
    },
    sourceWindow,
  );
}
