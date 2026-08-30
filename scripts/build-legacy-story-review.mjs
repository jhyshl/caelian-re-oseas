import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SOURCE = 'D:/Backup/xwechat_files/wxid_lbrt5iais0xo22_e46d/msg/file/2026-07/凯利安 (13).json';
const sourcePath = path.resolve(process.argv[2] ?? DEFAULT_SOURCE);
const rootDir = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(rootDir, 'docs', 'quest-drafts');
const jsonOutput = path.join(outputDir, 'all_storylines.v2.review.json');
const markdownOutput = path.join(outputDir, 'ALL_STORIES.v2.review.md');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const entries = source.data?.character_book?.entries ?? source.character_book?.entries ?? source.entries;

if (!Array.isArray(entries)) {
  throw new Error('无法从旧版 JSON 中找到世界书 entries。');
}

const beat = (id, title, purpose, completionGate) => ({
  id,
  title,
  purpose,
  completionGate,
  splitType: 'structural-inference-from-legacy',
  mainApiBoundary: {
    mayAdvanceByDefault: false,
    maxAdvanceWhenGateSatisfied: 1,
    mustStopAfter: `完成“${title}”的当轮反馈后停下，等待玩家下一步行动。`,
  },
});

const normalizeSourceText = (index, text) => {
  if (index !== 109) return text;
  return text
    .replace(
      '玩家每次明确采集圣心百合时，AI可以按采集物规则把“圣心百合”加入玩家背包。目标是圣心百合 8 朵。',
      '玩家本轮明确进行采集圣心百合的行动时，副 API 应返回采集判定，并由本地系统直接打开采集页。圣心百合只能由玩家在采集页执行领取后进入背包；AI 不得直接添加、赠送或虚构采集数量。目标是圣心百合 8 朵。',
    )
    .replace(
      '当玩家背包中圣心百合达到8朵，或剧情明确采够8朵时，尼尔出现：',
      '当玩家通过本地采集页领取、且背包中的圣心百合达到8朵时，尼尔出现：',
    );
};

const scene = (id, title, locations, beats) => ({ id, title, locations, beats });
const stage = (number, id, title, primarySourceEntries, scenes, supplementSourceEntries = []) => ({
  number,
  id,
  title,
  primarySourceEntries,
  supplementSourceEntries,
  scenes,
});

