export interface ReleaseNote {
  version: string;
  label: string;
  releasedAt: string;
  changes: readonly string[];
}

const MAX_VISIBLE_RELEASES = 5;

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '0.2.0-alpha.6',
    label: 'Alpha 6',
    releasedAt: '2026-07-29',
    changes: [
      '修复部分终端已经更新到新版、却没有显示更新公告的问题。',
      '调整公告已读标记的写入时机：窗口成功打开后才会记录为已展示。',
      '继续保留每个终端、每个版本只提示一次的规则。',
    ],
  },
  {
    version: '0.2.0-alpha.5',
    label: 'Alpha 5',
    releasedAt: '2026-07-29',
    changes: [
      '新增版本更新公告；终端首次加载新版本时会自动居中显示。',
      '公告会同时展示当前版本与最近的历史版本，最多保留五个版本。',
      '同一终端的同一版本只提示一次，普通重载不再重复打扰。',
    ],
  },
  {
    version: '0.2.0-alpha.4',
    label: 'Alpha 4',
    releasedAt: '2026-07-28',
    changes: [
      '新增 Bug 与意见反馈入口，并提供复现步骤和建议写法指引。',
      '反馈提交增加频率限制与表单保护，减少误提交和垃圾内容。',
      '修正公开 Alpha 接收器的导出流程。',
    ],
  },
  {
    version: '0.2.0-alpha.3',
    label: 'Alpha 3',
    releasedAt: '2026-07-28',
    changes: [
      '开放角色、卡组、背包、公会、地图、战斗、成就和设置等主要面板。',
      '接入公开 Alpha 更新通道，支持自动更新、缓存和失败回滚。',
      '补充本地存档、MVU 投影及旧版内容数据。',
    ],
  },
  {
    version: '0.1.0-alpha.1',
    label: 'Alpha 1',
    releasedAt: '2026-07-24',
    changes: [
      '建立欧西亚斯浏览器版 Alpha 运行内核。',
      '完成本地档案、独立面板与酒馆宿主的基础接入。',
    ],
  },
] as const;

export function releaseNotesFor(version: string): readonly ReleaseNote[] {
  const currentIndex = RELEASE_NOTES.findIndex(
    (release) => release.version === version,
  );
  if (currentIndex < 0) return [];
  return RELEASE_NOTES.slice(
    currentIndex,
    currentIndex + MAX_VISIBLE_RELEASES,
  );
}

export function releaseAnnouncementId(version: string): string {
  return `release-announcement:${version}`;
}
