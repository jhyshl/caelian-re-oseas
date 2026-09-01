export const TRELAO_AFFINITY_MAX = 1000;

export type TrelaoStageId = 'wary' | 'familiar' | 'close' | 'dependent' | 'dearest';
export type TrelaoReactionDirection = 'neutral' | 'down' | 'up';

export interface TrelaoTouchReaction {
  text: string;
  direction: TrelaoReactionDirection;
}

export function clampTrelaoAffinity(value: number): number {
  return Math.max(0, Math.min(TRELAO_AFFINITY_MAX, Math.round(value)));
}

export function trelaoStageId(affinity: number): TrelaoStageId {
  if (affinity >= 800) return 'dearest';
  if (affinity >= 600) return 'dependent';
  if (affinity >= 400) return 'close';
  if (affinity >= 200) return 'familiar';
  return 'wary';
}

export function trelaoStageLabel(affinity: number): string {
  return {
    wary: '警戒',
    familiar: '熟悉',
    close: '亲近',
    dependent: '依赖',
    dearest: '挚友',
  }[trelaoStageId(affinity)];
}

export const TRELAO_TOUCH_REACTIONS: Record<
  TrelaoStageId,
  readonly TrelaoTouchReaction[]
> = {
  wary: [
    { text: '特莱奥竖起耳鳍观察你的手，没有躲开，也没有靠近。', direction: 'neutral' },
    { text: '它用金色眼睛盯了你一会儿，谨慎地保持原位。', direction: 'neutral' },
    { text: '你的指尖碰到一片温热鳞片，特莱奥只是轻哼一声。', direction: 'neutral' },
    { text: '它把尾巴收在身侧，勉强允许这次短暂触碰。', direction: 'neutral' },
    { text: '特莱奥看向凯利安，似乎在确认你是否可信。', direction: 'neutral' },
    { text: '你摸得太突然，特莱奥猛地缩回脑袋并发出警告。', direction: 'down' },
    { text: '它不喜欢你碰尾巴，啪地拍开了你的手。', direction: 'down' },
    { text: '你放慢动作后，特莱奥试探着把额头递近了一点。', direction: 'up' },
    { text: '它闻了闻你的手心，终于允许你轻轻摸一下。', direction: 'up' },
    { text: '特莱奥没有逃开，尾尖还悄悄晃了一下。', direction: 'up' },
  ],
  familiar: [
    { text: '特莱奥认出了你，趴在原地等你先伸手。', direction: 'neutral' },
    { text: '它把翅膀稍稍收拢，给你的手留出一点位置。', direction: 'neutral' },
    { text: '你顺着鳞片摸过去，它平静地眨了眨眼。', direction: 'neutral' },
    { text: '特莱奥轻轻嗅了嗅你的袖口，像是在核对气味。', direction: 'neutral' },
    { text: '它用尾尖点了点地面，对你的手法不置可否。', direction: 'neutral' },
    { text: '你逆着鳞片乱摸，特莱奥不满地躲到凯利安身后。', direction: 'down' },
    { text: '它正想休息，你的打扰换来了一声低低的嗷呜。', direction: 'down' },
    { text: '特莱奥主动蹭过你的指节，动作很轻。', direction: 'up' },
    { text: '它舒服地眯起眼，尾巴在地面画了半个圈。', direction: 'up' },
    { text: '你摸到它喜欢的位置，它发出了满足的咕噜声。', direction: 'up' },
  ],
  close: [
    { text: '特莱奥自然地把脑袋放到你手边，等你继续。', direction: 'neutral' },
    { text: '它懒洋洋地翻了个身，金色腹鳞在光下闪了一下。', direction: 'neutral' },
    { text: '你替它理顺翅缘，它郑重地点了点头。', direction: 'neutral' },
    { text: '特莱奥靠着你的膝侧打了个小小的哈欠。', direction: 'neutral' },
    { text: '它把尾巴搭在你的鞋面上，像在宣示座位归属。', direction: 'neutral' },
    { text: '你故意挠它最怕痒的地方，它气恼地咬住你的袖口。', direction: 'down' },
    { text: '你无视它收拢翅膀的信号，它闷闷地转过身去。', direction: 'down' },
    { text: '特莱奥开心地用额头顶了顶你的掌心。', direction: 'up' },
    { text: '它绕着你转了一圈，最后安心伏在你脚边。', direction: 'up' },
    { text: '你轻抚它的耳鳍，它幸福得尾尖都翘了起来。', direction: 'up' },
  ],
  dependent: [
    { text: '特莱奥熟练地钻到你手下，显然已经习惯被照顾。', direction: 'neutral' },
    { text: '它把下巴搭在你手腕上，安静地看着远处。', direction: 'neutral' },
    { text: '你摸了摸它的额头，它回应般轻碰你的指尖。', direction: 'neutral' },
    { text: '特莱奥贴着你坐下，翅膀替你挡住一点风。', direction: 'neutral' },
    { text: '它在你身边盘成一团，发出均匀的呼吸声。', direction: 'neutral' },
    { text: '你拿它的龙角开玩笑，特莱奥委屈地背过身。', direction: 'down' },
    { text: '你在它困倦时反复打扰，它罕见地冲你发了脾气。', direction: 'down' },
    { text: '特莱奥把最喜欢被摸的额鳞主动送到你掌心。', direction: 'up' },
    { text: '它用翅尖轻轻圈住你的手，舍不得你离开。', direction: 'up' },
    { text: '你一靠近，它就满怀期待地摇起尾巴。', direction: 'up' },
  ],
  dearest: [
    { text: '特莱奥在你身边彻底放松，任由你整理每一片鳞。', direction: 'neutral' },
    { text: '它把脑袋枕在你腿上，像这本就是理所当然的位置。', direction: 'neutral' },
    { text: '你和特莱奥额头相贴，它安静地回应你的呼吸。', direction: 'neutral' },
    { text: '特莱奥张开一侧翅膀，把你也拢进温暖里。', direction: 'neutral' },
    { text: '它听着你的声音眯起眼，金色尾尖悠闲地晃动。', direction: 'neutral' },
    { text: '你假装要抢它的零食，它震惊地护住口袋并瞪了你一眼。', direction: 'down' },
    { text: '你在它认真维护龙族尊严时大笑，特莱奥气得转身不理你。', direction: 'down' },
    { text: '特莱奥亲昵地舔了舔你的指尖，把信任表达得毫无保留。', direction: 'up' },
    { text: '它绕过凯利安先跑向你，快乐得像一道金色闪光。', direction: 'up' },
    { text: '你抚过它的额鳞，特莱奥用最柔软的声音回应你。', direction: 'up' },
  ],
};

export function pickTrelaoTouchReaction(
  affinity: number,
  random: () => number,
): TrelaoTouchReaction {
  const entries = TRELAO_TOUCH_REACTIONS[trelaoStageId(affinity)];
  const index = Math.min(entries.length - 1, Math.floor(random() * entries.length));
  return entries[Math.max(0, index)]!;
}
