import { expect, it, vi } from 'vitest';
import { randomUuid } from '@/kernel/random-uuid';

it('HTTP 酒馆缺少 randomUUID 时仍用安全随机字节生成规范 UUID', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes; });
  expect(randomUuid({ getRandomValues } as unknown as Crypto)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(getRandomValues).toHaveBeenCalledOnce();
});
