export interface ReleaseNote {
  version: string;
  label: string;
  releasedAt: string;
  changes: readonly string[];
}

const MAX_VISIBLE_RELEASES = 5;

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '0.2.0-alpha.9',
    label: 'Alpha 9',
    releasedAt: '2026-07-29',
    changes: [
      '新增独立的凯利安状态栏，接入好感度、情绪、关系、位置、衣着和内心想法等角色卡叙事变量。',
      '玩家面板新增凯利安好感度摘要；点击状态栏入口可查看完整内容。',
      '悬浮入口支持双击直达凯利安状态栏，同时保留单击轮盘、自由拖动、贴边收纳和三秒休眠。',
      '聊天切换与 MVU 更新完成后会刷新玩家及好感度面板，避免显示上一段聊天的旧数据。',
    ],
  },
  {
    version: '0.2.0-alpha.8',
    label: 'Alpha 8',
    releasedAt: '2026-07-29',
    changes: [
      '重构 MVU 为 v3 最小投影：完整背包、装备、卡牌、任务和战斗数据只保存在玩家浏览器 IndexedDB。',
      '新增旧 MVU 一次性归档与安全迁移，只接收凯利安叙事字段和布尔剧情标记。',
      'MVU 回写会清理旧欧西亚斯顶层变量，同时保留宠物等其他插件的 stat_data。',
    ],
  },
  {
    version: '0.2.0-alpha.7',
    label: 'Alpha 7',
    releasedAt: '2026-07-29',
    changes: [
      '修复生产环境中更新公告模块与主入口互相等待，导致公告窗口始终无法创建的问题。',
      '已在真实 SillyTavern 1.18.0 与酒馆助手 4.8.19 环境中验证父窗口挂载链路。',
    ],
  },
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