const storylines = [
  {
    id: 'main_silvermoon_moonlit_invitation',
    name: '月下的邀请函',
    kind: 'main',
    region: '银月之城',
    sourceEntries: [63, 64, 65, 66, 67, 68, 69, 70],
    legacyNormalization: '保留八阶段地区主线；把每个旧阶段拆成多个可单轮判定的节拍。',
    stages: [
      stage(0, 'sicily-chase', '西西里的异色香气', [63], [
        scene('sicily-food-street', '西西里美食街', ['西西里'], [
          beat('silvermoon-sicily-arrival', '进入西西里', '呈现银色灯串、仿制血浆、月光甜酒、异国香料与吸血鬼甜点交织的美食街。', '正文已经建立西西里街景，玩家仍可自由行动。'),
          beat('silvermoon-lien-collision', '利恩撞入怀中', '让被红蔷薇追杀的吸血鬼少年利恩撞上玩家，并说明瑟琳娜正在拖住追兵。', '玩家已经注意到利恩与正在接近的追兵。'),
          beat('silvermoon-rescue-lien', '暂避追杀', '根据玩家方案处理藏匿、周旋或对抗，只解决眼前追杀，不跳到汇合。', '利恩暂时脱离追兵，且结果由玩家行动造成。'),
          beat('silvermoon-reunite-selena', '与瑟琳娜汇合', '让利恩与恋人瑟琳娜汇合，红蔷薇暂时停止追杀。', '利恩与瑟琳娜已经安全汇合。'),
          beat('silvermoon-strange-blood-clue', '神秘血浆线索', '二人说明城内近来不太平，异常可能与突然流行的神秘血浆有关，并交付维兰瑟庄园邀请函。', '玩家已得知神秘血浆线索并获得邀请函。'),
        ]),
      ]),
      stage(1, 'vilanser-moon-banquet', '维兰瑟庄园的月宴', [64], [
        scene('vilanser-manor', '维兰瑟庄园月宴', ['维兰瑟庄园'], [
          beat('silvermoon-enter-manor', '持函入宴', '玩家凭邀请函进入外表优雅、内部戒备的维兰瑟庄园。', '玩家已实际进入庄园月宴。'),
          beat('silvermoon-observe-banquet', '观察宴会阵营', '呈现吸血鬼贵族、外来商人、血液供应商与伪装的红蔷薇眼线。', '玩家已辨认宴会中至少两类立场。'),
          beat('silvermoon-vampire-loses-control', '吸血鬼短暂失控', '触发不像饥饿、而像受梦魇或潮声牵引的短暂失控事件。', '失控事件发生且玩家有机会回应。'),
          beat('silvermoon-inspect-black-salt', '检查黑色盐晶', '调查失控者接触的血液与现场，发现潮湿黑色盐晶。', '黑色盐晶已被实际发现。'),
          beat('silvermoon-factions-disagree', '事故解释分裂', '维兰瑟试图压下事故，红蔷薇视其为堕落证据；只留下调查宾客名单的方向。', '玩家已理解双方冲突，并获得酒店方向。'),
        ]),
      ]),
      stage(2, 'hiveri-missing-guests', '希维里酒店的失踪者', [65], [
        scene('hiveri-hotel', '希维里酒店', ['希维里酒店'], [
          beat('silvermoon-secret-commission', '庄园的秘密委托', '维兰瑟家族暗请玩家调查近期失踪的外来宾客。', '玩家已接受调查方向或主动前往酒店。'),
          beat('silvermoon-hotel-cases', '核对失踪名单', '确认失踪者同时包含吸血鬼与红蔷薇外围成员。', '失踪者构成已被查明。'),
          beat('silvermoon-search-room', '调查失踪房间', '通过房间、侍者、窗台与床铺调查，确认现场没有大量血迹或明显挣扎。', '至少一项现场调查已经由玩家完成。'),
          beat('silvermoon-forged-traces', '发现伪造痕迹', '发现潮湿黑盐、玫瑰刺痕、折断徽记与微弱异常气息，形成证据被刻意摆放的判断。', '黑盐与红蔷薇痕迹已同时被发现。'),
        ]),
      ]),
      stage(3, 'red-rose-interrogation', '红蔷薇据点的审问', [66], [
        scene('red-rose-base', '红蔷薇据点', ['红蔷薇据点'], [
          beat('silvermoon-enter-red-rose', '进入红蔷薇据点', '让玩家接触红蔷薇保存的失控案例与救助记录，明确其并非纯粹反派。', '玩家已看到红蔷薇救助普通人的证据。'),
          beat('silvermoon-present-emblem', '出示酒店证据', '玩家出示徽记与黑盐线索，使红蔷薇内部出现分歧。', '证据已被红蔷薇成员正面回应。'),
          beat('silvermoon-base-assault', '污染者冲击据点', '触发外表像吸血鬼、体内却带深渊污染的袭击者冲击据点。', '袭击已经发生并进入可处理状态。'),
          beat('silvermoon-identify-abyss', '确认深渊污染', '对比样本，确认部分所谓吸血鬼污染更接近深渊暗潮残留。', '深渊污染判断有现场证据支持。'),
        ]),
      ]),
      stage(4, 'monlai-sleepers', '蒙莱的长眠者', [67], [
        scene('monlai-crypt', '蒙莱长眠棺室', ['蒙莱'], [
          beat('silvermoon-monlai-admission', '最早异常在蒙莱', '维兰瑟家族承认最早异常发生在蒙莱，而非庄园。', '玩家已获得前往蒙莱的理由。'),
          beat('silvermoon-enter-monlai', '进入长眠之所', '呈现蒙莱安静、华美又压抑的长眠氛围。', '玩家已进入棺室区域。'),
          beat('silvermoon-find-dreamers', '发现深渊梦境', '确认长眠者既未苏醒也未死亡，而是被某种梦境拖拽。', '至少一名长眠者的异常已被确认。'),
          beat('silvermoon-hear-dream-words', '听见梦中词语', '发现棺中黑盐，并让梦呓依次指向潮声、极北、渊底与血月之下的门。', '四组梦境关键词已被记录。'),
        ]),
      ]),
      stage(5, 'eve-of-fracture', '月宴前夜的裂痕', [68], [
        scene('manor-and-base', '庄园与据点之间', ['维兰瑟庄园', '红蔷薇据点', '蒙莱'], [
          beat('silvermoon-two-false-reports', '双方收到假情报', '揭示红蔷薇收到献祭情报、维兰瑟收到夜袭情报。', '两份互相冲突的情报均已出现。'),
          beat('silvermoon-gather-cross-evidence', '穿梭收集证据', '允许玩家在庄园、据点与蒙莱之间收集笔迹、黑潮气息与时间线证据。', '玩家已取得足以对比两封密信的证据。'),
          beat('silvermoon-prove-third-party', '证明第三方挑拨', '指出两封密信笔迹不同却残留同一种黑潮气息，真正敌人在利用双方仇恨。', '第三方挑拨已经被至少一方承认。'),
          beat('silvermoon-attempt-deescalation', '阻止全面开战', '让玩家尝试缓和集结中的双方；成功程度可影响下一场冲突规模，但不跳过下一阶段。', '玩家的斡旋结果已经明确。'),
        ]),
      ]),
      stage(6, 'manor-conflict', '红蔷薇与吸血鬼的冲突', [69], [
        scene('manor-battle', '维兰瑟庄园冲突', ['维兰瑟庄园'], [
          beat('silvermoon-conflict-erupts', '冲突爆发', '红蔷薇闯入月宴，黑潮影响下的吸血鬼失控，庄园护卫反击。', '冲突现场已经建立，玩家可选择优先事项。'),
          beat('silvermoon-protect-innocents', '保护无辜者', '根据玩家选择处理疏散、拦截或救援，不替玩家自动完成全部战场目标。', '至少一项保护行动得到结果。'),
          beat('silvermoon-stop-extremists', '压制失控与极端者', '处理失控吸血鬼和激进红蔷薇成员，逐步获得接近幕后者的条件。', '主要阻碍已被控制，但幕后者尚未自动揭露。'),
          beat('silvermoon-reveal-proxy', '揭露幕后代理人', '依据前文选择被污染的血液商人、红蔷薇高层或试图复活亲人的维兰瑟贵族作为代理人，并保持此前线索一致。', '代理人身份由既有证据支持并被揭露。'),
          beat('silvermoon-expose-method', '确认黑潮扩散方式', '确认黑潮借血液、梦境与伪造证据推动内战、扎根城市。', '扩散机制已经成为公开事实。'),
        ]),
      ]),
      stage(7, 'moonlit-black-tide', '月下黑潮', [70], [
        scene('silvermoon-aftermath', '银月之城余波', ['维兰瑟庄园', '蒙莱', '银月之城'], [
          beat('silvermoon-factions-admit', '双方承认被利用', '红蔷薇与维兰瑟家族承认自身判断被操纵。', '双方都对挑拨事实作出回应。'),
          beat('silvermoon-temporary-safety', '危机暂时压下', '说明城市并未彻底安全，只阻止了最坏爆发。', '余波状态已经明确。'),
          beat('silvermoon-final-conclusion', '总结黑潮媒介', '总结深渊暗潮可借梦境、血液、压抑欲望与古老契约渗入城市。', '银月线核心结论已向玩家揭示。'),
          beat('silvermoon-next-region-hook', '留下极北与渊底线索', '给出追查极北之地或渊底之地的后续方向，但不自动前往。', '后续方向已记录，任务可进入结算。'),
        ]),
      ]),
    ],
  },
  {
    id: 'main_niyasos_failed_sacrifice',
    name: '失败的献祭',
    kind: 'main',
    region: '奈亚索斯城',
    sourceEntries: [71, 72, 73, 74, 75, 76, 77, 78],
    supplementSourceEntries: [126, 127, 128, 129, 130],
    legacyNormalization: '把旧版四个独立案件与暗线“集体梦境”合并为一条地区主线，但保留每个旧案件的递进线索与独立真相。',
    stages: [
      stage(0, 'moon-tear-pearls', '月泪喷泉的珍珠', [71], [
        scene('tide-square', '潮汐广场与月泪喷泉', ['潮汐广场', '月泪喷泉'], [
          beat('niyasos-hear-pearls-case', '得知珍珠连续失踪', '说明连续三周、每日供奉的小珍珠午夜消失，护卫设伏仍无结果。', '玩家已得知案件时间规律与无脚印特征。'),
          beat('niyasos-detect-water-trace', '发现水元素痕迹', '通过水元素或现场检查，发现喷泉水流被人刻意引导。', '异常水元素痕迹已被实际发现。'),
          beat('niyasos-inspect-fountain', '检查喷泉底部', '检查供奉点、喷泉底部与排水方向，不直接找到贝拉。', '玩家已锁定珍珠并非普通盗窃。'),
        ]),
      ], [126]),
      stage(1, 'pearls-carried-by-water', '被水带走的珍珠', [72], [
        scene('fountain-to-sewer', '喷泉地下水道', ['月泪喷泉', '下水道'], [
          beat('niyasos-follow-water-line', '追踪细小水线', '确认珍珠像被水线牵引进入地下暗渠。', '水流路线已经从喷泉延伸到下水道。'),
          beat('niyasos-find-pearl-dust', '发现珍珠粉末与脚印', '在下水道发现珍珠粉末、潮湿脚印及反复使用的水元素痕迹。', '三类追踪证据至少确认两类。'),
          beat('niyasos-trace-seaside-house', '锁定临海民居', '让线索指向窗帘紧闭的临海民居，先停在门外。', '玩家已找到目标民居但尚未自动进入。'),
        ]),
      ], [126]),
      stage(2, 'bella-and-linna', '母亲的笔记', [73], [
        scene('bella-house', '贝拉与林娜的家', ['临海民居', '贝拉家'], [
          beat('niyasos-meet-bella', '遇见贝拉', '让人鱼母亲贝拉对调查表现防备，逐步确认她熟悉水流。', '贝拉已进入对话且与珍珠路线发生联系。'),
          beat('niyasos-meet-linna', '遇见林娜', '让玩家认识即将满二十四岁的林娜及她天生的美妙歌喉。', '林娜与二十四岁献祭压力已被呈现。'),
          beat('niyasos-enter-bella-home', '敲响贝拉的门', '由玩家通过交涉、证据或其他合理方式进入调查，不强制闯入。', '玩家获准或有充分理由查看屋内线索。'),
          beat('niyasos-find-mothers-notes', '发现母亲笔记', '发现贝拉关于三次失败献祭与用珍珠寻找漏洞的研究。', '笔记核心内容已被玩家读到。'),
          beat('niyasos-bella-truth', '揭开失败献祭真相', '确认贝拉利用水元素让珍珠溶解并流回家中，动机是挽救林娜的歌喉。', '盗窃手法与母亲动机均已明确。'),
        ]),
      ], [126]),
      stage(3, 'haunted-opera', '闹鬼的歌剧院', [74], [
        scene('coral-palace-opera', '珊瑚宫歌剧院', ['珊瑚宫歌剧院'], [
          beat('niyasos-enter-opera', '进入歌剧院', '呈现深夜合唱、半透明幻影传闻与清洁工恐惧。', '玩家已进入歌剧院并得知闹鬼表现。'),
          beat('niyasos-meet-catherine', '认识凯瑟琳', '呈现凯瑟琳失眠、状态下滑及其有所隐瞒。', '凯瑟琳已进入对话。'),
          beat('niyasos-night-exploration', '深夜探索', '让玩家在空场歌剧院追踪合唱与幻境来源。', '玩家已在深夜定位声音来源区域。'),
          beat('niyasos-catherine-confession', '与凯瑟琳谈心', '揭示凯瑟琳因同情保持沉默，同时害怕自己的星光被纯粹歌者掩盖。', '凯瑟琳已承认自己的复杂动机。'),
          beat('niyasos-find-siren-score', '找到海妖歌谱', '获得带古旋律标记的歌谱与“哀求深海归还什么”的证言。', '歌谱与证言均已获得。'),
          beat('niyasos-meet-young-sirens', '找到唱歌的年轻海妖', '揭示所谓幽灵是渴望歌唱却无法公开身份的年轻海妖，歌声天生带幻境效果。', '年轻海妖身份及练习动机已明确。'),
        ]),
      ], [127]),
      stage(4, 'nabell-poisoning', '娜贝儿大饭店投毒案', [75], [
        scene('nabell-hotel', '娜贝儿大饭店', ['娜贝儿大饭店'], [
          beat('niyasos-poisoning-occurs', '中毒案发', '三名食客因风味海胆卷昏迷；艾瑞尔仅在同行时一并中毒。', '昏迷者与食物关联已经建立。'),
          beat('niyasos-inspect-urchin', '检查海胆', '检查食材、餐盘与烹饪流程，不提前断言人为投毒。', '海胆成为污染载体的证据已出现。'),
          beat('niyasos-identify-toxin', '发现未知毒素', '确认海鲜含未知神经毒素，梦境混乱并伴随黑暗呓语。', '毒素与梦境症状已记录。'),
          beat('niyasos-meet-kennywei', '认识肯尼微', '找到老渔民肯尼微，呈现其回避与维持生计的压力。', '肯尼微已被锁定为知情者。'),
          beat('niyasos-find-logbook', '找到航海日志', '获得“北方黑潮支流正沿地下海沟向南蔓延”的记录。', '航海日志核心记载已被玩家读到。'),
          beat('niyasos-kennywei-truth', '肯尼微说出真相', '揭示并非投毒，而是海胆产区被冰川污染水渗透；肯尼微隐瞒并尝试净化失败。', '污染来源、隐瞒动机与失败净化均已明确。'),
        ]),
      ], [128]),
      stage(5, 'bloody-love-story', '血腥爱情故事', [76], [
        scene('glow-bay-walk', '荧光海湾步道', ['荧光海湾步道'], [
          beat('niyasos-go-glow-bay', '前往荧光海湾', '建立人鱼与人类恋人失踪、现场只余凌乱痕迹和带血鳞片的案件。', '玩家已抵达失踪现场。'),
          beat('niyasos-check-blood', '检查血迹', '判断血迹与剥落鳞片的关联，不直接下结论。', '血迹来源范围已被缩小。'),
          beat('niyasos-investigate-traces', '调查凌乱痕迹', '区分真实搏斗与刻意布置的假象。', '至少一处人为布置痕迹已被识别。'),
          beat('niyasos-follow-merman', '追踪人鱼方向', '沿人鱼留下的移动方向继续追踪。', '追踪路线已指向藏身处或爱诺德拉。'),
          beat('niyasos-meet-ainodera', '找到爱诺德拉', '让人类少女爱诺德拉进入剧情，并呈现二人的私奔计划压力。', '爱诺德拉已说明恋人并非被袭击带走。'),
          beat('niyasos-elopement-truth', '揭开私奔真相', '揭示人鱼青年为逃避献出爱情记忆而自伤鳞片伪造失踪，日记留下“献祭也许是钥匙”的线索。', '私奔动机、自导自演手法与日记线索均已明确。'),
        ]),
      ], [129]),
      stage(6, 'collective-dream', '集体梦境', [77], [
        scene('shared-dream-domain', '声声不息大酒店与梦域', ['声声不息大酒店', '集体梦境'], [
          beat('niyasos-fall-into-shared-dream', '坠入共同梦境', '让多名人鱼与旅人进入同一梦域，出现反复的“出去”呓语与深海歌声。', '共同梦境已经建立，玩家仍保有探索选择。'),
          beat('niyasos-reassemble-case-clues', '重组四案线索', '让珍珠笔记、海妖歌谱、航海日志与爱情日记在梦域中形成可探索联系。', '至少三条旧线索已被玩家主动关联。'),
          beat('niyasos-witness-ancient-test', '见证千年前共鸣测试', '揭示先知派先锋接受深海“进化呼唤”，成功共鸣者成为海妖并无法回归浅海族群。', '海妖并非简单变异者的历史已揭示。'),
          beat('niyasos-understand-sacrifice', '理解二十四岁献祭', '揭示献出的最重要之物是情感印记锚点；成功者觉醒海妖特质，失败者失去物品仍维持人鱼形态。', '献祭机制已被完整理解。'),
          beat('niyasos-expose-radical-cabal', '揭露激进海妖结社', '揭示结社策划强制共鸣，意图批量制造海妖并迫使人鱼社会公开秘密、接纳海妖。', '事件发起者与政治目的已明确。'),
          beat('niyasos-escape-dream', '与同伴离开梦境', '让玩家依据已理解的真相与同伴一起脱离梦域，不自动替玩家完成。', '玩家与同伴已成功离开共同梦境。'),
        ]),
      ], [130]),
      stage(7, 'deep-sea-call', '深海召唤', [78], [
        scene('niyasos-conclusion', '奈亚索斯城收束', ['奈亚索斯城', '潮汐广场'], [
          beat('niyasos-connect-all-clues', '汇总全部线索', '把献祭、海妖共鸣、北方黑潮支流与深海意识连成一条证据链。', '四案与梦境结论已完成汇总。'),
          beat('niyasos-city-crisis-settles', '城市危机暂时平息', '说明危机只是暂时收束，并处理相关人物余波。', '奈亚索斯当前危机已有明确结果。'),
          beat('niyasos-unlock-abyss', '解锁阿必塞海', '让更古老的深海召唤指向阿必塞海与亚特兰蒂斯，不剧透其内部真相。', '阿必塞海路线已解锁，任务可结算。'),
        ]),
      ]),
    ],
  },
  {
    id: 'main_abyss_atlantis_echo',
    name: '旧日回声',
    kind: 'main',
    region: '阿必塞海',
    sourceEntries: [79, 80, 81, 82, 83],
    supplementSourceEntries: [132],
    legacyNormalization: '五个探索阶段保留；旧版“亚特兰蒂斯相关”全文作为核心真相源，按壁画、石室、笔记与祭坛拆分。',
    stages: [
      stage(0, 'atlantis-entrance', '亚特兰蒂斯', [79], [
        scene('sunken-city-entrance', '失落古城入口', ['亚特兰蒂斯'], [
          beat('abyss-arrive-atlantis', '抵达海渊古城', '呈现深埋海渊、与龙族同样古老的传说及被海水侵蚀的旧日城市。', '玩家已抵达古城入口。'),
          beat('abyss-find-palace-route', '寻找宫殿道路', '探索残破建筑，确认入口通向残破宫殿，不提前透露石室真相。', '通往宫殿的道路已被找到。'),
        ]),
      ], [132]),
      stage(1, 'ruined-palace', '残破的宫殿', [80], [
        scene('palace-mural-front', '主殿壁画前半段', ['残破的宫殿'], [
          beat('abyss-find-main-mural', '发现主殿壁画', '让玩家在残破主殿找到仍可解读的精致壁画。', '壁画已进入玩家视野。'),
          beat('abyss-snake-and-apple', '蛇与红苹果', '呈现蛇偷食红苹果并产下人身蛇尾族群的创世画面。', '蛇人诞生段已被解读。'),
          beat('abyss-snake-becomes-world', '蛇化山川作物', '呈现蛇死后化作山川湖泊与作物，蛇人依靠其粮食度过百年。', '世界与粮食起源段已被解读。'),
          beat('abyss-snake-civilization', '蛇人文明繁盛', '呈现蛇人以强悍体格和原力快速繁衍、建造华美城邦与宫殿。', '辉煌文明段已被解读。'),
        ]),
      ], [132]),
      stage(2, 'prosperous-city', '曾经繁华的都城', [81], [
        scene('palace-mural-back', '主殿壁画后半段', ['曾经繁华的都城'], [
          beat('abyss-damaged-transformation', '被毁损的制造记录', '呈现蛇人制造某种已被毁损的事物，随后蛇尾变成双腿。', '毁损段与双腿变化已被观察。'),
          beat('abyss-force-overflow', '原力越过世界上限', '揭示原力超出世界承受上限。', '浩劫原因已指向原力越界。'),
          beat('abyss-world-overturns', '海啸山鸣与天地翻转', '呈现海水倒灌、城墙倒塌及天地两极反转。', '亚特兰蒂斯沉没过程已揭示。'),
          beat('abyss-ark-vanishes', '方舟逃生后失踪', '揭示人类制造象征生存的巨大方舟应对危机，但方舟最终去向不明。', '方舟伏笔已记录。'),
        ]),
      ], [132]),
      stage(3, 'mysterious-stone-room', '神秘的石室', [82], [
        scene('poseidon-record-room', '赛冬记录石室', ['神秘的石室'], [
          beat('abyss-find-broken-egg', '发现破碎蛇蛋', '在主殿石室发现破碎蛇蛋与人鱼族文字记录；只有人鱼或海妖能直接读懂。', '蛇蛋与文字条件已明确。'),
          beat('abyss-poseidon-origin', '赛冬自述起源', '揭示赛冬是神父最后遗嗣、人鱼族最初起源，蛇尾变成鱼尾且继承族群全部记忆。', '赛冬身份与人鱼起源已揭示。'),
          beat('abyss-seal-memory', '封印旧日记忆', '揭示赛冬为让族人以新身份触碰新生而封印记忆、埋葬旧都秘密。', '封印记忆的动机已揭示。'),
          beat('abyss-note-one', '诡异笔记一', '呈现赛冬以血、肉、骨捏造旧日党羽，却发现他们同样只有鱼尾。', '笔记一已读。'),
          beat('abyss-note-two', '诡异笔记二', '呈现黑色迷雾在梦中呼唤、本为一体的感觉与被墨迹抹去的否认。', '笔记二已读。'),
          beat('abyss-note-three', '诡异笔记三', '呈现族人梦见迷雾、接受邀请后重获蛇尾却变得残暴，赛冬决定阻止禁忌。', '笔记三已读。'),
          beat('abyss-note-four', '诡异笔记四', '呈现赛冬抽出金色脊骨铸成骨剑，镇压邪恶召唤并祝愿族人走向明天。', '笔记四与金色骨剑去向已揭示。'),
        ]),
      ], [132]),
      stage(4, 'abyss-altar', '海渊祭坛', [83], [
        scene('golden-bone-sword-altar', '金色骨剑祭坛', ['海渊祭坛'], [
          beat('abyss-reach-altar', '抵达海渊祭坛', '沿赛冬记录找到镇压旧日召唤的祭坛。', '玩家已实际抵达祭坛。'),
          beat('abyss-find-bone-sword', '找到金色骨剑', '确认骨剑来自赛冬的金色脊骨，是封印媒介而非普通武器。', '金色骨剑已被找到并确认来源。'),
          beat('abyss-confirm-old-call', '确认祭坛真相', '总结亚特兰蒂斯、人鱼、海妖、黑雾与深渊暗潮的联系，但不解决整个暗潮。', '祭坛镇压对象与旧日召唤关系已明确。'),
          beat('abyss-leave-larger-hook', '留下渊底线索', '留下通往极北或渊底之地的更大线索并进入结算。', '后续线索已记录，任务可结算。'),
        ]),
      ], [132]),
    ],
  },
  {
    id: 'main_solavia_sacred_underground',
    name: '圣心地下',
    kind: 'main',
    legacyKind: 'side',
    region: '索拉维亚 / 索拉姆',
    sourceEntries: [84, 85, 86, 87, 88, 89, 90, 91],
    supplementSourceEntries: [133, 134, 135, 136],
    legacyNormalization: '原版 DLC 将其称作“圣教会支线”，后续文件把它升级成索拉维亚地区主线。本稿合并两套文本，不重复生成第二条同剧情任务。',
    stages: [
      stage(0, 'missing-kaila', '沃西微失踪案', [84], [
        scene('woxiwei-encounter', '沃西微与失踪委托', ['沃西微', '索拉姆'], [
          beat('solavia-meet-felicity', '遇见费莉西蒂', '让焦急的平民妇人费莉西蒂说明女儿凯拉已失踪三日。', '失踪委托已经由玩家知晓。'),
          beat('solavia-ask-street-children', '询问流浪孩子', '通过调查得知有人看见凯拉前往圣教会。', '圣教会方向已有目击证词。'),
          beat('solavia-see-church-facade', '观察圣教会表象', '呈现施粥、礼拜、瓦尔肯的温和悲悯与以希洁的安静圣洁。', '教会的完美公共形象已经建立。'),
        ]),
      ], [133, 134]),
      stage(1, 'sacred-heart-cathedral', '圣心大教堂', [85], [
        scene('cathedral-inquiry', '大教堂询问', ['圣心大教堂'], [
          beat('solavia-question-valken', '询问瓦尔肯', '瓦尔肯平静否认见过凯拉，保持温和、不急躁的说话方式。', '瓦尔肯的否认已经发生。'),
          beat('solavia-meet-ezekiel', '认识以希洁', '呈现以希洁不近人情、像在模仿爱与悲悯的疏离感。', '玩家已与以希洁有实质交流。'),
          beat('solavia-hear-saintly-reputation', '核对教皇声誉', '教徒称瓦尔肯为活着的圣人，同时呈现其真实的善行，避免单纯恶人化。', '玩家已获得支持瓦尔肯表面形象的证词。'),
          beat('solavia-find-torn-list', '发现被撕名单', '在施粥名单中发现凯拉名字及被撕去的页脚。', '凯拉姓名与教会的书面联系已被发现。'),
        ]),
      ], [133, 134, 136]),
      stage(2, 'statue-mechanism', '神像背面的机关', [86], [
        scene('hidden-underground-entry', '教堂地下入口', ['圣心大教堂', '神像背面'], [
          beat('solavia-find-wear-marks', '发现神像磨损', '通过玩家调查发现神像背后的磨损与隐藏机关。', '机关位置已有现场证据。'),
          beat('solavia-open-hidden-door', '开启地下通道', '启动机关，让墙后露出通往地下建筑的入口。', '隐藏通道已经开启。'),
          beat('solavia-enter-warm-underground', '进入温暖地下空间', '呈现夜明珠、长明灯与近乎虚假的温暖，而不是阴冷地牢。', '玩家已进入地下区域。'),
        ]),
      ], [135]),
      stage(3, 'underground-laboratory', '实验室', [87], [
        scene('valken-laboratory', '瓦尔肯的地下实验室', ['实验室'], [
          beat('solavia-search-laboratory', '检查炼金实验室', '呈现炼金材料、法阵、古籍与研究设施。', '玩家已检查至少一类实验材料。'),
          beat('solavia-light-dark-research', '发现光明与黑暗研究', '揭示瓦尔肯研究两种力量纠缠直至湮灭，并寻找原力。', '研究方向已被文献支持。'),
          beat('solavia-human-origin-force', '发现人体原力记录', '揭示原力只能从人体提取，以及多个贫病孩子被编号记录。', '人体原力与编号孩子记录已被发现。'),
          beat('solavia-follow-child-records', '追查孩子下落', '让记录将玩家引向安眠处，不提前展示小伊万。', '安眠处方向已经被锁定。'),
        ]),
      ], [133, 135, 136]),
      stage(4, 'resting-place', '安眠处', [88], [
        scene('underground-cemetery', '地下安眠处', ['安眠处'], [
          beat('solavia-find-coffins', '发现棺材与祭奠', '呈现大量棺材、鲜花与蜡烛，使场所更像悔罪地而非屠宰场。', '玩家已看见瓦尔肯持续祭奠的证据。'),
          beat('solavia-understand-children', '确认孩子们的处境', '说明实验对象大多本就因疾病或严寒濒死，并非瓦尔肯主动杀害；同时不抹去利用他们实验的越界。', '死亡原因与伦理责任都已明确。'),
          beat('solavia-find-ivan', '发现小伊万冰棺', '在深处找到小伊万，金色法阵持续用光明元素压制其深渊污染。', '伊万身份、污染与维生方式已确认。'),
        ]),
      ], [133, 134, 135, 136]),
      stage(5, 'valken-truth', '瓦尔肯的真相', [89], [
        scene('confrontation-with-valken', '与瓦尔肯对峙', ['安眠处', '实验室'], [
          beat('solavia-valken-orphan-faith', '瓦尔肯的信仰起点', '揭示瓦尔肯曾是被前任神父救助的孤儿，真诚信仰光明并爱世人。', '瓦尔肯早年经历已被说明。'),
          beat('solavia-aileen-and-ivan', '艾琳与伊万', '揭示瓦尔肯与艾琳相爱育子、艾琳病逝，以及他承诺照顾伊万。', '家庭背景已被说明。'),
          beat('solavia-ivan-corruption', '隆多途中的污染', '揭示二十年前前往隆多途中遭遇深渊暗潮，伊万被侵蚀，瓦尔肯对外宣称其病逝。', '伊万事故与隐瞒起点已明确。'),
          beat('solavia-crossed-line', '为拯救儿子越界', '揭示瓦尔肯从濒死孩子身上提取原力，在愧疚中继续研究，害怕败露又渴望解脱。', '动机、手段与愧疚同时被揭示。'),
          beat('solavia-ezekiel-origin', '人造天使以希洁', '揭示以希洁是原力具象化的人造天使，瓦尔肯既真心教养他，也保留未来利用其帮助伊万的私心。', '以希洁的来源与瓦尔肯的双重动机已明确。'),
        ]),
      ], [133, 134, 136]),
      stage(6, 'false-heaven-feather', '虚假的天羽', [90], [
        scene('ezekiel-choice', '以希洁的选择', ['圣心大教堂地下'], [
          beat('solavia-resolve-kaila', '处理凯拉下落', '根据此前调查让凯拉获救或确认其结局，不用结算替代剧情。', '费莉西蒂委托已有明确结果。'),
          beat('solavia-ezekiel-acts-by-will', '以希洁第一次自主选择', '让以希洁不再只是模仿悲悯，而是基于自己的意志回应真相。', '以希洁作出一个非命令驱动的选择。'),
          beat('solavia-give-false-feather', '交付虚假的天羽', '以希洁交出不属于高天、并不纯粹却能净化伤痛的羽毛。', '虚假的天羽已被交付或进入待结算记录。'),
        ]),
      ], [133, 134, 136]),
      stage(7, 'faith-aftermath', '余波', [91], [
        scene('cathedral-aftermath', '圣心大教堂余波', ['圣心大教堂', '索拉维亚'], [
          beat('solavia-valken-aftermath', '瓦尔肯面对揭露', '呈现瓦尔肯、教会与信仰秩序无法恢复原样，但不要重复地下调查。', '瓦尔肯与教会后续状态已明确。'),
          beat('solavia-ezekiel-belonging', '以希洁的归属迷惘', '保留以希洁对自我、爱与归属的茫然。', '以希洁的后续关系状态已记录。'),
          beat('solavia-caelian-kin-sense', '高好感隐藏对话', '仅在以希洁对玩家与凯利安好感足够高时，让他告诉凯利安两人具有相似气息。', '满足好感门槛时对话已发生；不满足时跳过但不伪造。'),
          beat('solavia-deep-tide-hook', '留下深渊暗潮线索', '把伊万污染与更大深渊暗潮连接，任务进入结算。', '后续追查方向已记录。'),
        ]),
      ], [136]),
    ],
  },
  {
    id: 'main_ethera_ashen_ancient_tree',
    name: '灰烬古树',
    kind: 'main',
    region: '艾瑟拉森林',
    sourceEntries: [92, 93, 94, 95, 96, 97, 98, 99],
    legacyNormalization: '保留八阶段森林主线，并把线索揭露与跨地区伏笔分开。',
    stages: [
      stage(0, 'charred-forest', '焦木林的失控枯树妖', [92], [scene('charred-forest', '焦木林', ['焦木林'], [
        beat('ethera-enter-charred-forest', '进入焦木林', '呈现光明元素近乎断绝、焦黑树干低语与百年前余烬。', '焦木林环境已经建立。'),
        beat('ethera-treants-attack', '枯树妖异常攻击', '让暴躁枯树妖与主动缠人的根须形成眼前威胁。', '异常攻击发生且玩家有机会处理。'),
        beat('ethera-rangers-warn', '巡林精灵警告', '由撒诺或巡林精灵阻止深入，说明百年怨念仍未平息。', '精灵警告与旧日大火已被提及。'),
      ])]),
      stage(1, 'blue-tear-lake', '蓝眼泪湖的鹿灵', [93], [scene('blue-tear-lake', '蓝眼泪湖', ['蓝眼泪湖'], [
        beat('ethera-follow-remnants', '追踪残留到湖边', '沿焦木林异常痕迹抵达蓝眼泪湖。', '玩家已到达湖边。'),
        beat('ethera-meet-deer-spirit', '遇见鹿灵', '让罕见鹿灵以意识碎片而非直接说话交流。', '鹿灵已与玩家建立意识接触。'),
        beat('ethera-see-memory-fragments', '看见火灾碎片', '依次呈现火光、偏移炮声、烧断树根、哭泣精灵与沉湖蓝泪。', '五类记忆碎片已被记录。'),
      ])]),
      stage(2, 'forest-heart-rejection', '林心地的排斥', [94], [scene('forest-heart', '林心地', ['林心地'], [
        beat('ethera-arrive-forest-heart', '抵达林心地', '呈现精灵并不粗暴驱逐却明显排斥外人。', '玩家已感受到明确的进入阻力。'),
        beat('ethera-donomi-listens', '多诺米听取解释', '让多诺米愿意听取玩家说明，撒诺可提供担保。', '至少一名精灵愿意继续交流。'),
        beat('ethera-kaira-closes-wound', '凯拉拒绝翻旧伤', '让凯拉对焦木林异常敏感，却要求众人不要翻动旧日伤口。', '凯拉立场已明确，但未泄露古树衰退。'),
      ])]),
      stage(3, 'altar-cracks', '光明祭台的裂纹', [95], [scene('light-altar', '光明祭台', ['光明祭台'], [
        beat('ethera-enter-light-altar', '进入光明祭台', '由多诺米带玩家来到仍温暖明亮的祭台。', '玩家已进入祭台。'),
        beat('ethera-find-ritual-cracks', '发现仪式裂纹', '发现仪式纹路细小裂缝与光明循环时断时续。', '裂纹与循环异常已确认。'),
        beat('ethera-trace-deeper-roots', '问题指向深层根系', '让多诺米意识到问题不只在焦木林，而在更深处根系。', '古树根庭方向已建立。'),
      ])]),
      stage(4, 'ancient-root-court', '古树之根', [96], [scene('root-court', '古树根庭', ['古树根庭'], [
        beat('ethera-enter-root-court', '进入祭台下方根庭', '探索光明祭台下方的古树根系。', '玩家已进入根庭。'),
        beat('ethera-see-charred-roots', '发现焦黑裂纹', '确认微弱光辉根系中夹杂持续的焦黑裂纹。', '根系损伤已确认。'),
        beat('ethera-find-machine-fragment', '取出焦黑机械碎片', '发现被树脂包住、带复杂矮人机械纹路的碎片。', '机械碎片已被发现并记录。'),
      ])]),
      stage(5, 'kaira-secret', '凯拉的秘密', [97], [scene('private-audience', '凯拉私下会面', ['林心地', '光明祭台'], [
        beat('ethera-kaira-private-meeting', '凯拉单独召见', '在普通精灵不知情的情况下进行私下会面。', '会面已脱离公众视线。'),
        beat('ethera-ancient-tree-declines', '承认古树衰退', '凯拉承认古树力量正在衰退。', '古树衰退真相已向玩家揭露。'),
        beat('ethera-fear-of-panic', '说明隐瞒原因', '说明古树与祭台是最后精神支柱，公开真相可能使森林在恐慌中崩裂。', '凯拉隐瞒动机已被理解。'),
        beat('ethera-hatred-and-delay', '仇恨不能继续拖延', '保留凯拉未原谅矮人的立场，同时承认拖延会让森林更快枯死。', '凯拉的矛盾立场已完整呈现。'),
      ])]),
      stage(6, 'soothe-charred-forest', '焦木林的安抚', [98], [scene('soothing-ritual', '焦木林安抚仪式', ['焦木林'], [
        beat('ethera-return-with-sprout', '带古树枝芽返回', '玩家携带古树枝芽回到焦木林。', '玩家已带着仪式媒介抵达。'),
        beat('ethera-deer-guides', '鹿灵引路', '由鹿灵引导至怨念核心。', '仪式地点已找到。'),
        beat('ethera-donomi-ritual', '多诺米主持仪式', '多诺米执行安抚，凯拉亲自压住焦木林怨念。', '仪式已在玩家参与下完成。'),
        beat('ethera-treants-stabilize', '枯树妖停止扩散', '明确枯树妖没有消失，只是停止扩散；凯拉承认仇恨也会拖死森林。', '焦木林状态已稳定但未虚假治愈。'),
      ])]),
      stage(7, 'after-ashes', '灰烬之后', [99], [scene('forest-aftermath', '艾瑟拉森林余波', ['林心地', '艾瑟拉森林'], [
        beat('ethera-roots-stabilize', '古树暂时稳定', '说明根系暂时稳定、焦木林停止扩张。', '森林当前状态已明确。'),
        beat('ethera-kaira-gives-sprout', '凯拉交出古树残芽', '凯拉仍不原谅矮人，但把古树残芽交给玩家。', '古树残芽已交付或记录。'),
        beat('ethera-hearth-message', '留下炉心城托付', '保留凯拉原话含义：若将来去炉心城，替她看看矮人是否仍记得那场火；不自动开启跨等级剧情。', '炉心城伏笔已记录，任务可结算。'),
      ])]),
    ],
  },
  {
    id: 'main_hearth_embers',
    name: '炉心余烬',
    kind: 'main',
    region: '炉心城',
    sourceEntries: [100, 101, 102, 103, 104, 105, 106],
    legacyNormalization: '保留七阶段调查链；增加“有/无艾瑟拉碎片”的兼容入口，但不改变真相。',
    stages: [
      stage(0, 'dick-tavern', '迪克酒馆的旧笑话', [100], [scene('dick-tavern', '迪克酒馆', ['迪克酒馆'], [
        beat('hearth-hear-rude-jokes', '听见关于精灵的粗鲁笑话', '呈现矮人对精灵的粗鲁评价和对百年前大火的轻描淡写。', '玩家已听见至少两种说法。'),
        beat('hearth-find-inconsistency', '发现事故说法不一', '让不同矮人对城防炮事故的说法互相矛盾。', '说法矛盾已被玩家察觉。'),
        beat('hearth-follow-old-parts', '追查旧式机械', '把调查方向引向武器工坊和旧式城防炮零件。', '博亚与武器工坊方向已明确。'),
      ])]),
      stage(1, 'boya-workshop', '博亚的武器工坊', [101], [scene('weapon-workshop', '武器工坊', ['武器工坊'], [
        beat('hearth-show-fragment-or-old-part', '出示碎片或检查旧件', '有艾瑟拉碎片时交给博亚鉴定；没有时通过工坊旧件获得同一必要线索。', '至少一种入口已实际触发。'),
        beat('hearth-identify-stabilizer', '确认城防炮稳定器', '博亚确认其属于旧式城防炮稳定器，却不愿承认与艾瑟拉大火有关。', '零件身份与博亚态度已明确。'),
      ])]),
      stage(2, 'sealed-archives', '研究制造所的封存档案', [102], [scene('manufacturing-institute', '研究制造所', ['研究制造所'], [
        beat('hearth-luke-refuses', '卢克拒绝接待', '呈现卢克对旧事故调查的抵触。', '卢克的阻拦已发生。'),
        beat('hearth-lina-mediates', '丽娜出面缓和', '由丽娜帮助玩家接触旧档案。', '玩家已获得有限查档权限。'),
        beat('hearth-find-missing-pages', '发现试射记录缺页', '确认城防炮试射与能源核心记录存在人为缺失。', '缺页并非自然损坏的判断已形成。'),
      ])]),
      stage(3, 'ghost-crystal', '岩采矿洞的幽晶石', [103], [scene('rock-mine', '岩采矿洞', ['岩采矿洞'], [
        beat('hearth-investigate-ghost-crystal', '调查幽晶石', '确认当年城防炮使用的幽晶石能源不稳定。', '能源不稳定已有实物或记录证据。'),
        beat('hearth-question-cave-creatures', '询问高智岩窟怪', '让少数高智岩窟怪回忆试射前矿层曾异常震动。', '试射前异常震动已有证词。'),
        beat('hearth-question-approval', '质疑试射批准', '形成“明知不稳定仍批准试射”的调查方向。', '责任链问题已被明确提出。'),
      ])]),
      stage(4, 'lina-consciousness-core', '丽娜的意识核心', [104], [scene('old-machine-record', '旧式机械记录', ['研究制造所'], [
        beat('hearth-lina-connects-record', '丽娜连接旧记录', '由丽娜读取旧式机械记录。', '记录读取已开始并获得有效数据。'),
        beat('hearth-find-deliberate-deletion', '发现人为删除', '确认档案曾被人为删除。', '删除行为已有技术证据。'),
        beat('hearth-guilt-sealed-as-accident', '看见被封存的愧疚', '说明矮人并非没有愧疚，只是把愧疚封进“事故”二字。', '隐瞒背后的群体心态已呈现。'),
      ])]),
      stage(5, 'barrel-deviation-day', '炮口偏移之日', [105], [scene('accident-reconstruction', '城防炮事故重现', ['研究制造所', '城防炮'], [
        beat('hearth-rebuild-timeline', '重建试射时间线', '结合碎片、缺页、幽晶石与机械记录重建事故。', '关键证据已进入同一时间线。'),
        beat('hearth-confirm-not-massacre', '确认并非蓄意屠杀', '排除矮人蓄意焚毁森林的结论。', '非蓄意已被证据支持。'),
        beat('hearth-confirm-culpability', '确认并非无辜天灾', '指出急躁、傲慢、技术崇拜与明知风险仍试射构成重大责任。', '矮人责任链已完整明确。'),
      ])]),
      stage(6, 'hearth-embers', '炉心余烬', [106], [scene('hearth-aftermath', '炉心城余波', ['炉心城'], [
        beat('hearth-luke-admits', '卢克承认不该封档', '卢克仍嘴硬，但承认档案不应继续封存。', '卢克已对封档作出回应。'),
        beat('hearth-lina-publishes', '丽娜主张公开记录', '让丽娜推动整理并公开百年前记录。', '公开方案已形成。'),
        beat('hearth-boya-builds-device', '博亚愿做稳定装置', '博亚不愿道歉，却愿意制作稳定古树根系的机械装置。', '博亚给出可执行补救。'),
        beat('hearth-no-instant-reconciliation', '保留尚未和解', '明确精灵不会立刻原谅、矮人也不会轻易低头，但双方第一次拥有同一份真相。', '真相公开且未虚假达成和解，任务可结算。'),
      ])]),
    ],
  },
  {
    id: 'main_academy_anniversary_preparation',
    name: '圣德里安周年庆筹备日',
    kind: 'main',
    region: '圣德里安学院',
    sourceEntries: [111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121],
    mechanicsSourceEntries: [122],
    legacyNormalization: '保留首次游玩限定接取、三个并行筹备节点与最终首领战；原互动卡字段作为本地动作，不再要求主 API 逐字输出。',
    stages: [
      stage(0, 'anniversary-enrollment', '首次游玩登记', [111], [scene('central-square-registration', '中央广场登记台', ['中央广场'], [
        beat('academy-show-preparations', '周年庆筹备现场', '呈现登记表、材料单、巡查名单堆积的中央广场，以及塞西莉亚维持秩序。', '筹备现场与四名负责人已介绍。'),
        beat('academy-register-supervisors', '登记巡查督导组', '仅首次游玩强制开场把玩家与凯利安登记为巡查督导组；其他开场不得强接。', '首次开场条件满足且三条并行节点已发放。'),
      ])]),
      stage(1, 'parallel-preparations', '三项并行筹备', [112, 113, 114, 115, 116, 117, 118, 119, 120], [
        scene('alice-firework-materials', '爱丽丝：烟花材料', ['魔药课教室'], [
          beat('academy-alice-argument', '材料审批争执', '呈现爱丽丝要求追加材料、塞西莉亚要求体面稳定可控、凯利安试图调停。', '玩家已主动询问、检查或参与调停。'),
          beat('academy-alice-inventory', '清点剩余材料', '检查爆炸痕迹与可用边角料，整理用途、损耗和风险等级。', '材料清点或安全分类已完成。'),
          beat('academy-alice-claim-materials', '收下安全材料', '由本地交互发放城郊药草×2、治愈苔×1、空玻璃瓶×1，并触发合成消耗品教程。', '本地领取成功并将节点标为 completed。'),
        ]),
        scene('ariel-alchemy-device', '艾瑞尔：自动化装置', ['炼金课教室'], [
          beat('academy-ariel-introduction', '查看自动化装置', '呈现艾瑞尔认真设计同步控制搬运、灯光、烟花提示、魔像与舞台队列的装置。', '玩家已询问、靠近或提出测试。'),
          beat('academy-ariel-safety-test', '进行安全检查', '低功率测试中，魔偶误把凯利安披风当搬运目标；玩家可调整线路、接口或安抚学生。', '测试问题已指出或修正，装置暂时稳定。'),
          beat('academy-ariel-claim-charms', '收下三件生命护符', '由本地交互发放三件一星生命护符，并触发装备升星与查看装备教程。', '本地领取成功并将节点标为 completed。'),
        ]),
        scene('lucius-cake-tasting', '卢修斯：校庆蛋糕', ['餐厅'], [
          beat('academy-lucius-cake-plan', '加入蛋糕装点讨论', '呈现卢修斯提出有道理却添麻烦的建议，并邀请凯利安评价贵宾席蛋糕。', '玩家已靠近、交谈、评价或参与试吃。'),
          beat('academy-lucius-tasting', '试吃与拱火', '让凯利安用体面措辞评价过甜、夸张的装饰，玩家帮助确定可行方案。', '试吃与装饰方向已完成。'),
          beat('academy-feed-teo', '投喂特莱奥', '特莱奥被甜品吸引；由本地提交动作消耗精制面包×1，没有道具时引导去集市购买。', '精制面包已由本地校验并扣除，节点标为 completed。'),
        ]),
      ]),
      stage(2, 'square-riot', '无为广场的骚动', [121], [scene('wuwei-square-boss', '周年庆预演事故', ['无为广场'], [
        beat('academy-hear-square-riot', '广场传来骚动', '完成三节点后，让玩家与凯利安在巡查中听见无为广场骚动。', '三个并行节点均 completed 且玩家已前往广场。'),
        beat('academy-golem-switches-mode', '教学魔像切换攻击形态', '明确事故来自艾瑞尔接手的自动化装置误把表演预演识别为实战演示。', '事故原因已现场确认。'),
        beat('academy-team-controls-scene', '众人分工控场', '塞西莉亚疏散、爱丽丝压制烟火、卢修斯收起玩笑、凯利安与玩家保护学生；不让所有人背锅。', '疏散与控场已形成。'),
        beat('academy-preboss-deck', '首领战前卡牌准备', '由本地交互完成战前卡牌选择与牌组编辑，未完成时禁止进入战斗。', '本地记录确认战前准备完成。'),
        beat('academy-defeat-golem', '迎战失控教学魔像', '触发 boss_academy_arcane_golem 战斗，并以战斗系统胜利结果为准。', '本地战斗结果为胜利。'),
        beat('academy-anniversary-settlement', '周年庆主线收束', '处理事故余波，发放校庆打卡册并进入主线结算。', '胜利后收束完成，任务可结算。'),
      ])]),
    ],
  },
  {
    id: 'side_flora_says',
    name: '芙萝拉说',
    kind: 'side',
    region: '伊拉亚城',
    sourceEntries: [107, 108, 109, 110],
    detailedReviewFile: 'side_flora_says.v2.review.json',
    legacyNormalization: '保留 A/B 结局、完整墓前往事、旧版原话与八朵圣心百合本地提交；详细稿已单列，本总稿保留完整路线。',
    stages: [
      stage(1, 'todays-flowers', '卖完今天的花', [107, 108], [scene('central-market-flower-stall', '中央商业区花摊', ['中央商业区'], [
        beat('flora-encounter', '遇见芙萝拉', '呈现约七八岁、声音容易被人潮淹没、急着卖花的小女孩。', '玩家已经注意到并回应芙萝拉。'),
        beat('flora-selling-flowers', '帮忙卖花', '允许买花、吆喝、介绍花束或陪伴等方式帮她卖完。', '今天的花已通过玩家行动卖完。'),
        beat('flora-violet-offer', '最后一束紫罗兰', '芙萝拉询问是否收下带残叶的最后一束紫罗兰；接受或拒绝只影响氛围。', '玩家已经表达接受或拒绝。'),
        beat('flora-lily-invitation', '邀请采圣心百合', '芙萝拉请求玩家陪她去城郊采花；明确拒绝可进入早期 B 结局。', '玩家答应同行，或明确拒绝并完成 B 线收束。'),
      ])]),
      stage(2, 'outskirts-lilies', '采集八朵圣心百合', [109], [scene('outskirts-lily-slope', '城郊百合坡', ['城郊', '幽光森林'], [
        beat('flora-travel-outskirts', '前往城郊', '实际描写离开商业区前往城郊，不瞬移。', '玩家已抵达城郊。'),
        beat('flora-find-slope', '找到百合坡', '呈现阳光、风与适合圣心百合生长的坡地。', '百合坡已被找到。'),
        beat('flora-gather-eight-lilies', '只采盛开的花', '玩家本轮明确进行采集时，由副 API 判定并打开本地采集页；玩家只能在采集页领取现有区域特产“圣心百合”，AI 不得直接向背包添加物品。', '玩家在本地采集页领取后，背包圣心百合数量至少八朵。'),
        beat('flora-neil-arrives', '尼尔出现', '采足八朵后，提着东西的尼尔出现并向玩家道谢。', '数量门槛满足后尼尔已登场。'),
        beat('flora-memorial-invitation', '得知梅娅忌日', '尼尔说明今天是梅娅忌日，并邀请玩家同行去墓园；拒绝可进入后期 B 结局。', '玩家答应同行，或明确拒绝并完成 B 线收束。'),
      ])]),
      stage(3, 'before-mayas-grave', '梅娅墓前', [110], [scene('cemetery-memorial', '城郊墓园', ['城郊墓园'], [
        beat('flora-travel-cemetery', '前往墓园', '与父女实际同行前往城郊墓园。', '玩家已抵达墓园。'),
        beat('flora-clean-grave', '看见整洁墓碑', '呈现梅娅墓碑干净、显然经常有人整理。', '墓碑细节已经呈现。'),
        beat('flora-florists-past', '花匠与花店往事', '尼尔讲述自己与梅娅都是花匠、曾共同经营花店。', '花店往事已讲述。'),
        beat('flora-maya-illness', '梅娅患病', '讲述芙萝拉四岁时梅娅感染实际由深渊暗潮侵蚀造成的恶疾。', '病发时间与真实病因已揭示。'),
        beat('flora-woxiwei-hardship', '耗尽家产仍未治愈', '讲述一家耗尽家产、搬进沃西微贫民窟仍未治好梅娅。', '家庭困境已讲述。'),
        beat('flora-bedside-lilies', '床头百合回忆', '保留父女采百合、尼尔落泪与梅娅安慰他的原话。', '床头回忆和原台词已完整出现。'),
        beat('flora-final-words', '梅娅临终寄语', '保留梅娅留给芙萝拉的临终原话，不压缩成摘要。', '临终寄语已完整出现。'),
        beat('flora-await-offering', '等待玩家献花', '剧情停在墓前，要求本地提交八朵圣心百合；不得自动代交。', '本地提交动作成功扣除八朵。'),
        beat('flora-offering-reaction', '父女回应献花', '提交成功后先写芙萝拉与尼尔的反应，不在同轮自动发奖。', '献花后的情绪收束已完成。'),
        beat('flora-ending-ready', '进入 A/B 结局结算', 'A 线献花后进入待结算；后期明确拒绝同行、拒绝墓园或交花后离开则进入 B 线待结算。', '结局条件有明确玩家行为证据，任务可结算。'),
      ])]),
    ],
  },
];

