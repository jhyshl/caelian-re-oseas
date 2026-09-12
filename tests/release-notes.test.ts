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
    const releases = releaseNotesFor('alpha', '0.2.0-alpha.79');

    expect(releases[0]?.version).toBe('0.2.0-alpha.79');
    expect(releases).toEqual(ALPHA_RELEASE_NOTES.filter(note => !['0.2.0-alpha.80', '0.2.0-alpha.81', '0.2.0-alpha.82', '0.2.0-alpha.83'].includes(note.version)));
    expect(releaseNotesFor('alpha', '0.2.0-alpha.83')).toEqual(ALPHA_RELEASE_NOTES);
    expect(releaseNotesFor('alpha', '0.2.0-alpha.80')[0]?.version).toBe('0.2.0-alpha.80');
    expect(releases.length).toBeGreaterThan(5);
    expect(releases[0]?.changes.join('\n')).toContain('动荡的皇权');
    expect(releases.find(r=>r.version==='0.2.0-alpha.78')?.changes.join('\n')).toContain('不全量覆盖世界书');
    expect(releases[0]?.changes.join('\n')).toContain('最近十楼');
    expect(releases.find(r=>r.version==='0.2.0-alpha.77')?.changes.join('\n')).toContain('共用玩家剩余AP');
    expect(releases.find(r=>r.version==='0.2.0-alpha.77')?.changes.join('\n')).toContain('设备现实时间每天凌晨零点');
    expect(releases.find(r=>r.version==='0.2.0-alpha.77')?.changes.join('\n')).toContain('一至三种不同物品，每种五至二十个');
    expect(releases.find(r=>r.version==='0.2.0-alpha.76')?.changes.join('\n')).toContain('最多缓存三个');
    expect(releases.find(r=>r.version==='0.2.0-alpha.76')?.changes.join('\n')).toContain('出牌动画、输入锁和战斗结算节奏保持原样');
    expect(releases.find(r=>r.version==='0.2.0-alpha.75')?.changes.join('\n')).toContain('41个可独立生效');
    expect(releases.find(r=>r.version==='0.2.0-alpha.75')?.changes.join('\n')).toContain('不转换为模板');
    expect(releases.find(r=>r.version==='0.2.0-alpha.74')?.changes.join('\n')).toContain('组合规则');
    expect(releases.find(r=>r.version==='0.2.0-alpha.73')?.changes.join('\n')).toContain('双击怪物');
    const resetText = releases.find(r => r.version === '0.2.0-alpha.72')?.changes.join('\n') ?? '';
    expect(resetText).toContain('迅捷');
    expect(resetText).toContain('起点以外的已解锁地区');
    expect(resetText).toContain('自定义次数');
    expect(resetText).toContain('自定义模板');
    const latestText = releases.find(r=>r.version==='0.2.0-alpha.71')!.changes.join('\n');
    expect(latestText).toContain('卡牌升星移至合成台');
    expect(latestText).toContain('2000金币');
    expect(latestText).toContain('跨城货运');
    expect(latestText).toContain('捕兽夹');
    expect(latestText).toContain('完成节点');
    const battleText = releases.find(r=>r.version==='0.2.0-alpha.70')!.changes.join('\n');
    expect(battleText).toContain('25个内置职业');
    expect(battleText).toContain('546张卡牌');
    expect(battleText).toContain('废除内置怪物随机选招');
    expect(battleText).toContain('每个目标的每一段独立判定暴击');
    const previousText = releases.find(r=>r.version==='0.2.0-alpha.69')!.changes.join('\n');
    expect(previousText).toContain('移除卡牌与天赋强度评分');
    expect(previousText).toContain('立即公开');
    const alpha67Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.67')
        ?.changes.join('\n') ?? '';
    expect(alpha67Text).toContain('藏品页面新增');
    expect(alpha67Text).toContain('普通藏品只显示展示文本');
    expect(alpha67Text).toContain('特殊藏品');
    expect(alpha67Text).toContain('内部编号');
    const alpha65Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.65')
        ?.changes.join('\n') ?? '';
    expect(alpha65Text).toContain('SillyTavern 核心接口');
    expect(alpha65Text).toContain('同名卡');
    expect(alpha65Text).toContain('_1.png');
    expect(alpha65Text).toContain('0～500');
    expect(alpha65Text).toContain('真实角色头像');
    expect(alpha65Text).toContain('从后端精确回读');
    expect(alpha65Text).toContain('确认落盘');
    const alpha64Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.64')
        ?.changes.join('\n') ?? '';
    expect(alpha64Text).toContain('单层九宫格结构');
    expect(alpha64Text).toContain('完全显示的蓝白金底纹');
    expect(alpha64Text).toContain('页眉、导航和内容层保持透明');
    expect(alpha64Text).toContain('移除额外叠加的中央宝石装饰');
    expect(alpha64Text).toContain('人物放大居中');
    expect(alpha64Text).toContain('文字对比度');
    expect(alpha64Text).toContain('蓝底白字');
    expect(alpha64Text).toContain('enabled 字段');
    expect(alpha64Text).toContain('重新读取世界书');
    const alpha63Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.63')
        ?.changes.join('\n') ?? '';
    expect(alpha63Text).toContain('边框与悬浮入口');
    expect(alpha63Text).toContain('统一重制并加粗');
    expect(alpha63Text).toContain('主面板、快捷菜单、弹窗、内部模块和入口单元格');
    expect(alpha63Text).toContain('略高于宽度的紧凑纵向比例');
    expect(alpha63Text).toContain('留白均衡');
    expect(alpha63Text).toContain('旅程主题');
    expect(alpha63Text).toContain('纯直线边段');
    expect(alpha63Text).toContain('宝石拆为独立清晰覆盖层');
    expect(alpha63Text).toContain('对齐边框中线');
    expect(alpha63Text).toContain('25% 可见度');
    expect(alpha63Text).toContain('顶部页眉、侧边/底部导航');
    expect(alpha63Text).toContain('与快捷菜单');
    expect(alpha63Text).toContain('完整实心框体');
    expect(alpha63Text).toContain('人物原图抠图保持完整居中');
    const alpha62Text =
      releases
        .find((release) => release.version === '0.2.0-alpha.62')
        ?.changes.join('\n') ?? '';
    expect(alpha62Text).toContain('心动主题');
    expect(alpha62Text).toContain('好感度达到 250');
    expect(alpha62Text).toContain('实时显示凯利安好感度');
    expect(alpha62Text).toContain('九宫格切片');
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
    const releases = releaseNotesFor('beta', '1.21.0-beta.1');

    expect(releases).toEqual(BETA_RELEASE_NOTES);
    expect(releases.map((release) => release.label)).toEqual([
      'Beta 1.21',
      'Beta 1.20',
      'Beta 1.19',
      'Beta 1.18',
      'Beta 1.17',
      'Beta 1.16',
      'Beta 1.15',
      'Beta 1.14',
      'Beta 1.13',
      'Beta 1.12',
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
    expect(releases[0]?.changes.join('\n')).toContain('重Roll本楼状态栏');
    expect(releases[0]?.changes.join('\n')).toContain('仅显示正则');
    expect(releases[0]?.changes.join('\n')).toContain('最近十楼');
    const beta120 = releases.find(release=>release.version==='1.20.0-beta.1');
    expect(beta120?.changes.join('\n')).toContain('等概率选择');
    expect(beta120?.changes.join('\n')).toContain('双击查看完整技能');
    expect(beta120?.changes.join('\n')).toContain('凌晨零点');
    const beta119Text = releases.find(r=>r.version==='1.19.0-beta.1')?.changes.join('\n') ?? '';
    expect(beta119Text).toContain('41个可独立生效');
    expect(beta119Text).toContain('不转换为模板');
    const latestText = releases.find(r=>r.version==='1.18.0-beta.1')?.changes.join('\n') ?? '';
    expect(latestText).toContain('组合规则');
    expect(latestText).toContain('玩家开放嘲讽');
    expect(latestText).toContain('石化');
    expect(latestText).toContain('生命之契');
    expect(latestText).toContain('护送终点');
    expect(latestText).toContain('两位小数');
    const beta117Text = releases
      .find((release) => release.version === '1.17.0-beta.1')
      ?.changes.join('\n');
    expect(beta117Text).toContain('战斗系统重置');
    expect(beta117Text).toContain('卡牌升星统一放在合成台');
    expect(beta117Text).toContain('2000金币');
    expect(beta117Text).toContain('跨城货运');
    expect(beta117Text).toContain('捕兽夹');
    expect(beta117Text).toContain('完成节点');
    const beta116Text = releases
      .find((release) => release.version === '1.16.0-beta.1')
      ?.changes.join('\n');
    expect(beta116Text).toContain('强制模拟评定');
    expect(beta116Text).toContain('职业与构筑');
    expect(beta116Text).toContain('直接公开');
    const beta115Text = releases
      .find((release) => release.version === '1.15.0-beta.1')
      ?.changes.join('\n');
    expect(beta115Text).toContain('只强化、防御而不攻击');
    const beta114Text = releases
      .find((release) => release.version === '1.14.0-beta.1')
      ?.changes.join('\n');
    expect(beta114Text).toContain('藏品页新增详情弹窗');
    expect(beta114Text).toContain('普通藏品只显示展示文本');
    expect(beta114Text).toContain('完整效果文本');
    expect(beta114Text).toContain('内部藏品编号');
    const beta112Text = releases
      .find((release) => release.version === '1.12.0-beta.1')
      ?.changes.join('\n');
    expect(beta112Text).toContain('SillyTavern 核心接口');
    expect(beta112Text).toContain('同名卡');
    expect(beta112Text).toContain('0～500');
    expect(beta112Text).toContain('心动主题');
    expect(beta112Text).toContain('单层九宫格');
    const beta111Text = releases
      .find((release) => release.version === '1.11.0-beta.1')
      ?.changes.join('\n');
    expect(beta111Text).toContain('感谢有你');
    expect(beta111Text).toContain('打猎分页');
    expect(beta111Text).toContain('护盾×80%');
    expect(beta111Text).toContain('自定义状态与自定义资源');
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
    expect(releaseHistoryFor('alpha', '0.2.0-alpha.999')[0]?.version).toBe(
      '0.2.0-alpha.83',
    );
    expect(releaseHistoryFor('alpha', '0.2.0-alpha.45')[0]?.version).toBe(
      '0.2.0-alpha.44',
    );
    expect(releaseHistoryFor('alpha', '0.2.0-alpha.test')[0]?.version).toBe(
      '0.2.0-alpha.83',
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
