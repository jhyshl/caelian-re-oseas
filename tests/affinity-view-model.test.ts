import { describe, expect, it } from 'vitest';
import type { SocialProgressRecord } from '@/domain/types';
import {
  AFFINITY_MAX,
  createAffinityViewModel,
} from '@/modules/affinity/view-model';

function social(
  patch: Partial<SocialProgressRecord> = {},
): SocialProgressRecord {
  return {
    id: 'profile:test:caelian',
    profileId: 'profile:test',
    characterId: 'caelian',
    affinity: 0,
    mood: '平静',
    location: '圣德里安学院',
    clothing: '学院制服',
    innerThought: '',
    relationshipStage: '陌生人',
    updatedAt: 1,
    ...patch,
  };
}

describe('凯利安好感度面板视图模型', () => {
  it('按 MVU v3 的 0–100 契约显示数值和下一关系阶段', () => {
    const view = createAffinityViewModel(
      social({
        affinity: 52,
        relationshipStage: '暧昧对象',
        innerThought: '也许可以再相信他一点。',
      }),
    );

    expect(AFFINITY_MAX).toBe(100);
    expect(view).toMatchObject({
      affinity: 52,
      percent: 52,
      relationshipStage: '暧昧对象',
      nextStageLabel: '恋人',
      nextStageRemaining: 29,
      isMaximum: false,
      innerThought: '也许可以再相信他一点。',
    });
  });

  it('为旧版状态栏字段提供安全回退，并约束异常好感度', () => {
    const view = createAffinityViewModel(
      social({
        affinity: 999,
        mood: ' ',
        location: '',
        clothing: '',
        innerThought: '',
        relationshipStage: '',
      }),
    );

    expect(view).toMatchObject({
      affinity: 100,
      percent: 100,
      relationshipStage: '伴侣',
      mood: '平静',
      location: '圣德里安学院',
      clothing: '白色暗纹衬衫搭配红金色马甲',
      innerThought: '暂无记录',
      isMaximum: true,
      nextStageRemaining: 0,
    });
  });
});
