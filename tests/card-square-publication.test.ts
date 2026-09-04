import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  submitCardSquareEntry,
  updateCardSquareSubmission,
  type CardSquareSubmissionReceipt,
} from '@/card-square';
import type { RuntimeInfo } from '@/domain/types';

const runtime = {
  channel: 'alpha',
  version: '0.2.0-alpha.69',
  buildId: 'direct-publication-test',
  databaseName: 'direct-publication-test',
  databaseVersion: 1,
  status: 'ready',
  mvuAvailable: false,
} satisfies RuntimeInfo;

function classPack() {
  const cards = Array.from({ length: 8 }, (_, index) => ({
    id: `square_direct_card_${index}`,
    name: `广场直发卡牌${index + 1}`,
    type: 'attack',
    cost: 0,
    rarity: 'legendary',
    effects: [{ type: 'damage', value: 999, target: 'enemy' }],
  }));
  return {
    format: 'caelian_workshop_class_pack',
    version: 1,
    packName: '广场直发职业包',
    classes: [
      {
        id: 'custom_class_square_direct',
        main: 'freelance',
        name: '广场直发职业',
        talent: {
          name: '直发天赋',
          description: '测试',
          effects: [{ type: 'extra_draw', value: 9 }],
        },
        cards,
        cardPool: [...cards, ...cards].map((card) => card.id),
        starterDeck: Array.from(
          { length: 15 },
          (_, index) => cards[index % cards.length]!.id,
        ),
      },
    ],
  };
}

afterEach(() => {
  localStorage.clear();
});

describe('卡牌广场发布策略', () => {
  it('数据库策略与修改接口保持相同的直发规则', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'docs/caelian-card-square-schema.sql'),
      'utf8',
    );
    const edge = readFileSync(
      resolve(
        process.cwd(),
        'supabase/functions/caelian-card-square-status/index.ts',
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /kind = 'custom_class'[\s\S]*status = 'published'[\s\S]*published_at is not null/,
    );
    expect(edge).toContain("['deck_build', 'custom_class'].includes");
    expect(edge).toContain("status: publishesImmediately ? 'published' : 'pending'");
  });

  it('职业与构筑直接公开，机制继续进入审核队列', async () => {
    const originalFetch = window.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    window.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    try {
      const classReceipt = await submitCardSquareEntry(
        {
          kind: 'custom_class',
          title: '直发职业',
          anonymous: true,
          authorName: '',
          summary: '验证职业提交后直接公开。',
          tags: ['机制向'],
          payload: classPack(),
        },
        runtime,
        window,
      );
      const deckReceipt = await submitCardSquareEntry(
        {
          kind: 'deck_build',
          title: '直发构筑',
          anonymous: true,
          authorName: '',
          summary: '验证构筑提交后直接公开。',
          tags: ['新手友好'],
          payload: {
            format: 'caelian_deck_build',
            version: 1,
            name: '直发构筑',
            professionId: 'holy_knight',
            professionName: '圣骑士',
            mainClass: 'knight',
            cardIds: Array.from({ length: 10 }, (_, index) => `card_${index}`),
            exportedAt: '2026-09-04T00:00:00.000Z',
          },
        },
        runtime,
        window,
      );
      const mechanismReceipt = await submitCardSquareEntry(
        {
          kind: 'mechanism',
          title: '待审机制',
          anonymous: true,
          authorName: '',
          summary: '验证代码与底层机制仍进入审核。',
          tags: ['机制向'],
          payload: {
            format: 'caelian_workshop_mechanism',
            version: 1,
            id: 'author.pending-mechanism',
            name: '待审机制',
            resources: [],
            statuses: [],
            rules: [
              {
                id: 'author.pending-mechanism.log',
                trigger: 'battle_start',
                once: 'battle',
                actions: [{ type: 'log', message: '已加载' }],
              },
            ],
          },
        },
        runtime,
        window,
      );

      expect(classReceipt.status).toBe('published');
      expect(deckReceipt.status).toBe('published');
      expect(mechanismReceipt.status).toBe('pending');
      expect(bodies.map((body) => [body.kind, body.status])).toEqual([
        ['custom_class', 'published'],
        ['deck_build', 'published'],
        ['mechanism', 'pending'],
      ]);
      expect(bodies[0]?.published_at).toEqual(expect.any(String));
      expect(bodies[1]?.published_at).toEqual(expect.any(String));
      expect(bodies[2]?.published_at).toBeNull();
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('职业修改接受服务端立即公开的结果', async () => {
    const receipt: CardSquareSubmissionReceipt = {
      id: 'f32c292d-7bb3-4f87-9ad1-8db158258963',
      receiptToken: '7caf70a3-f220-4299-ae67-0507b8d6e176',
      title: '旧职业',
      kind: 'custom_class',
      status: 'rejected',
      reviewNote: '旧意见',
      createdAt: '2026-09-03T00:00:00.000Z',
      reviewedAt: '2026-09-03T01:00:00.000Z',
      publishedAt: null,
      lastCheckedAt: '2026-09-03T01:00:00.000Z',
    };
    const originalFetch = window.fetch;
    window.fetch = (async () =>
      new Response(
        JSON.stringify({
          result: {
            id: receipt.id,
            title: '新版职业',
            kind: 'custom_class',
            status: 'published',
            review_note: null,
            reviewed_at: null,
            published_at: '2026-09-04T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    try {
      const updated = await updateCardSquareSubmission(
        receipt,
        {
          kind: 'custom_class',
          title: '新版职业',
          anonymous: true,
          authorName: '',
          summary: '保存修改后立即更新公开内容。',
          tags: ['机制向'],
          payload: classPack(),
        },
        runtime,
        window,
      );
      expect(updated).toMatchObject({
        status: 'published',
        reviewNote: null,
        reviewedAt: null,
        publishedAt: '2026-09-04T00:00:00.000Z',
      });
    } finally {
      window.fetch = originalFetch;
    }
  });
});
