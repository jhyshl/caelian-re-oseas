import { z } from 'zod';
import type { RuntimeInfo } from '@/domain/types';
import classSubclassesJson from '@/content/generated/professions/class-subclasses.json';
import { normalizeWorkshopPack } from '@/workshop';
import { normalizeWorkshopMechanism } from '@/workshop-mechanisms';

const SUPABASE_URL = 'https://tlsdyacdkbcjxbwvyeim.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_EIYn8wiMd0O4tJXQI5Ub4Q_066Uizi1';
const SQUARE_ENDPOINT = `${SUPABASE_URL}/rest/v1/caelian_card_square_entries`;
const RECEIPT_ENDPOINT = `${SUPABASE_URL}/functions/v1/caelian-card-square-status`;

export const CARD_SQUARE_FAVORITES_KEY = 'caelian_card_square_favorites_v1';
export const CARD_SQUARE_RECEIPTS_KEY = 'caelian_card_square_receipts_v1';
export const CARD_SQUARE_RECEIPT_FORMAT = 'caelian_card_square_receipt';
export const DECK_BUILD_FORMAT = 'caelian_deck_build';
export const CARD_SQUARE_TAGS = [
  '新手友好',
  '高难挑战',
  '爆发',
  '持续输出',
  '防御',
  '回复',
  '控制',
  '召唤',
  '资源管理',
  '抽牌',
  '弃牌',
  '状态流',
  '单体',
  '群攻',
  '低费循环',
  '机制向',
] as const;

export type CardSquareKind = 'deck_build' | 'custom_class' | 'mechanism';
export type CardSquareStatus =
  | 'published'
  | 'pending'
  | 'rejected'
  | 'unpublished';

export interface SquareDeckBuild {
  format: typeof DECK_BUILD_FORMAT;
  version: 1;
  name: string;
  professionId: string;
  professionName: string;
  mainClass: string;
  cardIds: string[];
  exportedAt: string;
}

export interface CardSquareEntry {
  id: string;
  kind: CardSquareKind;
  status: CardSquareStatus;
  title: string;
  authorName: string | null;
  summary: string;
  tags: string[];
  professionId: string;
  professionName: string;
  payload: unknown;
  appVersion: string;
  buildId: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface CardSquareSubmission {
  kind: CardSquareKind;
  title: string;
  anonymous: boolean;
  authorName: string;
  summary: string;
  tags: string[];
  payload: unknown;
}

export interface CardSquareEditableSubmission extends CardSquareSubmission {
  id: string;
}

export interface CardSquareSubmissionReceipt {
  id: string;
  receiptToken: string;
  title: string;
  kind: CardSquareKind;
  status: CardSquareStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  publishedAt: string | null;
  lastCheckedAt: string;
}

export interface CardSquareReceiptFile {
  format: typeof CARD_SQUARE_RECEIPT_FORMAT;
  version: 1;
  receipt: CardSquareSubmissionReceipt;
  exportedAt: string;
}

const OFFICIAL_SUBCLASS_IDS = new Set(
  Object.values(classSubclassesJson as Record<string, string[]>).flat(),
);
const identifier = z.string().min(1).max(100).regex(/^[\w.-]+$/);
const deckBuildSchema = z.object({
  format: z.literal(DECK_BUILD_FORMAT),
  version: z.literal(1),
  name: z.string().trim().min(2).max(50),
  professionId: identifier,
  professionName: z.string().trim().min(1).max(40),
  mainClass: identifier,
  cardIds: z.array(z.string().trim().min(1).max(160)).min(10).max(20),
  exportedAt: z.string().datetime(),
});

const responseRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['deck_build', 'custom_class', 'mechanism']),
  status: z.enum(['published', 'pending', 'rejected', 'unpublished']),
  title: z.string(),
  author_name: z.string().nullable(),
  summary: z.string(),
  tags: z.array(z.string()),
  profession_id: z.string(),
  profession_name: z.string(),
  payload: z.unknown(),
  app_version: z.string(),
  build_id: z.string(),
  created_at: z.string(),
  published_at: z.string().nullable(),
});

const receiptSchema = z.object({
  id: z.string().uuid(),
  receiptToken: z.string().uuid(),
  title: z.string().trim().min(2).max(50),
  kind: z.enum(['deck_build', 'custom_class', 'mechanism']),
  status: z.enum(['published', 'pending', 'rejected', 'unpublished']),
  reviewNote: z.string().max(1000).nullable(),
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  lastCheckedAt: z.string().datetime(),
});

const receiptStatusSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  kind: z.enum(['deck_build', 'custom_class', 'mechanism']),
  status: z.enum(['published', 'pending', 'rejected', 'unpublished']),
  review_note: z.string().nullable(),
  reviewed_at: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value).toISOString())
    .nullable(),
  published_at: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value).toISOString())
    .nullable(),
});

const editableSubmissionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['deck_build', 'custom_class', 'mechanism']),
  title: z.string().trim().min(2).max(50),
  author_name: z.string().trim().min(2).max(30).nullable(),
  summary: z.string().trim().min(4).max(240),
  tags: z.array(z.string()),
  payload: z.unknown(),
});

interface NormalizedSubmission {
  title: string;
  authorName: string;
  summary: string;
  tags: string[];
  payload: unknown;
  professionId: string;
  professionName: string;
}

function normalizedTags(tags: string[]): string[] {
  const allowed = new Set<string>(CARD_SQUARE_TAGS);
  const normalized = [
    ...new Set(
      tags
        .flatMap((tag) => tag.split(/[，,]/))
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  const invalid = normalized.filter((tag) => !allowed.has(tag));
  if (invalid.length) {
    throw new Error(`只能选择卡牌广场提供的固定标签：${invalid.join('、')}。`);
  }
  if (normalized.length > 8) throw new Error('每份作品最多选择 8 个标签。');
  return normalized;
}

function normalizeSubmissionDraft(
  draft: CardSquareSubmission,
): NormalizedSubmission {
  const title = draft.title.trim();
  const authorName = draft.authorName.trim();
  const summary = draft.summary.trim();
  if (title.length < 2 || title.length > 50) {
    throw new Error('作品名称需要填写 2–50 个字。');
  }
  if (!draft.anonymous && (authorName.length < 2 || authorName.length > 30)) {
    throw new Error('署名需要填写 2–30 个字，或选择匿名发布。');
  }
  if (summary.length < 4 || summary.length > 240) {
    throw new Error('作品简介需要填写 4–240 个字。');
  }

  let payload: unknown = draft.payload;
  let professionId: string;
  let professionName: string;
  if (draft.kind === 'deck_build') {
    const build = normalizeDeckBuild(payload);
    payload = build;
    professionId = build.professionId;
    professionName = build.professionName;
  } else if (draft.kind === 'custom_class') {
    const pack = normalizeWorkshopPack(payload);
    if (pack.classes.length !== 1) {
      throw new Error('每次只能提交一个自制职业。');
    }
    payload = pack;
    professionId = pack.classes[0]?.id ?? '';
    professionName = pack.classes[0]?.name ?? '';
  } else {
    const mechanism = normalizeWorkshopMechanism(payload);
    payload = mechanism;
    professionId = mechanism.id;
    professionName = mechanism.name;
  }

  return {
    title,
    authorName,
    summary,
    tags: normalizedTags(draft.tags),
    payload,
    professionId,
    professionName,
  };
}

export function normalizeDeckBuild(value: unknown): SquareDeckBuild {
  const build = deckBuildSchema.parse(value);
  if (!OFFICIAL_SUBCLASS_IDS.has(build.professionId)) {
    throw new Error('卡组构筑只能选择游戏内的官方职业。');
  }
  return build;
}

function normalizeEntry(row: unknown): CardSquareEntry {
  const parsed = responseRowSchema.parse(row);
  let payload: unknown = parsed.payload;
  if (parsed.kind === 'deck_build') payload = normalizeDeckBuild(payload);
  if (parsed.kind === 'custom_class') payload = normalizeWorkshopPack(payload);
  if (parsed.kind === 'mechanism') payload = normalizeWorkshopMechanism(payload);
  return {
    id: parsed.id,
    kind: parsed.kind,
    status: parsed.status,
    title: parsed.title,
    authorName: parsed.author_name,
    summary: parsed.summary,
    tags: parsed.tags,
    professionId: parsed.profession_id,
    professionName: parsed.profession_name,
    payload,
    appVersion: parsed.app_version,
    buildId: parsed.build_id,
    createdAt: parsed.created_at,
    publishedAt: parsed.published_at,
  };
}

async function responseMessage(response: Response): Promise<string> {
  if (response.status === 409) return '这份作品已经提交过了。';
  if (response.status === 413) return '作品文件过大，请精简后再提交。';
  if (response.status === 429) return '投稿过于频繁，请稍后再试。';
  if (response.status >= 500) return '卡牌广场暂时不可用，请稍后再试。';
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message;
    }
  } catch {
    // PostgREST may return an empty or non-JSON error response.
  }
  return `请求失败（HTTP ${response.status}）。`;
}

