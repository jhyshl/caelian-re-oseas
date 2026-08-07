import { describe, expect, it } from 'vitest';
import {
  caelianWorldbookFamily,
  isCaelianCharacterName,
  isCaelianWorldbookName,
} from '@/content/character-identity';

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

  it.each([
    '孔雀开屏你说看不见',
    '孔雀开屏你说你看不见',
    '孔雀开屏你说你看不见alpha',
    '孔雀开屏你说你看不见 Beta',
  ])('接受官方通道世界书名“%s”', (name) => {
    expect(isCaelianWorldbookName(name)).toBe(true);
    expect(caelianWorldbookFamily(name)).toMatch(/^孔雀开屏/);
  });

  it('拒绝名称相似但不在白名单中的世界书', () => {
    expect(isCaelianWorldbookName('孔雀开屏你说你看不见测试版')).toBe(false);
    expect(isCaelianWorldbookName('玩家自己的世界书')).toBe(false);
  });
});
