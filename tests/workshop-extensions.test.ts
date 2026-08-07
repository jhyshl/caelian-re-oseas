import { afterEach, describe, expect, it } from 'vitest';
import {
  exportCardSquareReceipt,
  importCardSquareReceipt,
  readCardSquareReceipts,
  saveCardSquareReceipt,
  type CardSquareSubmissionReceipt,
} from '@/card-square';
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
});
