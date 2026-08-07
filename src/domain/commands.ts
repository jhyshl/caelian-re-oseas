import { z } from 'zod';

const commandBase = {
  id: z.string().min(1).max(160),
};

const achievementEventSchema = z.object({
  event: z.enum([
    'special.old-player',
    'special.repo-reward',
    'quest.complete',
    'caelian.gift',
    'caelian.invite',
    'trelao.pet',
    'trelao.feed',
    'battle.consumable-heal',
    'battle.astrology-draw',
    'battle.merchant-bribe-victory',
    'gold.gain',
    'gold.sell',
    'craft.item',
    'craft.equipment',
    'workshop.class',
    'workshop.card',
    'collectible.special',
  ]),
  amount: z.number().min(0).max(1_000_000_000).optional(),
  count: z.number().int().min(0).max(1_000_000).optional(),
  success: z.boolean().optional(),
  liked: z.boolean().optional(),
  positive: z.boolean().optional(),
  reaction: z.string().trim().max(80).optional(),
  favor: z.number().min(-100).max(100).optional(),
  category: z.string().trim().max(80).optional(),
  region: z.string().trim().max(160).optional(),
  questId: z.string().trim().max(180).optional(),
  ending: z.string().trim().max(40).optional(),
  cardName: z.string().trim().max(180).optional(),
  cardType: z.string().trim().max(80).optional(),
  weaponMaster: z.boolean().optional(),
  star: z.number().int().min(1).max(5).optional(),
  ids: z.array(z.string().trim().min(1).max(180)).max(100).optional(),
});