const entryRecord = (index) => {
  const entry = entries[index];
  if (!entry) throw new Error(`旧版条目 ${index} 不存在。`);
  return {
    entry: index,
    comment: entry.comment ?? entry.name ?? '',
    exactText: normalizeSourceText(index, String(entry.content ?? '')),
  };
};

const rewards = {
  sourceEntry: 137,
  exactText: entryRecord(137).exactText,
  note: '奖励、成就与结算条件保留旧版原文；审阅通过后再转换成本地结算数据。',
};

const allSourceIds = [...new Set(storylines.flatMap((quest) => [
  ...quest.sourceEntries,
  ...(quest.supplementSourceEntries ?? []),
  ...(quest.mechanicsSourceEntries ?? []),
]))].sort((a, b) => a - b);

const output = {
  schemaVersion: 2,
  documentType: 'all-storylines-review-draft',
  reviewStatus: 'awaiting-user-review',
  runtimeCompatible: false,
  generatedAt: new Date().toISOString(),
  source: {
    legacyFile: path.basename(sourcePath),
    exactSourceEntries: allSourceIds,
    storyEntryCount: allSourceIds.filter((id) => id !== 122).length,
    normalizationRule: '不新增剧情事实。新增内容仅为阶段、场景、节拍拆分，及防抢跑的完成门槛。旧版全文逐条嵌入，供审阅反查。',
  },
  scopeAudit: {
    normalizedStorylines: 8,
    mainStorylines: 7,
    sideStorylines: 1,
    mergedLegacySubquests: [
      '失败的献祭',
      '闹鬼的歌剧院',
      '娜贝儿大饭店投毒案',
      '血腥爱情故事',
      '集体梦境',
      '圣教会剧情',
    ],
    excludedEntries: [
      { entries: '0-31', reason: '世界观、人物、关系阶段、变量、采集系统，不是固定主支线剧情。' },
      { entries: '32-61', reason: '任务系统、战斗、地区资料、NPC与地图背景，不是固定任务链。' },
      { entries: '62', reason: '主线世界书总控规则。' },
      { entries: '123-125', reason: '战斗、地区概览与变量规则。' },
      { entries: '131', reason: 'DLC 使用指南。' },
      { entries: '137-139', reason: '结算规则、主线系统与思维链规则；其中 137 单独作为奖励来源保留。' },
    ],
  },
  pacingPolicy: {
    fullRoadmapVisibleToMainApi: true,
    currentBeatDetail: 'full',
    futureBeatDetail: 'one-line-summary-and-locked',
    defaultBeatAdvancePerAssistantReply: 0,
    maxBeatAdvanceWhenCompletionGateSatisfied: 1,
    maxSceneAdvancePerAssistantReply: 0,
    maxStageAdvancePerAssistantReply: 0,
    neverAdvanceOnlyBecauseAssistantProducedText: true,
    playerDecisionAuthority: 'user-only',
    localStateAuthority: ['location', 'inventory', 'item submission', 'battle result', 'reward settlement'],
    detourPolicy: '玩家离开剧情场景时暂停追踪，不回退已证实节拍；完全脱离时关闭自动判定，点击继续追踪后从最近楼层检查点恢复。',
    floorBinding: '副 API 判定、任务摘要和进度检查点绑定到对应 assistant 楼层；删除楼层时删除该楼及其后的检查点并重算。',
  },
  rewards,
  storylines: storylines.map((quest) => ({
    ...quest,
    roadmap: quest.stages.flatMap((stageItem) => stageItem.scenes.flatMap((sceneItem) => sceneItem.beats.map((beatItem) => ({
      stage: stageItem.number,
      sceneId: sceneItem.id,
      beatId: beatItem.id,
      summary: beatItem.title,
      lockedUntilCurrent: true,
    })))),
    sourceArchive: [...new Set([
      ...quest.sourceEntries,
      ...(quest.supplementSourceEntries ?? []),
      ...(quest.mechanicsSourceEntries ?? []),
    ])].map(entryRecord),
  })),
};

