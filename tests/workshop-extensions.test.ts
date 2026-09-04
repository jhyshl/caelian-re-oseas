import { afterEach, describe, expect, it } from 'vitest';
import {
  exportCardSquareReceipt,
  importCardSquareReceipt,
  loadCardSquareSubmissionForEdit,
  readCardSquareReceipts,
  refreshCardSquareReceipt,
  saveCardSquareReceipt,
  submitCardSquareEntry,
  updateCardSquareSubmission,
  type CardSquareSubmissionReceipt,
} from '@/card-square';
import type { RuntimeInfo } from '@/domain/types';
import {
  evaluateWorkshopFormula,
  normalizeWorkshopMechanism,
  type WorkshopMechanismRuntimeContext,
} from '@/workshop-mechanisms';

afterEach(() => localStorage.clear());

describe('创意工坊声明式扩展', () => {
  it('规范化底层机制并只允许白名单状态公式', () => {
    const mechanism = normalizeWorkshopMechanism({
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: 'author.starlight',
      name: '星辉',
      resources: [
        {
          id: 'starlight',
          label: '星辉',
          min: 0,
          max: 5,
          initial: 1,
          visible: true,
        },
      ],
      rules: [
        {
          id: 'gain',
          trigger: 'after_card',
          once: 'never',
          actions: [
            { type: 'resource_add', resource: 'starlight', value: 1 },
          ],
        },
      ],
    });
    expect(mechanism.resources[0]?.max).toBe(5);
    expect(mechanism.rules[0]?.trigger).toBe('after_card');
    expect(
      evaluateWorkshopFormula(
        {
          op: 'mul',
          args: [{ op: 'resource', id: 'starlight' }, 3],
        },
        {
          resources: { starlight: 2 },
          event: {},
        } as unknown as WorkshopMechanismRuntimeContext,
      ),
    ).toBe(6);
    expect(() =>
      normalizeWorkshopMechanism({
        ...mechanism,
        rules: [
          {
            id: 'unsafe',
            trigger: 'turn_start',
            actions: [
              {
                type: 'damage',
                value: { op: 'stat', path: 'document.cookie' },
              },
            ],
          },
        ],
      }),
    ).toThrow('公式不能读取状态');
  });

  it('投稿回执只保存在当前终端并可导出后重新导入', () => {
    const receipt: CardSquareSubmissionReceipt = {
      id: '5f9df001-1b92-4c34-8a57-36cd61a7fbc1',
      receiptToken: '8f97d253-4cc0-4e95-998c-6e2fa8562a5a',
      title: '星辉守望者',
      kind: 'custom_class',
      status: 'pending',
      reviewNote: null,
      createdAt: '2026-08-07T00:00:00.000Z',
      reviewedAt: null,
      publishedAt: null,
      lastCheckedAt: '2026-08-07T00:00:00.000Z',
    };
    saveCardSquareReceipt(receipt, window);
    const file = exportCardSquareReceipt(receipt);
    expect(readCardSquareReceipts(window)).toEqual([receipt]);

    localStorage.clear();
    importCardSquareReceipt(file, window);
    expect(readCardSquareReceipts(window)[0]?.receiptToken).toBe(
      receipt.receiptToken,
    );
  });

  it('查询投稿时兼容 Supabase 带时区偏移的审核时间', async () => {
    const receipt: CardSquareSubmissionReceipt = {
      id: '5f9df001-1b92-4c34-8a57-36cd61a7fbc1',
      receiptToken: '8f97d253-4cc0-4e95-998c-6e2fa8562a5a',
      title: '星辉守望者',
      kind: 'custom_class',
      status: 'pending',
      reviewNote: null,
      createdAt: '2026-08-07T00:00:00.000Z',
      reviewedAt: null,
      publishedAt: null,
      lastCheckedAt: '2026-08-07T00:00:00.000Z',
    };
    const originalFetch = window.fetch;
    window.fetch = (async () =>
      new Response(
        JSON.stringify({
          result: {
            id: receipt.id,
            title: receipt.title,
            kind: receipt.kind,
            status: 'rejected',
            review_note: '脚本说明需要补充。',
            reviewed_at: '2026-08-07T06:48:56.653+00:00',
            published_at: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    try {
      const updated = await refreshCardSquareReceipt(receipt, window);
      expect(updated.status).toBe('rejected');
      expect(updated.reviewNote).toBe('脚本说明需要补充。');
      expect(updated.reviewedAt).toBe('2026-08-07T06:48:56.653Z');
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('持有投稿回执的玩家可以载入作品并在修改后重新进入审核', async () => {
    const receipt: CardSquareSubmissionReceipt = {
      id: '5f9df001-1b92-4c34-8a57-36cd61a7fbc1',
      receiptToken: '8f97d253-4cc0-4e95-998c-6e2fa8562a5a',
      title: '星辉机制',
      kind: 'mechanism',
      status: 'published',
      reviewNote: '原审核已通过。',
      createdAt: '2026-08-07T00:00:00.000Z',
      reviewedAt: '2026-08-07T01:00:00.000Z',
      publishedAt: '2026-08-07T01:00:00.000Z',
      lastCheckedAt: '2026-08-07T01:00:00.000Z',
    };
    const payload = {
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: 'author.starlight-edit',
      name: '星辉机制',
      resources: [],
      rules: [
        {
          id: 'author.starlight-edit.log',
          trigger: 'battle_start',
          once: 'battle',
          actions: [{ type: 'log', message: '星辉机制已启用' }],
        },
      ],
    };
    const requests: Record<string, unknown>[] = [];
    const originalFetch = window.fetch;
    window.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.action === 'edit') {
        return new Response(
          JSON.stringify({
            result: {
              id: receipt.id,
              kind: receipt.kind,
              title: receipt.title,
              author_name: null,
              summary: '原始作品简介。',
              tags: ['机制向'],
              payload,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          result: {
            id: receipt.id,
            title: '星辉机制·改',
            kind: receipt.kind,
            status: 'pending',
            review_note: null,
            reviewed_at: null,
            published_at: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const editable = await loadCardSquareSubmissionForEdit(receipt, window);
      expect(editable.anonymous).toBe(true);
      expect(editable.tags).toEqual(['机制向']);
      const updated = await updateCardSquareSubmission(
        receipt,
        {
          ...editable,
          title: '星辉机制·改',
          summary: '修改后的作品简介。',
        },
        {
          channel: 'alpha',
          version: '0.2.0-alpha.29',
          buildId: 'test-build',
          databaseName: 'test-db',
          databaseVersion: 1,
          status: 'ready',
          mvuAvailable: false,
        } satisfies RuntimeInfo,
        window,
      );
      expect(requests.map((request) => request.action)).toEqual([
        'edit',
        'update',
      ]);
      expect(requests[1]).toMatchObject({
        kind: 'mechanism',
        title: '星辉机制·改',
      });
      expect(requests[1]).not.toHaveProperty('status');
      expect(updated).toMatchObject({
        title: '星辉机制·改',
        status: 'pending',
        reviewNote: null,
        reviewedAt: null,
        publishedAt: null,
      });
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('只接受卡牌广场预置的固定标签', async () => {
    await expect(
      submitCardSquareEntry(
        {
          kind: 'mechanism',
          title: '标签测试机制',
          anonymous: true,
          authorName: '',
          summary: '用于验证固定标签白名单。',
          tags: ['玩家随意填写的标签'],
          payload: {
            format: 'caelian_workshop_mechanism',
            version: 1,
            id: 'author.tag-test',
            name: '标签测试',
            resources: [],
            rules: [
              {
                id: 'author.tag-test.log',
                trigger: 'battle_start',
                once: 'battle',
                actions: [{ type: 'log', message: '标签测试' }],
              },
            ],
          },
        },
        {
          channel: 'alpha',
          version: '0.2.0-alpha.28',
          buildId: 'test-build',
          databaseName: 'test-db',
          databaseVersion: 1,
          status: 'ready',
          mvuAvailable: false,
        } satisfies RuntimeInfo,
        window,
      ),
    ).rejects.toThrow('固定标签');
  });
});