export const domainCommandSchema = z.discriminatedUnion('type', [
  z.object({
    ...commandBase,
    type: z.literal('player.create'),
    payload: z.object({
      name: z.string().trim().min(1).max(80),
      classMain: z.string().trim().min(1).max(80),
      subclass: z.string().trim().min(1).max(80),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('player.update'),
    payload: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        level: z.number().int().min(1).max(999).optional(),
        experience: z.number().int().min(0).optional(),
        gold: z.number().int().min(0).optional(),
      })
      .refine((value) => Object.keys(value).length > 0, {
        message: '至少需要修改一个玩家字段',
      }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('player.reclass'),
    payload: z.object({
      classMain: z.string().trim().min(1).max(80),
      subclass: z.string().trim().min(1).max(80),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('player.allocate-stat'),
    payload: z.object({
      stat: z.enum([
        'hpMax',
        'mpMax',
        'attack',
        'defense',
        'speed',
        'actionPointsPerTurn',
      ]),
      direction: z.enum(['add', 'remove']),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('world.move'),
    payload: z.object({
      region: z.string().trim().min(1).max(120),
      place: z.string().trim().max(120).default(''),
      location: z.string().trim().min(1).max(180),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('narrative.update'),
    payload: z
      .object({
        companion: z
          .object({
            affinity: z.number().int().min(0).max(100).optional(),
            mood: z.string().trim().min(1).max(80).optional(),
            location: z.string().trim().min(1).max(120).optional(),
            clothing: z.string().trim().min(1).max(240).optional(),
            innerThought: z.string().trim().max(500).optional(),
          })
          .refine((value) => Object.keys(value).length > 0, {
            message: '至少需要修改一个凯利安叙事字段',
          })
          .optional(),
        world: z
          .object({
            region: z.string().trim().min(1).max(120).optional(),
            place: z.string().trim().max(120).optional(),
            location: z.string().trim().min(1).max(180).optional(),
            gameDate: z.string().trim().min(1).max(80).optional(),
            gameTime: z.string().trim().min(1).max(40).optional(),
            weather: z.string().trim().min(1).max(80).optional(),
          })
          .refine((value) => Object.keys(value).length > 0, {
            message: '至少需要修改一个世界叙事字段',
          })
          .optional(),
        storyFlags: z
          .record(
            z.string().trim().min(1).max(80),
            z.boolean(),
          )
          .refine((value) => Object.keys(value).length <= 64, {
            message: '单次最多更新 64 个剧情标记',
          })
          .optional(),
      })
      .refine(
        (value) =>
          Boolean(value.companion || value.world || value.storyFlags),
        { message: '至少需要一个叙事更新' },
      ),
  }),
  z.object({
    ...commandBase,
    type: z.literal('quest.accept'),
    payload: z.object({
      taskId: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(160),
      region: z.string().trim().min(1).max(120),
      objective: z.string().trim().min(1).max(500),
      totalStages: z.number().int().min(1).max(9999),
      rewardExperience: z.number().int().min(0),
      rewardGold: z.number().int().min(0),
      rewardGuildExperience: z.number().int().min(0),
      minimumLevel: z.number().int().min(1).max(999),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('quest.abandon'),
    payload: z.object({
      questId: z.string().trim().min(1).max(220),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('inventory.adjust'),
    payload: z.object({
      itemId: z.string().trim().min(1).max(120),
      name: z.string().trim().min(1).max(120).optional(),
      delta: z
        .number()
        .int()
        .min(-999999)
        .max(999999)
        .refine((value) => value !== 0),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('deck.update'),
    payload: z.object({
      cardIds: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('equipment.equip'),
    payload: z.object({
      instanceId: z.string().trim().min(1).max(180),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('equipment.unequip'),
    payload: z.object({
      slot: z.enum(['weapon', 'armor', 'accessory']),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('relic.set-carried'),
    payload: z.object({
      relicId: z.string().trim().min(1).max(180),
      carried: z.boolean(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('achievement.record'),
    payload: achievementEventSchema,
  }),
  z.object({
    ...commandBase,
    type: z.literal('achievement.claim-poem-letter'),
    payload: z.object({}),
  }),
  z.object({
    ...commandBase,
    type: z.literal('achievement.claim-daily-gift'),
    payload: z.object({}),
  }),
  z.object({
    ...commandBase,
    type: z.literal('mail.open'),
    payload: z.object({
      mailId: z.string().trim().min(1).max(160),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('market.buy'),
    payload: z.object({
      listingKey: z.string().trim().min(1).max(260),
      quantity: z.number().int().min(1).max(99999).default(1),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('market.sell-item'),
    payload: z.object({
      itemId: z.string().trim().min(1).max(180),
      quantity: z.number().int().min(1).max(99999).default(1),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('market.sell-equipment'),
    payload: z.object({
      instanceId: z.string().trim().min(1).max(240),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('battle.start'),
    payload: z.object({
      monsterId: z.string().trim().min(1).max(160),
      count: z.number().int().min(1).max(12).optional(),
      source: z.string().trim().min(1).max(180).optional(),
      relatedQuestId: z.string().trim().max(220).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('battle.explore'),
    payload: z.object({
      relatedQuestId: z.string().trim().max(220).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('battle.play-card'),
    payload: z.object({
      battleId: z.string().trim().min(1).max(220),
      handIndex: z.number().int().min(0).max(99),
      targetIndex: z.number().int().min(0).max(20).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('battle.end-turn'),
    payload: z.object({
      battleId: z.string().trim().min(1).max(220),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('battle.discard-hand'),
    payload: z.object({
      battleId: z.string().trim().min(1).max(220),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('battle.surrender'),
    payload: z.object({
      battleId: z.string().trim().min(1).max(220),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('battle.finish'),
    payload: z.object({
      battleId: z.string().trim().min(1).max(220),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('settings.update'),
    payload: z
      .object({
        preserveAdventureSave: z.boolean().optional(),
        battleDifficulty: z
          .enum(['easy', 'normal', 'hard', 'hell'])
          .optional(),
      })
      .refine((value) => Object.keys(value).length > 0, {
        message: '至少需要修改一个设置字段',
      }),
  }),
]);

export type DomainCommand = z.infer<typeof domainCommandSchema>;

export interface CommandResult {
  id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  message?: string;
}
