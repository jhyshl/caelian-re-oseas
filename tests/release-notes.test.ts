import { describe, expect, it } from 'vitest';
import {
  ALPHA_RELEASE_NOTES,
  BETA_RELEASE_NOTES,
  releaseAnnouncementId,
  releaseHistoryFor,
  releaseNotesFor,
} from '@/content/release-notes';

describe('release notes', () => {
  it('从当前版本开始按新到旧返回全部历史版本', () => {
    const releases = releaseNotesFor('alpha', '0.2.0-alpha.62');

    expect(releases[0]?.version).toBe('0.2.0-alpha.62');
    expect(releases).toEqual(ALPHA_RELEASE_NOTES);
    expect(releases.length).toBeGreaterThan(5);
    const latestText = releases[0]?.changes.join('\n') ?? '';
    expect(latestText).toContain('心动主题');
    expect(latestText).toContain('好感度达到 250');
    expect(latestText).toContain('实时显示凯利安好感度');
    expect(latestText).toContain('九宫格切片');
    const alpha61Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.61')
        ?.changes.join('\n') ?? '';
    expect(alpha61Text).toContain('感谢有你');
    expect(alpha61Text).toContain('打猎分页');
    expect(alpha61Text).toContain('护盾×80%');
    expect(alpha61Text).toContain('自定义状态与自定义资源');
    const alpha60Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.60')
        ?.changes.join('\n') ?? '';
    expect(alpha60Text).toContain('变量结构 v2.10');
    expect(alpha60Text).toContain('0～500');
    const alpha59Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.59')
        ?.changes.join('\n') ?? '';
    expect(alpha59Text).toContain('好感度上限从 100 提升到 500');
    expect(alpha59Text).toContain('赠礼与邀约');
    const alpha58Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.58')
        ?.changes.join('\n') ?? '';
    expect(alpha58Text).toContain('只剩标题和按钮');
    expect(alpha58Text).toContain('集市商品卡');
    const alpha57Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.57')
        ?.changes.join('\n') ?? '';
    expect(alpha57Text).toContain('边框拖拽缩放');
    expect(alpha57Text).toContain('地区世界书快捷条目');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.56')
        ?.changes.join('\n'),
    ).toContain('不可装备的特殊藏品');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.55')
        ?.changes.join('\n'),
    ).toContain('保留最后 1 点生命');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.54')
        ?.changes.join('\n'),
    ).toContain('第 10 场必定触发');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.53')
        ?.changes.join('\n'),
    ).toContain('浏览器本地懒加载');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.52')
        ?.changes.join('\n'),
    ).toContain('九宫格切片');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.51')
        ?.changes.join('\n'),
    ).toContain('冒险者邮箱');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.50')
        ?.changes.join('\n'),
    ).toContain('小狗主题');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.49')
        ?.changes.join('\n'),
    ).toContain('同名限时召唤物');
    expect(
      releases.find((release) => release.version === '0.2.0-alpha.48')
        ?.changes.join('\n'),
    ).toContain('持久回执');
  });

  it('Beta 只显示自己的版本公告，不混入 Alpha 历史', () => {
    const releases = releaseNotesFor('beta', '1.11.0-beta.1');

    expect(releases).toEqual(BETA_RELEASE_NOTES);
    expect(releases.map((release) => release.label)).toEqual([
      'Beta 1.11',
      'Beta 1.10',
      'Beta 1.9',
      'Beta 1.8',
      'Beta 1.7',
      'Beta 1.6',
      'Beta 1.5',
      'Beta 1.4',
      'Beta 1.3',
      'Beta 1.2',
      'Beta 1.1',
      'Beta 1.0',
    ]);
    const latestText = releases[0]?.changes.join('\n') ?? '';
    expect(latestText).toContain('感谢有你');
    expect(latestText).toContain('打猎分页');
    expect(latestText).toContain('护盾×80%');
    expect(latestText).toContain('自定义状态与自定义资源');
    const beta110Text = releases
      .find((release) => release.version === '1.10.0-beta.1')
      ?.changes.join('\n');
    expect(beta110Text).toContain('好感度上限从 100 提升到 500');
    expect(beta110Text).toContain('赠礼与邀约');
    expect(beta110Text).toContain('回填变量管理器');
    expect(beta110Text).toContain('特莱奥抚摸与投喂');
    expect(beta110Text).toContain('旧版互动成就');
    expect(beta110Text).toContain('变量结构 v2.10');
    expect(beta110Text).toContain('0～500');
    const beta19Text = releases
      .find((release) => release.version === '1.9.0-beta.1')
      ?.changes.join('\n');
    expect(beta19Text).toContain('快捷菜单新增“采集”');
    expect(beta19Text).toContain('无追踪任务的日常对话不会额外调用副 API');
    expect(beta19Text).toContain('边框拖拽缩放');
    expect(beta19Text).toContain('地区世界书快捷条目');
    const beta18Text = releases
      .find((release) => release.version === '1.8.0-beta.1')
      ?.changes.join('\n');
    expect(beta18Text).toContain('学院主线最终魔像战');
    expect(beta18Text).toContain('上一张使用的是同名卡牌');
    expect(beta18Text).toContain('首领战不会消耗保底进度');
    expect(beta18Text).toContain('悬浮入口消失');
    expect(beta18Text).toContain('治疗牌会先完成治疗');
    expect(beta18Text).toContain('特殊成就：抓虫中');
    expect(beta18Text).toContain('不会重复增加金币');
    const beta17Text = releases
      .find((release) => release.version === '1.7.0-beta.1')
      ?.changes.join('\n');
    expect(beta17Text).toContain('同名限时召唤物');
    expect(beta17Text).toContain('浏览器本地懒加载');
    expect(releases.some((release) => release.label.startsWith('Alpha'))).toBe(
      false,
    );
  });

  it('不会为没有公告内容的构建触发窗口', () => {
    expect(releaseNotesFor('alpha', '0.1.0-alpha.test')).toEqual([]);
  });

  it('手动打开未匹配版号时显示不晚于当前构建的最近历史公告', () => {
    expect(releaseHistoryFor('alpha', '0.2.0-alpha.63')[0]?.version).toBe(
      '0.2.0-alpha.62',
    );
    expect(releaseHistoryFor('alpha', '0.2.0-alpha.45')[0]?.version).toBe(
      '0.2.0-alpha.44',
    );
    expect(releaseHistoryFor('alpha', '0.2.0-alpha.test')[0]?.version).toBe(
      '0.2.0-alpha.62',
    );
    expect(releaseHistoryFor('release', '2.0.0')).toEqual([]);
  });

  it('为每个版本生成稳定且互不相同的已读标记', () => {
    expect(releaseAnnouncementId('alpha', '0.2.0-alpha.7')).toBe(
      'release-announcement:alpha:0.2.0-alpha.7',
    );
    expect(releaseAnnouncementId('alpha', '0.2.0-alpha.7')).not.toBe(
      releaseAnnouncementId('alpha', '0.2.0-alpha.6'),
    );
    expect(releaseAnnouncementId('alpha', '1.0.0-beta.1')).not.toBe(
      releaseAnnouncementId('beta', '1.0.0-beta.1'),
    );
  });
});
