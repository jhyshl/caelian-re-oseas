import type { AchievementDefinition, RelicDefinition } from '@/content/types';

export const GLOBAL_ACHIEVEMENT_PROFILE_ID = '__caelian_global__';

export const PAST_PRESENT_POEM_ID = 'ach_past_present_poem';
export const BLANK_PAGE_RELIC_ID = 'special_blank_page';

export const PAST_PRESENT_POEM_DEFINITION: AchievementDefinition = {
  id: PAST_PRESENT_POEM_ID,
  name: '今昔的诗行',
  star: 5,
  condition: '开启一封写给今昔的感谢信',
  description: '这场冒险是由爱写就十四行诗',
  category: 'special',
  source: 'special_patch',
};

export const BLANK_PAGE_RELIC_DEFINITION: RelicDefinition = {
  name: '空白的书页',
  description:
    '未来的冒险还在等你来写就。拥有后每日可以获得随机赠礼，未携带也会生效。',
  effect: {
    type: 'special_blank_page_daily_gift',
    passive: true,
    equippedRequired: false,
  },
  unique: true,
  levelReward: false,
  source: 'special_patch',
  rarity: 'legendary',
};

export const POEM_REWARD_GOLD = 1834;

export const DAILY_GIFT_POOL = [
  '苹果',
  '白面包',
  '蜂蜜',
  '牛奶',
  '奶酪',
  '鸡蛋',
  '熏肉',
  '鱼干',
  '蘑菇',
  '薄荷叶',
  '月露草',
  '星砂',
  '铁矿石',
  '银矿石',
  '铜矿石',
  '清水',
  '盐',
  '糖',
  '绷带',
  '小型治疗药剂',
  '魔力药剂',
  '火绒草',
  '风铃花',
  '圣心百合',
  '海盐贝',
  '香料包',
  '羊皮纸',
  '墨水',
  '玻璃瓶',
  '软木塞',
] as const;

export const ACHIEVEMENT_CATEGORIES = [
  'all',
  'story',
  'battle',
  'quest',
  'caelian',
  'trelao',
  'travel',
  'economy',
  'career',
  'collection',
  'craft',
  'workshop',
  'special',
] as const;

