import { describe, expect, it } from 'vitest';
import { canonicalWorldLocation } from '@/worldbook/location-state';

const school = {
  region: '圣德里安学院',
  place: '中央广场',
  location: '圣德里安学院 · 中央广场',
};

describe('统一世界地点状态', () => {
  it('只更新完整位置时也会同步推导大地区与地区内地点', () => {
    expect(
      canonicalWorldLocation(school, {
        location: '索拉维亚 · 圣心大教堂',
      }),
    ).toEqual({
      region: '索拉维亚',
      place: '圣心大教堂',
      location: '索拉维亚 · 圣心大教堂',
    });
  });

  it('大地区与地点冲突时以明确的大地区为准并清除错误地点', () => {
    expect(
      canonicalWorldLocation(school, {
        region: '索拉维亚',
        place: '学院宿舍',
        location: '学院宿舍',
      }),
    ).toEqual({
      region: '索拉维亚',
      place: '',
      location: '索拉维亚',
    });
  });

  it('统一索拉姆别名并始终由地区和地点生成展示位置', () => {
    expect(
      canonicalWorldLocation(school, {
        region: '索拉姆',
        place: '皇宫',
        location: '任意错误文本',
      }),
    ).toEqual({
      region: '索拉维亚',
      place: '皇宫',
      location: '索拉维亚 · 皇宫',
    });
  });
});
