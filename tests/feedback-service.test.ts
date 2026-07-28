import { describe, expect, it, vi } from 'vitest';
import {
  submitFeedback,
  validateFeedbackDraft,
  type FeedbackDraft,
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
  it('sends a minimal insert without chat or save data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 201,
      }),
    );
    const sourceWindow = {
      fetch: fetchMock,
      crypto: { randomUUID: () => 'd506df3a-2837-4c69-a13e-720f43890864' },
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
    ).resolves.toEqual({
      id: 'd506df3a-2837-4c69-a13e-720f43890864',
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
      kind: 'bug',
      app_version: runtime.version,
      build_id: runtime.buildId,
    });
    expect(payload).not.toHaveProperty('profileId');
    expect(payload).not.toHaveProperty('chat');
    expect(payload).not.toHaveProperty('save');
  });
});
