import { AFFINITY_MAX } from '@/mvu/contracts';
import {
  COOKING_DISHES,
  COOKING_MATERIALS,
  COOKING_RECIPES,
} from '@/content/cooking';

export type InteractionItemTag =
  | 'specialty'
  | 'meat'
  | 'dessert'
  | 'vegetable'
  | 'weird_or_dirty'
  | 'consumable';

export const GIFT_SPECIALTY_ITEMS = new Set([
  '小麦啤酒',
  '精制面包',
  '学生便当',
  '学院薄荷',
  '帕德里湖水珠',
  '海鲜烩饭',
  '风味海胆卷',
  '椰子酒',
  '海盐珍珠草',
  '蓝珊瑚碎',
  '月露草',
  '古树新芽',
  '藤蔓纤维',
  '煤晶粉',
  '蒸汽冷凝水',
  '银月草',
  '血蔷薇花瓣',
  '夜光菇',
  '仿制血浆',
  '机油饮',
  '蒸汽啤酒',
  '皇宫茶叶',
  '贵族香料',
  '圣烛',
  '圣心玻璃珠',
  '圣心别针',
  '潮汐通票',
  '月织线轴',
  '炉心活塞',
  '幽晶石',
  '龙族旧金币',
]);

export const TRELAO_LIKED_ITEMS = new Set([
  '精制面包',
  '学生便当',
  '小麦啤酒',
  '海鲜烩饭',
  '风味海胆卷',
  '椰子酒',
  '灵感糖丸',
  '烤鸡',
  '肉干',
  '火腿',
  '烤肉',
  '蜂蜜饼干',
  '奶油蛋糕',
  '甜浆果',
  '蜜糖坚果',
]);

export const TRELAO_DISLIKED_ITEMS = new Set([
  '西蓝花',
  '曼德拉草根须',
  '城郊药草',
  '治愈苔',
  '幽灯草',
  '圣心百合',
  '魔法粉尘',
  '玛利亚教堂圣灰',
  '仿制血浆',
  '机油饮',
  '蒸汽啤酒',
  '黑潮残片',
  '腐烂的肉块',
  '肮脏的鼠尾',
  '哥布林的烂牙',
  '碎骨片',
  '旧墓碎银',
  '解毒药水',
  '小型生命药水',
  '中型生命药水',
  '小血瓶',
  '中血瓶',
  '大血瓶',
  '小魔药瓶',
  '中魔药瓶',
  '大魔药瓶',
]);

export const TRELAO_LIKE_FEEDBACK = [
  '特莱奥一口叼走了「{item}」，尾巴在身后晃成了金色残影。',
  '特莱奥发出满足的“嗷呜”，看起来已经把你列入可靠饭票名单。',
  '它把「{item}」护在爪子下面，连凯利安都没来得及阻止。',
  '特莱奥吃得眼睛都亮了，伟大的圣龙显然认可了这份供奉。',
  '它满意地蹭了蹭你的手心，凯利安在旁边轻咳了一声。',
  '特莱奥把最后一点碎屑都舔干净，表情郑重得像在参加授勋仪式。',
  '它开心得原地转了一圈，差点把旁边的椅子撞翻。',
  '特莱奥咕噜咕噜地发出很得意的声音，仿佛这是它应得的贡品。',
  '它把「{item}」吃完后还盯着你的背包，显然在期待下一份。',
  '特莱奥幸福地眯起眼，但很显然凯利安要不开心了。',
] as const;

export const TRELAO_DISLIKE_FEEDBACK = [
  '特莱奥咬了一口就僵住了，眼神里写满了对龙生的怀疑。',
  '它把「{item}」推远了一点，像是在确认你是不是故意的。',
  '特莱奥发出悲愤的嗷呜声，凯利安看起来倒是有点想笑。',
  '它勉强咽下去，随后非常夸张地趴在地上装死。',
  '特莱奥不喜欢吃这个，他被你喂吐了。',
  '它用爪子捂住嘴，金色尾巴都委屈地垂下来了。',
  '特莱奥盯着你看了很久，仿佛要把这次投喂记录进仇恨小本本。',
  '它把「{item}」叼起来又放下，最后决定离你的手远一点。',
  '特莱奥发出了非常小声但非常真实的呜咽，凯利安已经开始禁止你靠近龙粮。',
  '它吃完后安静了三秒，然后开始疯狂找水。',
] as const;

export const TRELAO_MILD_DISLIKE_FEEDBACK = TRELAO_DISLIKE_FEEDBACK.filter(
  (entry) => !entry.includes('喂吐了'),
);

