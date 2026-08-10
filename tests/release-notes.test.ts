import { describe, expect, it } from 'vitest';
import {
  ALPHA_RELEASE_NOTES,
  BETA_RELEASE_NOTES,
  releaseAnnouncementId,
  releaseNotesFor,
} from '@/content/release-notes';

describe('release notes', () => {
  it('从当前版本开始按新到旧返回全部历史版本', () => {
    const releases = releaseNotesFor('alpha', '0.2.0-alpha.36');

    expect(releases[0]?.version).toBe('0.2.0-alpha.36');
    expect(releases).toEqual(ALPHA_RELEASE_NOTES);
    expect(releases.length).toBeGreaterThan(5);
  });

  it('Beta 只显示自己的版本公告，不混入 Alpha 历史', () => {
    const releases = releaseNotesFor('beta', '1.0.0-beta.1');

    expect(releases).toEqual(BETA_RELEASE_NOTES);
    expect(releases.map((release) => release.label)).toEqual(['Beta 1.0']);
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