const markdown = [];
markdown.push('# 旧版全部主线与支线：新格式审阅稿 v2');
markdown.push('');
markdown.push('> 本稿不接入运行时。它只用于审阅旧版剧情是否齐全，以及阶段—场景—节拍拆分是否合理。JSON 文件内保留了每个来源条目的完整旧版原文。');
markdown.push('');
markdown.push('## 范围结论');
markdown.push('');
markdown.push('- 规范化后共 8 条固定剧情：7 条主线、1 条支线。');
markdown.push('- 奈亚索斯旧版的四个案件与“集体梦境”被并入奈亚索斯地区主线，但各自的递进线索和真相完整保留。');
markdown.push('- 原版“圣教会支线”与后续“索拉维亚主线”是同一剧情，本稿合并为一条，不重复跑两遍；历史分类保留为 `legacyKind: side`。');
markdown.push('- 普通协会随机委托、世界观资料、NPC卡、地图介绍和任务系统规则不计入固定剧情。');
markdown.push('');
markdown.push('## 审阅时先看这三件事');
markdown.push('');
markdown.push('1. 是否同意把奈亚索斯五个旧任务规范化成一条地区主线的八个阶段。');
markdown.push('2. 是否同意把旧“圣教会支线”继续作为索拉维亚主线，而不是恢复成独立支线。');
markdown.push('3. 各节拍是否还需要继续拆细；当前规则是一轮默认不推进，证据满足时最多推进一个节拍。');
markdown.push('');