export const TRELAO_PET_FEEDBACK = [
  '特莱奥把脑袋主动凑近了一点，似乎很满意这次抚摸。',
  '你顺着特莱奥额前的鳞片摸过去，它舒服得眯起了眼。',
  '特莱奥尾巴轻轻晃了晃，勉强承认你的手法还不错。',
  '它发出低低的咕噜声，像一颗正在晒太阳的金色球。',
  '特莱奥蹭了蹭你的掌心，凯利安看起来想提醒它注意龙族尊严。',
] as const;

export const TRELAO_PET_REJECT_FEEDBACK = [
  '特莱奥迅速把尾巴收了回去，用眼神警告你：别摸尾巴。',
  '它偏过头躲开了你的手，显然今天不太想配合。',
  '特莱奥哼了一声，决定把伟大的圣龙脑袋挪到你摸不到的地方。',
] as const;

export interface TrelaoFeedMeta {
  allowed: boolean;
  result: 'like' | 'dislike';
  tags: InteractionItemTag[];
  category: 'specialty' | 'consumable' | 'feedable';
  source: string;
}

export function interactionItemTags(
  name: string,
  isConsumable = false,
): InteractionItemTag[] {
  const tags: InteractionItemTag[] = [];
  if (GIFT_SPECIALTY_ITEMS.has(name)) tags.push('specialty');
  if (/肉|鸡|火腿|烤|鱼|海胆|海鲜|狼皮|毛皮/.test(name)) {
    tags.push('meat');
  }
  if (/糖|甜|蛋糕|蜂蜜|饼干|浆果|灵感糖丸/.test(name)) {
    tags.push('dessert');
  }
  if (
    /西蓝花|草|苔|百合|薄荷|树脂|新芽|纤维|花|藤蔓|药草/.test(
      name,
    )
  ) {
    tags.push('vegetable');
  }
  if (
    /肮脏|腐烂|烂牙|碎骨|鼠尾|黑市|旧墓|血浆|机油|残片|毒|尸|哥布林|粘液|灰|粉尘/.test(
      name,
    )
  ) {
    tags.push('weird_or_dirty');
  }
  if (isConsumable) tags.push('consumable');
  return [...new Set(tags)];
}

export function giftAffinityDelta(tags: readonly string[]): number {
  return tags.includes('weird_or_dirty') ? -0.5 : 0.5;
}

export function trelaoFeedMeta(
  name: string,
  isConsumable = false,
): TrelaoFeedMeta {
  const material = COOKING_MATERIALS[name];
  if (material) {
    const tags = interactionItemTags(name, false);
    return {
      allowed: true,
      result: 'like',
      tags,
      category: 'feedable',
      source: '料理材料',
    };
  }
  const dish = COOKING_DISHES[name];
  if (dish) {
    const ingredients = Object.keys(
      COOKING_RECIPES.find((entry) => entry.output === name)?.inputs ?? {},
    );
    const tags = interactionItemTags(name, false);
    if (ingredients.some((item) => /鸡肉|野猪肉|鱼肉|火腿/.test(item))) {
      tags.push('meat');
    }
    if (ingredients.some((item) => /糖|奶油|黄油|牛奶/.test(item))) {
      tags.push('dessert');
    }
    if (dish.containsPlant) tags.push('vegetable');
    return {
      allowed: true,
      result: dish.containsPlant ? 'dislike' : 'like',
      tags: [...new Set(tags)],
      category: 'feedable',
      source: '成品料理',
    };
  }
  const tags = interactionItemTags(name, isConsumable);
  const isSpecialty = tags.includes('specialty');
  const foodLike =
    TRELAO_LIKED_ITEMS.has(name) ||
    tags.includes('meat') ||
    tags.includes('dessert');
  const foodDislike =
    TRELAO_DISLIKED_ITEMS.has(name) ||
    tags.includes('vegetable') ||
    tags.includes('weird_or_dirty') ||
    /药水|药瓶|秘药|药剂|卷轴|粉尘|灰/.test(name);
  let result: TrelaoFeedMeta['result'] = 'dislike';
  if (foodLike && !TRELAO_DISLIKED_ITEMS.has(name)) result = 'like';
  if (foodDislike) result = 'dislike';
  const allowed =
    TRELAO_LIKED_ITEMS.has(name) ||
    TRELAO_DISLIKED_ITEMS.has(name) ||
    isConsumable ||
    isSpecialty ||
    /肉|鸡|火腿|鱼|海胆|面包|便当|糖|蛋糕|甜|蜂蜜|饼干|酒|血浆|机油|西蓝花|草|苔|百合|薄荷/.test(
      name,
    );
  return {
    allowed,
    result,
    tags,
    category: isSpecialty
      ? 'specialty'
      : isConsumable
        ? 'consumable'
        : 'feedable',
    source: isConsumable
      ? '消耗品'
      : isSpecialty
        ? '地区特产/集市物品'
        : '可投喂物品',
  };
}

