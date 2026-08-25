import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  feedbackReceiptDisplayStatus,
  readFeedbackReceipts,
  refreshFeedbackReceipt,
  saveFeedbackReceipt,
  submitFeedback,
  validateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackReceipt,
} from '@/feedback/feedback-service';
import type { RuntimeInfo } from '@/domain/types';

const validBug: FeedbackDraft = {
  kind: 'bug',
  title: '背包装备数量没有减少',
  details: '在背包详情中装备任意武器时，问题会稳定出现。',
  reproductionSteps: '1. 打开背包\n2. 选择武器\n3. 点击装备',
  expectedResult: '背包数量减少一件。',
  actualResult: '背包数量保持不变。',
  contact: '',
};

const runtime: RuntimeInfo = {
  channel: 'alpha',
  version: '0.2.0-alpha.3',
  buildId: 'test-build',
  databaseName: 'test',
  databaseVersion: 1,
  status: 'ready',
  mvuAvailable: false,
};

beforeEach(() => {
  localStorage.clear();
});

describe('feedback validation', () => {
  it('requires reproducible details for bug reports', () => {
    const result = validateFeedbackDraft({
      ...validBug,
      reproductionSteps: '',
      actualResult: '',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('复现步骤至少需要 10 个字。');
    expect(result.errors).toContain('实际结果至少需要 4 个字。');
  });

  it('does not require bug-only fields for suggestions', () => {
    const result = validateFeedbackDraft({
      kind: 'suggestion',
      title: '地图增加资源标记',
      details: '希望地图可以标记已经采集过的资源点，方便规划路线。',
      reproductionSteps: '',
      expectedResult: '减少重复寻找资源的时间。',
      actualResult: '',
      contact: '',
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe('feedback submission', () => {
  it('sends a minimal insert and keeps a private receipt on this terminal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 201,
      }),
    );
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('d506df3a-2837-4c69-a13e-720f43890864')
      .mockReturnValueOnce('8f97d253-4cc0-4e95-998c-6e2fa8562a5a');
    const sourceWindow = {
      fetch: fetchMock,
      crypto: { randomUUID },
      localStorage,
      navigator: {
        language: 'zh-CN',
        userAgent: 'test-agent',
      },
      innerWidth: 390,
      innerHeight: 720,
      Intl,
    } as unknown as Window;

    await expect(
      submitFeedback(validBug, runtime, sourceWindow),
    ).resolves.toMatchObject({
      id: 'd506df3a-2837-4c69-a13e-720f43890864',
      receiptPersisted: true,
      receipt: {
        id: 'd506df3a-2837-4c69-a13e-720f43890864',
        receiptToken: '8f97d253-4cc0-4e95-998c-6e2fa8562a5a',
        kind: 'bug',
        title: validBug.title,
        status: 'open',
        reviewedAt: null,
        resolvedAt: null,
      },
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        apikey: expect.stringMatching(/^sb_publishable_/),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
    });
    expect(payload).toMatchObject({
      id: 'd506df3a-2837-4c69-a13e-720f43890864',
      submission_token: '8f97d253-4cc0-4e95-998c-6e2fa8562a5a',
      kind: 'bug',
      app_version: runtime.version,
      build_id: runtime.buildId,
    });
    expect(payload).not.toHaveProperty('profileId');
    expect(payload).not.toHaveProperty('chat');
    expect(payload).not.toHaveProperty('save');
    expect(readFeedbackReceipts(sourceWindow)).toHaveLength(1);
  });

  it('does not misreport an accepted submission when local receipt storage fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 201 }),
    );
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('d506df3a-2837-4c69-a13e-720f43890864')
      .mockReturnValueOnce('8f97d253-4cc0-4e95-998c-6e2fa8562a5a');
    const blockedStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Storage is unavailable', 'QuotaExceededError');
      },
    } as unknown as Storage;
    const sourceWindow = {
      fetch: fetchMock,
      crypto: { randomUUID },
      localStorage: blockedStorage,
      navigator: {
        language: 'zh-CN',
        userAgent: 'test-agent',
      },
      innerWidth: 390,
      innerHeight: 720,
    } as unknown as Window;

    await expect(
      submitFeedback(validBug, runtime, sourceWindow),
    ).resolves.toMatchObject({
      id: 'd506df3a-2837-4c69-a13e-720f43890864',
      receiptPersisted: false,
      receipt: {
        receiptToken: '8f97d253-4cc0-4e95-998c-6e2fa8562a5a',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('feedback receipts', () => {
  const receipt: FeedbackReceipt = {
    id: 'd506df3a-2837-4c69-a13e-720f43890864',
    receiptToken: '8f97d253-4cc0-4e95-998c-6e2fa8562a5a',
    kind: 'bug',
    title: validBug.title,
    status: 'open',
    authorReply: null,
    createdAt: '2026-08-25T00:00:00.000Z',
    reviewedAt: null,
    resolvedAt: null,
    lastCheckedAt: '2026-08-25T00:00:00.000Z',
  };

  it('keeps receipts locally and derives the three player-facing states', () => {
    saveFeedbackReceipt(receipt, window);
    expect(readFeedbackReceipts(window)).toEqual([receipt]);
    expect(feedbackReceiptDisplayStatus(receipt)).toBe('pending');
    expect(
      feedbackReceiptDisplayStatus({
        ...receipt,
        reviewedAt: '2026-08-25T01:00:00.000Z',
      }),
    ).toBe('viewed');
    expect(
      feedbackReceiptDisplayStatus({
        ...receipt,
        status: 'resolved',
        resolvedAt: '2026-08-25T02:00:00.000Z',
      }),
    ).toBe('resolved');
  });

  it('keeps author replies within the database limit', () => {
    expect(() =>
      saveFeedbackReceipt(
        { ...receipt, authorReply: '回'.repeat(1001) },
        window,
      ),
    ).toThrow();
  });

  it('queries only with the private token and saves author replies', async () => {
    saveFeedbackReceipt(receipt, window);
    const originalFetch = window.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            id: receipt.id,
            kind: receipt.kind,
            title: receipt.title,
            admin_status: 'open',
            admin_note: '已定位到装备属性缓存问题，会随下个版本修复。',
            reviewed_at: '2026-08-25T09:30:00+08:00',
            resolved_at: null,
            updated_at: '2026-08-25T09:30:00+08:00',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    window.fetch = fetchMock as typeof fetch;

    try {
      const updated = await refreshFeedbackReceipt(receipt, window);
      expect(updated).toMatchObject({
        status: 'open',
        authorReply: '已定位到装备属性缓存问题，会随下个版本修复。',
        reviewedAt: '2026-08-25T01:30:00.000Z',
      });
      expect(feedbackReceiptDisplayStatus(updated)).toBe('viewed');
      expect(readFeedbackReceipts(window)[0]).toEqual(updated);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/caelian-feedback-status'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: `Receipt ${receipt.receiptToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: receipt.id }),
          cache: 'no-store',
        }),
      );
    } finally {
      window.fetch = originalFetch;
    }
  });
});
