import type {
  AchievementDefinition,
  RelicDefinition,
} from '@/content/types';

export const POEM_MAIL_ID = 'mail_past_present_poem';
export const MEMORY_TOGETHER_ACHIEVEMENT_ID = 'ach_memory_together';
export const MEMORY_TOGETHER_CLAIM_DATE = '2026-08-19';
export const MEMORY_TOGETHER_REWARD_GOLD = 520;

export const MEMORY_TOGETHER_ACHIEVEMENT: AchievementDefinition & {
  id: string;
} = {
  id: MEMORY_TOGETHER_ACHIEVEMENT_ID,
  name: '同行的记忆',
  star: 5,
  condition: '仅限2026年8月19日领取',
  description: '并肩走过的路，会成为照亮下一程的光。',
  category: 'special',
  hidden: false,
  special: true,
  patchOnly: true,
  source: 'limited_achievement',
};

export interface MailCatalogEntry {
  id: string;
  source: 'special-achievement' | 'achievement-patch';
  title: string;
  preview: string;
  sender: string;
  body: readonly string[];
  signature?: string;
  rewardText: string;
  achievementId: string;
}

export interface AchievementPatchReward {
  gold: number;
  collectible?: {
    id: string;
    name: string;
    summary: string;
    effectText: string;
    source: string;
    relic: RelicDefinition;
  };
}

export interface AchievementPatchCatalogEntry {
  id: string;
  eventAchievementId: string;
  windowFlag: string;
  activationStorageKeys: readonly string[];
  openedStorageKeys: readonly string[];
  achievement: AchievementDefinition & { id: string };
  mail: MailCatalogEntry;
  reward: AchievementPatchReward;
  claimDate?: string;
  activateOnClaimDate?: boolean;
  presentLetterOnClaim?: boolean;
  silentMailDelivery?: boolean;
}

export interface AchievementPatchSignal {
  id: string;
  opened: boolean;
}

export const POEM_MAIL: MailCatalogEntry = {
  id: POEM_MAIL_ID,
  source: 'special-achievement',
  title: '写给今昔的感谢信',
  preview: '一封写给今昔的感谢信',
  sender: '江海有声',
  body: [
    '亲爱的{{playerName}}：',
    '在新的冒险，新的篇章，感谢你的支持，感谢我们的相遇。是你的支持与反馈让欧西亚斯一步步走到今天，变得更加美好。同样的，也是你的爱让凯利安与欧西亚斯的一切不再是数据，而成为了鲜活他与他们。',
    '向着更光明的未来出发吧，前路与冒险都愿美好与你同在，愿荣光的诗行与你共同写就。',
    '再次感谢，爱你，爱你们，爱世界。',
  ],
  signature: '江海有声',
  rewardText: '获得：金币1834，特殊藏品：空白的书页；成就：今昔的诗行',
  achievementId: 'ach_past_present_poem',
};

export const ACHIEVEMENT_PATCH_REGISTRY: Record<
  string,
  AchievementPatchCatalogEntry