export function clampInteractionAffinity(value: number): number {
  const clamped = Math.max(0, Math.min(AFFINITY_MAX, value));
  return Math.round(clamped * 2) / 2;
}

export function pickInteractionFeedback<T>(
  entries: readonly T[],
  roll: number,
): T {
  const index = Math.min(
    entries.length - 1,
    Math.max(0, Math.floor(roll * entries.length)),
  );
  return entries[index]!;
}

// 仅供后续动态立绘接入；当前前端不会读取或渲染这份动作表。
export const PHYSICAL_INTERACTIONS_FRONTEND_ENABLED = false;

export const PHYSICAL_INTERACTION_ACTIONS = [
  { id: 'handshake', label: '握手', minAffinity: 0 },
  { id: 'high_five', label: '击掌 / 碰拳', minAffinity: 101 },
  { id: 'pat_shoulder', label: '拍拍肩膀', minAffinity: 101 },
  { id: 'support_arm', label: '短暂扶住手臂', minAffinity: 101 },
  { id: 'tug_sleeve', label: '轻拉衣袖', minAffinity: 101 },
  { id: 'touch_hand_back', label: '碰触手背', minAffinity: 251 },
  { id: 'hold_hands', label: '牵手', minAffinity: 251 },
  { id: 'link_arms', label: '挽手', minAffinity: 251 },
  { id: 'lean_shoulder', label: '靠肩', minAffinity: 251 },
  { id: 'fix_collar_hair', label: '整理衣领 / 头发', minAffinity: 251 },
  { id: 'brief_hug', label: '短暂拥抱', minAffinity: 251 },
  { id: 'interlock_fingers', label: '十指相扣', minAffinity: 401 },
  { id: 'arm_around_waist', label: '揽腰', minAffinity: 401 },
  { id: 'touch_cheek', label: '抚摸脸颊', minAffinity: 401 },
  { id: 'forehead_touch', label: '额头相抵', minAffinity: 401 },
  { id: 'long_hug', label: '长时间拥抱', minAffinity: 401 },
  { id: 'back_hug', label: '从背后拥抱', minAffinity: 401 },
  { id: 'forehead_kiss', label: '亲吻额头', minAffinity: 401 },
  { id: 'cheek_kiss', label: '亲吻脸颊', minAffinity: 401 },
  { id: 'waist_cuddle', label: '贴身环腰拥抱', minAffinity: 500 },
  { id: 'pull_into_arms', label: '拉进怀里', minAffinity: 500 },
  { id: 'soothe_hair', label: '安抚式抚摸头发', minAffinity: 500 },
  { id: 'lip_corner_kiss', label: '亲吻唇角', minAffinity: 500 },
  { id: 'lip_kiss', label: '接吻', minAffinity: 500 },
  { id: 'lift', label: '抱起 / 被抱起', minAffinity: 500 },
] as const;

export const PHYSICAL_REACTION_STAGES = [
  {
    minimum: 0,
    maximum: 100,
    tone: '保持礼貌与距离；只接受正式握手，越界动作会明确避开。',
  },
  {
    minimum: 101,
    maximum: 250,
    tone: '接受伙伴式的短暂接触，反应克制，不允许明显亲密动作。',
  },
  {
    minimum: 251,
    maximum: 400,
    tone: '会害羞或嘴硬，但愿意接受牵手、靠肩与短暂拥抱。',
  },
  {
    minimum: 401,
    maximum: 499,
    tone: '主动回应亲密接触，也会用动作表达占有欲与保护欲。',
  },
  {
    minimum: 500,
    maximum: 500,
    tone: '完全信任并自然回应最亲密的动作。',
  },
] as const;

export function availablePhysicalInteractionIds(
  affinity: number,
): Array<(typeof PHYSICAL_INTERACTION_ACTIONS)[number]['id']> {
  return PHYSICAL_INTERACTION_ACTIONS.filter(
    (action) => affinity >= action.minAffinity,
  ).map((action) => action.id);
}
