import { describe, expect, it } from 'vitest';
import { isCaelianCharacterName } from '@/content/character-identity';

describe('凯利安角色名识别', () => {
  it.each([
    '凯利安',
    '凯利安alpha',
    '凯利安Alpha',
    '凯利安 alpha',
    '凯利安（beta）',
  ])('接受官方通道角色名“%s”', (name) => {
    expect(isCaelianCharacterName(name)).toBe(true);
  });

  it.each(['其他角色', '凯利安测试版', '凯利安gamma', ''])(
    '拒绝非白名单角色名“%s”',
    (name) => {
      expect(isCaelianCharacterName(name)).toBe(false);
    },
  );
});