> = {
  'old-player': {
    id: 'old-player',
    eventAchievementId: 'ach_thanks_old_caelian',
    windowFlag: '__CAELIAN_SPECIAL_PATCH_OLD_PLAYER__',
    activationStorageKeys: [
      'caelian_special_patch_old_player_v1',
      'caelian_special_patch_old_player_v2_letter_opened',
      'caelian_special_patch_old_player_v2_reward_granted',
    ],
    openedStorageKeys: [
      'caelian_special_patch_old_player_v2_letter_opened',
      'caelian_special_patch_old_player_v2_reward_granted',
    ],
    achievement: {
      id: 'ach_thanks_old_caelian',
      name: '感谢有你',
      star: 5,
      condition: '游玩过旧版的凯利安',
      description: '如此有幸，再次相遇',
      category: 'special',
      special: true,
      patchOnly: true,
      patchKey: 'old_caelian_player',
    },
    mail: {
      id: 'mail_thanks_old_caelian',
      source: 'achievement-patch',
      title: '给亲爱的你',
      preview: '一封写给你的信',
      sender: '江',
      body: [
        '给亲爱的你：',
        '嗨，好久不见，这段时间过得好吗？没想到吧，居然还会有再次相遇的机会，我也没有想到。这段删卡，停更的日子，是你们每一个人曾经的支持让我有了捡起来从头再来的勇气，何其有幸，得以相遇。',
        '万般思绪，落笔寥寥，最后唯有希望你玩得开心，过得幸福。',
        '我爱你。',
      ],
      signature: '——江',
      rewardText:
        '获得金币5000，藏品：重塑的羽毛笔；解锁成就：感谢有你',
      achievementId: 'ach_thanks_old_caelian',
    },
    reward: {
      gold: 5000,
      collectible: {
        id: 'special_reshaped_quill',
        name: '重塑的羽毛笔',
        summary: '浩瀚银河，爱赋长歌，感谢遇见',
        effectText:
          '进入战斗时若敌方单位≥2，则立刻秒杀生命值最高的单位，如果有多个单位生命值都为最高，则秒杀一个；面对首领怪物改为对首领造成生命上限30%的伤害',
        source: '特殊补丁',
        relic: {
          name: '重塑的羽毛笔',
          description:
            '进入战斗时若敌方单位≥2，则立刻秒杀生命值最高的单位，如果有多个单位生命值都为最高，则秒杀一个；面对首领怪物改为对首领造成生命上限30%的伤害',
          effect: { type: 'special_reshaped_quill' },
          unique: true,
          levelReward: false,
          source: 'special_patch',
          patchOnly: true,
          rarity: 'legendary',
        },
      },
    },
  },
  'repo-reward': {
    id: 'repo-reward',
    eventAchievementId: 'ach_repo_reward',
    windowFlag: '__CAELIAN_SPECIAL_PATCH_REPO_REWARD__',
    activationStorageKeys: [
      'caelian_special_patch_repo_reward_v1',
      'caelian_special_patch_repo_reward_v2_letter_opened',
      'caelian_special_patch_repo_reward_v2_reward_granted',
    ],
    openedStorageKeys: [
      'caelian_special_patch_repo_reward_v2_letter_opened',
      'caelian_special_patch_repo_reward_v2_reward_granted',
    ],
    achievement: {
      id: 'ach_repo_reward',
      name: '好饭，当赏！',
      star: 5,
      condition: '在原帖中给楼主投喂了repo',
      description: '妈妈，饭饭，好吃😋',
      category: 'special',
      special: true,
      patchOnly: true,
      patchKey: 'repo_feed_reward',
    },
    mail: {
      id: 'mail_repo_reward',
      source: 'achievement-patch',
      title: '好饭，当赏！',
      preview: '一封香喷喷的感谢信',
      sender: '江',
      body: ['好好吃的饭，美味美味，感谢你！😋😋😋'],
      rewardText:
        '获得金币2000，藏品：金铲子；解锁成就：好饭，当赏',
      achievementId: 'ach_repo_reward',
    },
    reward: {
      gold: 2000,
      collectible: {
        id: 'special_golden_shovel',
        name: '金铲子',
        summary: '如此美味的饭我还能再吃一碗',
        effectText:
          '进入非首领战斗时有10%的基础概率直接判定为胜利；连续9场符合条件的战斗未触发时，第10场必定触发',
        source: '特殊补丁',
        relic: {
          name: '金铲子',
          description:
            '进入非首领战斗时有10%的基础概率直接判定为胜利；连续9场符合条件的战斗未触发时，第10场必定触发',
          effect: { type: 'special_golden_shovel', chance: 0.1, pity: 10 },
          unique: true,
          levelReward: false,
          source: 'special_patch',
          patchOnly: true,
          rarity: 'legendary',
        },
      },
    },
  },
  'old-timer': {
    id: 'old-timer',
    eventAchievementId: 'ach_launch_old_timer',
    windowFlag: '__CAELIAN_LAUNCH_REWARD_OLD_TIMER__',
    activationStorageKeys: [
      'caelian_launch_reward_old_timer_v1',
      'caelian_launch_reward_old_timer_v1_letter_opened',
      'caelian_launch_reward_old_timer_v1_reward_granted',
    ],
    openedStorageKeys: [
      'caelian_launch_reward_old_timer_v1_letter_opened',
      'caelian_launch_reward_old_timer_v1_reward_granted',
    ],
    achievement: {
      id: 'ach_launch_old_timer',
      name: '老资历',
      star: 5,
      condition: '只能通过该邮件获得，如果超时无法领取或显示',
      description: '开服玩家的象征',
      category: 'special',
      hidden: false,
      special: true,
      patchOnly: true,
      source: 'launch_patch',
    },
    mail: {
      id: 'mail_launch_old_timer',
      source: 'achievement-patch',
      title: '欢迎来到欧西亚斯',
      preview: '一封来自欧西亚斯的开服信件',
      sender: '欧西亚斯',
      body: [
        '欢迎来到欧西亚斯，感谢您的选择与支持，更感谢你愿意来容忍我的屎山代码',
      ],
      rewardText: '获得500金币，藏品：银叉子；获得成就：老资历',
      achievementId: 'ach_launch_old_timer',
    },
    reward: {
      gold: 500,
      collectible: {
        id: 'special_silver_fork',
        name: '银叉子',
        summary: '吃到热乎的了',
        effectText:
          '购买特产时有20%的概率获得半价优惠（未装备也有效）；连续9次未触发时，第10次保底触发。',
        source: '开服补丁',
        relic: {
          name: '银叉子',
          description:
            '购买特产时有20%的概率获得半价优惠（未装备也有效）；连续9次未触发时，第10次保底触发。',
          effect: {
            type: 'special_silver_fork_discount',
            chance: 0.2,
            unequipped: true,
            pity: 10,
          },
          unique: true,
          levelReward: false,
          source: 'launch_patch',
          patchOnly: true,
          rarity: 'legendary',
        },
      },
    },
  },
  'memory-together': {
    id: 'memory-together',
    eventAchievementId: MEMORY_TOGETHER_ACHIEVEMENT_ID,
    windowFlag: '__CaelianMemoryTogetherPatch',
    activationStorageKeys: [
      'caelian-memory-together-v1:claimed:alpha',
      'caelian-memory-together-v1:claimed:beta',
    ],
    openedStorageKeys: [
      'caelian-memory-together-v1:claimed:alpha',
      'caelian-memory-together-v1:claimed:beta',
    ],
    claimDate: MEMORY_TOGETHER_CLAIM_DATE,
    activateOnClaimDate: true,
    presentLetterOnClaim: true,
    silentMailDelivery: true,
    achievement: MEMORY_TOGETHER_ACHIEVEMENT,
    mail: {
      id: 'mail_memory_together',
      source: 'achievement-patch',
      title: '同行的记忆',
      preview: '一封来自凯利安的信',
      sender: '凯利安',
      body: [
        '给{{playerName}}：',
        '我原本不认为，一段真正的同行需要靠什么凭证来证明。毕竟，维莱恩家的人从不把承诺寄托在一张纸上。',
        '不过，既然你已经陪我走到了这里，这份纪念就收下吧。别误会，这不是客套。能被我认可、站在我身边的人本就不多，而你已经在其中。',
        '往后的路还很长，别擅自掉队。',
      ],
      signature: 'caelian',
      rewardText: '获得金币520；解锁成就：同行的记忆',
      achievementId: MEMORY_TOGETHER_ACHIEVEMENT_ID,
    },
    reward: { gold: MEMORY_TOGETHER_REWARD_GOLD },
  },
};

export const ACHIEVEMENT_PATCHES = Object.values(
  ACHIEVEMENT_PATCH_REGISTRY,
);

export const PATCH_ACHIEVEMENT_DEFINITIONS = Object.fromEntries(
  ACHIEVEMENT_PATCHES.map((patch) => [
    patch.achievement.id,
    patch.achievement,
  ]),
) as Record<string, AchievementDefinition>;

export const PATCH_RELIC_DEFINITIONS = Object.fromEntries(
  ACHIEVEMENT_PATCHES.flatMap((patch) =>
    patch.reward.collectible
      ? [
          [
            patch.reward.collectible.id,
            patch.reward.collectible.relic,
          ] as const,
        ]
      : [],
  ),
) as Record<string, RelicDefinition>;

export const MAIL_CATALOG = Object.fromEntries([
  [POEM_MAIL.id, POEM_MAIL],
  ...ACHIEVEMENT_PATCHES.map((patch) => [patch.mail.id, patch.mail] as const),
]) as Record<string, MailCatalogEntry>;

export function patchByMailId(
  mailId: string,
): AchievementPatchCatalogEntry | undefined {
  return ACHIEVEMENT_PATCHES.find((patch) => patch.mail.id === mailId);
}
