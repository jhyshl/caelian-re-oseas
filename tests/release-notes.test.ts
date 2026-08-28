import { describe, expect, it } from 'vitest';
import {
  ALPHA_RELEASE_NOTES,
  BETA_RELEASE_NOTES,
  releaseAnnouncementId,
  releaseNotesFor,
} from '@/content/release-notes';

describe('release notes', () => {
  it('从当前版本开始按新到旧返回全部历史版本', () => {
    const releases = releaseNotesFor('alpha', '0.2.0-alpha.54');

    expect(releases[0]?.version).toBe('0.2.0-alpha.54');
    expect(releases).toEqual(ALPHA_RELEASE_NOTES);
    expect(releases.length).toBeGreaterThan(5);
    const latestText = releases[0]?.changes.join('\n') ?? '';
    expect(latestText).toContain('学院主线最终魔像战');
    expect(latestText).toContain('本轮使用过同名卡牌');
    expect(latestText).toContain('第 10 场必定触发');
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
    const releases = releaseNotesFor('beta', '1.8.0-beta.1');

    expect(releases).toEqual(BETA_RELEASE_NOTES);
    expect(releases.map((release) => release.label)).toEqual([
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
    expect(latestText).toContain('学院主线最终魔像战');
    expect(latestText).toContain('上一张使用的是同名卡牌');
    expect(latestText).toContain('首领战不会消耗保底进度');
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
