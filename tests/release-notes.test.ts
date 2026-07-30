import { describe, expect, it } from 'vitest';
import {
  RELEASE_NOTES,
  releaseAnnouncementId,
  releaseNotesFor,
} from '@/content/release-notes';

describe('release notes', () => {
  it('从当前版本开始按新到旧返回，且最多展示五个版本', () => {
    const releases = releaseNotesFor('0.2.0-alpha.18');

    expect(releases[0]?.version).toBe('0.2.0-alpha.18');
    expect(releases.length).toBeLessThanOrEqual(5);
    expect(releases).toEqual(RELEASE_NOTES.slice(0, 5));
  });

  it('不会为没有公告内容的构建触发窗口', () => {
    expect(releaseNotesFor('0.1.0-alpha.test')).toEqual([]);
  });

  it('为每个版本生成稳定且互不相同的已读标记', () => {
    expect(releaseAnnouncementId('0.2.0-alpha.7')).toBe(
      'release-announcement:0.2.0-alpha.7',
    );
    expect(releaseAnnouncementId('0.2.0-alpha.7')).not.toBe(
      releaseAnnouncementId('0.2.0-alpha.6'),
    );
  });
});
