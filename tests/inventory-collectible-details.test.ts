import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import CollectibleDetailsDialog from '@/modules/inventory/CollectibleDetailsDialog.vue';
import {
  collectibleDetailsFromRecord,
  collectibleDetailsFromRelic,
  type CollectibleDetails,
} from '@/modules/inventory/collectible-details';

let mountedApp: VueApp<Element> | undefined;

afterEach(() => {
  mountedApp?.unmount();
  mountedApp = undefined;
  document.body.replaceChildren();
});

function mountDialog(details: CollectibleDetails) {
  const host = document.createElement('div');
  document.body.append(host);
  mountedApp = createApp(CollectibleDetailsDialog, {
    details,
    teleportTarget: document.body,
  });
  mountedApp.mount(host);
}

describe('藏品详情', () => {
  it('普通藏品只生成并显示展示文本', async () => {
    const details = collectibleDetailsFromRelic(
      {
        id: 'profile:r_wolf_fang',
        profileId: 'profile',
        relicId: 'r_wolf_fang',
        carried: false,
        acquiredAt: 1,
        updatedAt: 1,
      },
      {
        name: '血狼犬齿',
        description: '攻击类卡牌伤害+2。',
        effect: { type: 'attack_bonus', value: 2 },
      },
    );

    expect(details).toEqual({
      id: 'profile:r_wolf_fang',
      kind: 'ordinary',
      name: '血狼犬齿',
      displayText: '攻击类卡牌伤害+2。',
    });

    mountDialog(details);
    await nextTick();
    expect(document.body.textContent).toContain('展示文本');
    expect(document.body.textContent).not.toContain('效果文本');
    expect(document.querySelector('[data-collectible-effect-text]')).toBeNull();
  });

  it('特殊藏品同时显示独立的展示文本和效果文本', async () => {
    const details = collectibleDetailsFromRecord(
      {
        id: 'profile:special_golden_shovel',
        profileId: 'profile',
        collectibleId: 'special_golden_shovel',
        name: '金铲子',
        summary: '如此美味的饭我还能再吃一碗',
        source: '特殊补丁',
        acquiredDate: '2026-09-02',
        updatedAt: 1,
      },
      {
        name: '金铲子',
        description: '不应覆盖补丁中保存的效果文本',
        effect: { type: 'special_golden_shovel', chance: 0.1 },
      },
    );

    expect(details.kind).toBe('special');
    expect(details.displayText).toBe('如此美味的饭我还能再吃一碗');
    expect(details.effectText).toContain('10%的基础概率');

    mountDialog(details);
    await nextTick();
    expect(
      document.querySelector('[data-collectible-display-text]')?.textContent,
    ).toBe('如此美味的饭我还能再吃一碗');
    expect(
      document.querySelector('[data-collectible-effect-text]')?.textContent,
    ).toContain('第10场必定触发');
  });

  it('任务纪念藏品按普通藏品处理，不显示不存在的效果文本', () => {
    const details = collectibleDetailsFromRecord({
      id: 'profile:quest:flora:lily',
      profileId: 'profile',
      collectibleId: 'quest:flora:lily',
      name: '盛放的百合',
      summary: '完成任务「芙萝拉如是说」的纪念品。',
      source: '任务：芙萝拉如是说',
      acquiredDate: '2026-09-02',
      updatedAt: 1,
    });

    expect(details).toEqual({
      id: 'profile:quest:flora:lily',
      kind: 'ordinary',
      name: '盛放的百合',
      displayText: '完成任务「芙萝拉如是说」的纪念品。',
    });
  });

});