for (const quest of output.storylines) {
  markdown.push(`## ${quest.kind === 'main' ? '主线' : '支线'}：${quest.name}`);
  markdown.push('');
  markdown.push(`- ID：\`${quest.id}\``);
  markdown.push(`- 地区：${quest.region}`);
  markdown.push(`- 旧版来源：${[...quest.sourceEntries, ...(quest.supplementSourceEntries ?? [])].map((id) => `#${id}`).join('、')}`);
  markdown.push(`- 归并说明：${quest.legacyNormalization}`);
  markdown.push('');
  for (const stageItem of quest.stages) {
    markdown.push(`### 阶段 ${stageItem.number}：${stageItem.title}`);
    markdown.push('');
    for (const sceneItem of stageItem.scenes) {
      markdown.push(`场景：${sceneItem.title}（${sceneItem.locations.join(' / ')}）`);
      markdown.push('');
      markdown.push('| 节拍 | 本节拍只处理的内容 | 完成门槛 |');
      markdown.push('|---|---|---|');
      for (const beatItem of sceneItem.beats) {
        markdown.push(`| ${beatItem.title} | ${beatItem.purpose} | ${beatItem.completionGate} |`);
      }
      markdown.push('');
    }
  }
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonOutput, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
fs.writeFileSync(markdownOutput, `${markdown.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  jsonOutput,
  markdownOutput,
  storylines: output.storylines.length,
  stages: output.storylines.reduce((count, quest) => count + quest.stages.length, 0),
  scenes: output.storylines.reduce((count, quest) => count + quest.stages.reduce((sum, item) => sum + item.scenes.length, 0), 0),
  beats: output.storylines.reduce((count, quest) => count + quest.stages.reduce((sum, item) => sum + item.scenes.reduce((sceneSum, currentScene) => sceneSum + currentScene.beats.length, 0), 0), 0),
  sourceEntries: allSourceIds.length,
}, null, 2));