export type AchievementCategory =
  (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_CATEGORY_LABELS: Record<
  AchievementCategory,
  string
> = {
  all: '全部',
  story: '剧情',
  battle: '战斗',
  quest: '任务',
  caelian: '凯利安',
  trelao: '特莱奥',
  travel: '探索',
  economy: '财富',
  career: '职业',
  collection: '收藏',
  craft: '合成',
  workshop: '工坊',
  special: '特殊',
};

const QUEST_IDS = new Set([
  'ach_first_task_complete',
  'ach_flora_flower_language',
  'ach_flora_waiting_bloom',
]);

const STORY_IDS = new Set([
  'ach_re_oseas',
  'ach_first_meet_caelian',
  'ach_main_academy_anniversary',
  'ach_main_holy_church_love',
  'ach_main_niyasos_lament',
  'ach_main_atlantis_kukulkan',
  'ach_main_ethera_lush',
  'ach_main_hearth_clang',
]);

const BATTLE_IDS = new Set([
  'ach_battle_victory',
  'ach_battle_escape',
  'ach_battle_defeat',
  'ach_fast_victory_under_3_turns',
  'ach_full_hand_end_turn',
  'ach_first_summon_card',
  'ach_consumable_heal_hp',
  'ach_astrology_draw_5',
  'ach_turn_play_5',
  'ach_weapon_master_same_5',
  'ach_battle_full_hp_win',
  'ach_merchant_bribe_win',
]);

const COLLECTION_IDS = new Set([
  'ach_relic_10',
  'ach_special_collectible_5',
  'ach_equip_special_relic',
  'ach_equip_all_3star',
]);

const CRAFT_IDS = new Set([
  'ach_craft_3star_equipment',
  'ach_craft_item_once',
  'ach_craft_item_100',
]);

export function achievementCategory(id: string): AchievementCategory {
  if (
    id === PAST_PRESENT_POEM_ID ||
    id === 'ach_thanks_old_caelian' ||
    id === 'ach_repo_reward' ||
    id.startsWith('ach_calendar_')
  ) {
    return 'special';
  }
  if (STORY_IDS.has(id)) return 'story';
  if (QUEST_IDS.has(id)) return 'quest';
  if (BATTLE_IDS.has(id)) return 'battle';
  if (id.startsWith('ach_caelian_')) return 'caelian';
  if (id.startsWith('ach_trelao_')) return 'trelao';
  if (id.startsWith('ach_travel_')) return 'travel';
  if (id.startsWith('ach_gold_') || id.startsWith('ach_sell_gold_')) {
    return 'economy';
  }
  if (id.startsWith('ach_reclass_')) return 'career';
  if (COLLECTION_IDS.has(id)) return 'collection';
  if (CRAFT_IDS.has(id)) return 'craft';
  if (id.startsWith('ach_workshop_')) return 'workshop';
  return 'story';
}

const TARGETS: Record<string, number> = {
  ach_caelian_affection_100: 100,
  ach_caelian_gift_first: 1,
  ach_caelian_gift_10: 10,
  ach_caelian_gift_50: 50,
  ach_caelian_invite_first: 1,
  ach_caelian_invite_10: 10,
  ach_caelian_invite_50: 50,
  ach_caelian_gift_favor_5: 5,
  ach_trelao_pet_first: 1,
  ach_trelao_pet_10: 10,
  ach_trelao_pet_100: 100,
  ach_trelao_pet_streak_5: 5,
  ach_trelao_feed_like_first: 1,
  ach_trelao_feed_like_10: 10,
  ach_trelao_feed_like_100: 100,
  ach_trelao_feed_like_streak_5: 5,
  ach_trelao_feed_like_daily_5: 5,
  ach_trelao_feed_dislike_first: 1,
  ach_trelao_feed_dislike_10: 10,
  ach_trelao_feed_dislike_20: 20,
  ach_trelao_feed_dislike_100: 100,
  ach_trelao_feed_dislike_streak_5: 5,
  ach_trelao_feed_dislike_daily_5: 5,
  ach_travel_first_new_region: 1,
  ach_travel_oseas_5_regions: 5,
  ach_travel_oseas_10_regions: 10,
  ach_gold_5000: 5000,
  ach_gold_20000: 20000,
  ach_gold_1000000: 1_000_000,
  ach_reclass_once: 1,
  ach_reclass_5: 5,
  ach_astrology_draw_5: 5,
  ach_turn_play_5: 5,
  ach_weapon_master_same_5: 5,
  ach_calendar_month: 30,
  ach_calendar_year: 365,
  ach_relic_10: 10,
  ach_special_collectible_5: 5,
  ach_sell_gold_10000: 10_000,
  ach_craft_item_once: 1,
  ach_craft_item_100: 100,
};

export function achievementTarget(id: string): number {
  return TARGETS[id] ?? 1;
}

export const MAIN_QUEST_ACHIEVEMENTS: Record<string, string> = {
  main_academy_anniversary_preparation: 'ach_main_academy_anniversary',
  main_solavia_sacred_underground: 'ach_main_holy_church_love',
  main_niyasos_failed_sacrifice: 'ach_main_niyasos_lament',
  main_abyss_atlantis_echo: 'ach_main_atlantis_kukulkan',
  main_ethera_ashen_ancient_tree: 'ach_main_ethera_lush',
  main_hearth_embers: 'ach_main_hearth_clang',
};

export const TRAVEL_ACHIEVEMENT_PATTERNS: Array<{
  id: string;
  pattern: RegExp;
}> = [
  { id: 'ach_travel_ilaya_city', pattern: /伊拉亚/ },
  { id: 'ach_travel_solavia', pattern: /索拉维亚|索拉姆/ },
  { id: 'ach_travel_church_bell', pattern: /玛利亚教堂|圣心大教堂|圣教会/ },
  { id: 'ach_travel_niyasos', pattern: /奈亚索斯/ },
  { id: 'ach_travel_dream_hotel', pattern: /声声不息大酒店/ },
  { id: 'ach_travel_abyss_sea', pattern: /阿必塞海/ },
  { id: 'ach_travel_atlantis', pattern: /亚特兰蒂斯/ },
  { id: 'ach_travel_ethera', pattern: /艾瑟拉森林/ },
  { id: 'ach_travel_burnt_woods', pattern: /焦木林/ },
  { id: 'ach_travel_hearth', pattern: /炉心城/ },
  { id: 'ach_travel_mine', pattern: /岩采矿洞|矿洞/ },
  { id: 'ach_travel_silvermoon', pattern: /银月之城/ },
  { id: 'ach_travel_vampire_banquet', pattern: /维兰瑟庄园/ },
  { id: 'ach_travel_abyss_reaches', pattern: /渊底之地/ },
  { id: 'ach_travel_demon_city', pattern: /魔王城|七城/ },
];