export async function listCardSquareEntries(
  sourceWindow: Window,
): Promise<CardSquareEntry[]> {
  const select = [
    'id',
    'kind',
    'status',
    'title',
    'author_name',
    'summary',
    'tags',
    'profession_id',
    'profession_name',
    'payload',
    'app_version',
    'build_id',
    'created_at',
    'published_at',
  ].join(',');
  const response = await sourceWindow.fetch(
    `${SQUARE_ENDPOINT}?select=${select}&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=200`,
    {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(await responseMessage(response));
  const rows = (await response.json()) as unknown[];
  return rows.flatMap((row) => {
    try {
      return [normalizeEntry(row)];
    } catch {
      return [];
    }
  });
}

export async function submitCardSquareEntry(
  draft: CardSquareSubmission,
  runtime: RuntimeInfo,
  sourceWindow: Window,
): Promise<CardSquareSubmissionReceipt> {
  const normalized = normalizeSubmissionDraft(draft);

  const status: CardSquareStatus =
    draft.kind === 'deck_build' ? 'published' : 'pending';
  const id = sourceWindow.crypto.randomUUID();
  const receiptToken = sourceWindow.crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const body = {
    id,
    submission_token: receiptToken,
    kind: draft.kind,
    status,
    title: normalized.title,
    author_name: draft.anonymous ? null : normalized.authorName,
    summary: normalized.summary,
    tags: normalized.tags,
    profession_id: normalized.professionId,
    profession_name: normalized.professionName,
    payload: normalized.payload,
    app_version: runtime.version,
    build_id: runtime.buildId,
    created_at: createdAt,
    published_at: status === 'published' ? createdAt : null,
  };
  if (JSON.stringify(body).length > 250_000) {
    throw new Error('作品文件超过 250 KB，无法上传。');
  }
  const response = await sourceWindow.fetch(SQUARE_ENDPOINT, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const receipt: CardSquareSubmissionReceipt = {
    id,
    receiptToken,
    title: normalized.title,
    kind: draft.kind,
    status,
    reviewNote: null,
    createdAt,
    reviewedAt: null,
    publishedAt: status === 'published' ? createdAt : null,
    lastCheckedAt: createdAt,
  };
  saveCardSquareReceipt(receipt, sourceWindow);
  return receipt;
}

export async function loadCardSquareSubmissionForEdit(
  receipt: CardSquareSubmissionReceipt,
  sourceWindow: Window,
): Promise<CardSquareEditableSubmission> {
  const response = await sourceWindow.fetch(RECEIPT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Receipt ${receipt.receiptToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'edit', id: receipt.id }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const envelope = (await response.json()) as { result?: unknown };
  const parsed = editableSubmissionSchema.safeParse(envelope.result);
  if (!parsed.success) {
    throw new Error('服务器返回的投稿内容格式无法识别，请稍后重试。');
  }
  const current = parsed.data;
  if (current.id !== receipt.id || current.kind !== receipt.kind) {
    throw new Error('投稿回执与服务器记录不匹配。');
  }
  let payload: unknown = current.payload;
  if (current.kind === 'deck_build') payload = normalizeDeckBuild(payload);
  if (current.kind === 'custom_class') payload = normalizeWorkshopPack(payload);
  if (current.kind === 'mechanism') {
    payload = normalizeWorkshopMechanism(payload);
  }
  return {
    id: current.id,
    kind: current.kind,
    title: current.title,
    anonymous: current.author_name === null,
    authorName: current.author_name ?? '',
    summary: current.summary,
    tags: normalizedTags(current.tags),
    payload,
  };
}

export async function updateCardSquareSubmission(
  receipt: CardSquareSubmissionReceipt,
  draft: CardSquareSubmission,
  runtime: RuntimeInfo,
  sourceWindow: Window,
): Promise<CardSquareSubmissionReceipt> {
  if (draft.kind !== receipt.kind) {
    throw new Error('修改投稿时不能更换投稿类型。');
  }
  const normalized = normalizeSubmissionDraft(draft);
  const body = {
    action: 'update',
    id: receipt.id,
    kind: draft.kind,
    title: normalized.title,
    author_name: draft.anonymous ? null : normalized.authorName,
    summary: normalized.summary,
    tags: normalized.tags,
    profession_id: normalized.professionId,
    profession_name: normalized.professionName,
    payload: normalized.payload,
    app_version: runtime.version,
    build_id: runtime.buildId,
  };
  if (JSON.stringify(body).length > 250_000) {
    throw new Error('作品文件超过 250 KB，无法上传。');
  }
  const response = await sourceWindow.fetch(RECEIPT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Receipt ${receipt.receiptToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const envelope = (await response.json()) as { result?: unknown };
  const parsed = receiptStatusSchema.safeParse(envelope.result);
  if (!parsed.success) {
    throw new Error('服务器返回的投稿状态格式无法识别，请稍后重试。');
  }
  const current = parsed.data;
  if (current.id !== receipt.id || current.kind !== receipt.kind) {
    throw new Error('投稿回执与服务器记录不匹配。');
  }
  return saveCardSquareReceipt(
    {
      ...receipt,
      title: current.title,
      status: current.status,
      reviewNote: current.review_note,
      reviewedAt: current.reviewed_at,
      publishedAt: current.published_at,
      lastCheckedAt: new Date().toISOString(),
    },
    sourceWindow,
  );
}

export function readCardSquareReceipts(
  sourceWindow: Window,
): CardSquareSubmissionReceipt[] {
  try {
    const values = JSON.parse(
      sourceWindow.localStorage.getItem(CARD_SQUARE_RECEIPTS_KEY) ?? '[]',
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

export function saveCardSquareReceipt(
  receipt: CardSquareSubmissionReceipt,
  sourceWindow: Window,
): CardSquareSubmissionReceipt {
  const normalized = receiptSchema.parse(receipt);
  const receipts = readCardSquareReceipts(sourceWindow).filter(
    (entry) => entry.id !== normalized.id,
  );
  sourceWindow.localStorage.setItem(
    CARD_SQUARE_RECEIPTS_KEY,
    JSON.stringify([normalized, ...receipts].slice(0, 500)),
  );
  return normalized;
}

export function exportCardSquareReceipt(
  receipt: CardSquareSubmissionReceipt,
): CardSquareReceiptFile {
  return {
    format: CARD_SQUARE_RECEIPT_FORMAT,
    version: 1,
    receipt: receiptSchema.parse(receipt),
    exportedAt: new Date().toISOString(),
  };
}

export function importCardSquareReceipt(
  value: unknown,
  sourceWindow: Window,
): CardSquareSubmissionReceipt {
  const source = value as Partial<CardSquareReceiptFile>;
  if (
    source?.format !== CARD_SQUARE_RECEIPT_FORMAT ||
    source.version !== 1
  ) {
    throw new Error('这不是有效的凯利安投稿回执。');
  }
  return saveCardSquareReceipt(receiptSchema.parse(source.receipt), sourceWindow);
}

export async function refreshCardSquareReceipt(
  receipt: CardSquareSubmissionReceipt,
  sourceWindow: Window,
): Promise<CardSquareSubmissionReceipt> {
  const response = await sourceWindow.fetch(RECEIPT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Receipt ${receipt.receiptToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: receipt.id }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const envelope = (await response.json()) as { result?: unknown };
  const parsed = receiptStatusSchema.safeParse(envelope.result);
  if (!parsed.success) {
    throw new Error('服务器返回的投稿状态格式无法识别，请稍后重试。');
  }
  const current = parsed.data;
  if (current.id !== receipt.id || current.kind !== receipt.kind) {
    throw new Error('投稿回执与服务器记录不匹配。');
  }
  return saveCardSquareReceipt(
    {
      ...receipt,
      title: current.title,
      status: current.status,
      reviewNote: current.review_note,
      reviewedAt: current.reviewed_at,
      publishedAt: current.published_at,
      lastCheckedAt: new Date().toISOString(),
    },
    sourceWindow,
  );
}

export function readCardSquareFavorites(): string[] {
  try {
    const values = JSON.parse(
      localStorage.getItem(CARD_SQUARE_FAVORITES_KEY) ?? '[]',
    ) as unknown;
    return Array.isArray(values)
      ? [...new Set(values.map(String))].slice(0, 500)
      : [];
  } catch {
    return [];
  }
}

export function toggleCardSquareFavorite(entryId: string): boolean {
  const favorites = new Set(readCardSquareFavorites());
  const nextState = !favorites.has(entryId);
  if (nextState) favorites.add(entryId);
  else favorites.delete(entryId);
  localStorage.setItem(
    CARD_SQUARE_FAVORITES_KEY,
    JSON.stringify([...favorites].slice(0, 500)),
  );
  return nextState;
}
