import {
  BLANK_PAGE_RELIC_ID,
  GLOBAL_ACHIEVEMENT_PROFILE_ID,
  MAIN_QUEST_ACHIEVEMENTS,
  PAST_PRESENT_POEM_ID,
  POEM_REWARD_GOLD,
  TRAVEL_ACHIEVEMENT_PATTERNS,
  achievementTarget,
} from '@/achievements/catalog';
import {
  ACHIEVEMENT_PATCH_REGISTRY,
  MAIL_CATALOG,
  POEM_MAIL,
  POEM_MAIL_ID,
  patchByMailId,
  type AchievementPatchCatalogEntry,
  type AchievementPatchSignal,
} from '@/achievements/patch-registry';
import { loadAchievementDefinitions } from '@/content/catalogs/achievements';
import { loadCardCatalog } from '@/content/catalogs/cards';
import { loadDailyGiftItemPool } from '@/content/catalogs/inventory';
import type { AchievementDefinition } from '@/content/types';
import type { DomainCommand } from '@/domain/commands';
import type {
  AchievementCounterRecord,
  AchievementProgressRecord,
  AchievementSpecialState,
  InventoryStackRecord,
  LocalBattleState,
  MailRecord,
  MailboxState,
} from '@/domain/types';
import type { EventBus } from '@/kernel/event-bus';
import type { CaelianDatabase } from '@/storage/database';

type AchievementRecordPayload = Extract<
  DomainCommand,
  { type: 'achievement.record' }
>['payload'];

export interface AchievementCommandCapture {
  playerGold?: number;
  persistentPlayerHp?: number;
  battle?: {
    id: string;
    status: LocalBattleState['status'];
    turn: number;
    handCount: number;
    handLimit: number;
    playerHp: number;
    cardId?: string;
  };
}

export interface LegacyAchievementPayload {
  unlocked?: Record<string, unknown>;
  /** Achievement definitions registered by standalone reward or patch scripts. */
  definitions?: Record<string, unknown>;
  advanced?: Record<string, unknown>;
  oldPlayerPatch?: boolean;
  repoRewardPatch?: boolean;
  poemRewardGranted?: boolean;
  poemUnlockedAt?: string;
  poemDailyGiftDate?: string;
  poemDailyGiftItems?: unknown;
}

export interface PatchEntitlementSyncResult {
  receivedMailIds: string[];
  claimedRewardIds: string[];
  claimedAchievementIds: string[];
}

const COUNTER_PROGRESS: Record<string, string[]> = {
  'economy.goldGained': [
    'ach_gold_5000',
    'ach_gold_20000',
    'ach_gold_1000000',
  ],
  'economy.sellGold': ['ach_sell_gold_10000'],
  'career.reclass': ['ach_reclass_once', 'ach_reclass_5'],
  'battle.astrologyDraw': ['ach_astrology_draw_5'],
  'craft.item': ['ach_craft_item_once', 'ach_craft_item_100'],
  'caelian.gift': [
    'ach_caelian_gift_first',
    'ach_caelian_gift_10',
    'ach_caelian_gift_50',
  ],
  'caelian.invite': [
    'ach_caelian_invite_first',
    'ach_caelian_invite_10',
    'ach_caelian_invite_50',
  ],
  'caelian.giftFavor': ['ach_caelian_gift_favor_5'],
  'trelao.pet': [
    'ach_trelao_pet_first',
    'ach_trelao_pet_10',
    'ach_trelao_pet_100',
  ],
  'trelao.petStreak': ['ach_trelao_pet_streak_5'],
  'trelao.feedLike': [
    'ach_trelao_feed_like_first',
    'ach_trelao_feed_like_10',
    'ach_trelao_feed_like_100',
  ],
  'trelao.feedLikeStreak': ['ach_trelao_feed_like_streak_5'],
  'trelao.feedDislike': [
    'ach_trelao_feed_dislike_first',
    'ach_trelao_feed_dislike_10',
    'ach_trelao_feed_dislike_20',
    'ach_trelao_feed_dislike_100',
  ],
  'trelao.feedDislikeStreak': ['ach_trelao_feed_dislike_streak_5'],
};

const CREATOR_GIFT_KEY = 'special.creatorGift.alpha39-beta12';
const CREATOR_GIFT_GOLD = 2_000;
const CREATOR_GIFT_ITEMS = [
  { itemId: '城郊药草', name: '城郊药草', quantity: 20 },
  { itemId: '治愈苔', name: '治愈苔', quantity: 10 },
  { itemId: '月露草', name: '月露草', quantity: 20 },
  { itemId: '蓝晶花', name: '蓝晶花', quantity: 10 },
  { itemId: '空玻璃瓶', name: '空玻璃瓶', quantity: 20 },
  { itemId: '小血瓶', name: '小血瓶', quantity: 15 },
  { itemId: '小魔药瓶', name: '小魔药瓶', quantity: 15 },
] as const;

const EXTERNAL_DEFINITION_COUNTER_PREFIX = 'external.definition.';

export class AchievementRepository {
  private definitions?: Record<string, AchievementDefinition>;
  private dailyGiftPool?: Array<{ itemId: string; name: string }>;
  private suppressUnlockNotices = false;

  constructor(
    private readonly db: CaelianDatabase,
    private readonly events: EventBus,
    private readonly random: () => number = Math.random,
  ) {}

  async prepareDailyGiftPool(): Promise<void> {
    this.dailyGiftPool ??= await loadDailyGiftItemPool();
  }

  async listProgress(profileId: string): Promise<AchievementProgressRecord[]> {
    const [global, local] = await Promise.all([
      this.db.achievementProgress
        .where('profileId')
        .equals(GLOBAL_ACHIEVEMENT_PROFILE_ID)
        .toArray(),
      this.db.achievementProgress.where('profileId').equals(profileId).toArray(),
    ]);
    const merged = new Map(
      local.map((record) => [record.achievementId, record]),
    );
    for (const record of global) merged.set(record.achievementId, record);
    return [...merged.values()];
  }

  async prepareDefinitions(): Promise<void> {
    await this.loadDefinitions();
  }

  async listDefinitions(): Promise<Record<string, AchievementDefinition>> {
    const builtIn = await this.loadDefinitions();
    const stored = await this.db.achievementCounters
      .where('profileId')
      .equals(GLOBAL_ACHIEVEMENT_PROFILE_ID)
      .filter((record) =>
        record.key.startsWith(EXTERNAL_DEFINITION_COUNTER_PREFIX),
      )
      .toArray();
    return Object.fromEntries([
      ...Object.entries(builtIn),
      ...stored.flatMap((record) => {
        const id = record.key.slice(EXTERNAL_DEFINITION_COUNTER_PREFIX.length);
        const definition = this.normalizeExternalDefinition(id, record.data);
        return definition ? [[id, definition] as const] : [];
      }),
    ]);
  }

  async syncPatchEntitlements(
    profileId: string,
    signals: AchievementPatchSignal[],
    date = new Date(),
  ): Promise<PatchEntitlementSyncResult> {
    const result: PatchEntitlementSyncResult = {
      receivedMailIds: [],
      claimedRewardIds: [],
      claimedAchievementIds: [],
    };
    const uniqueSignals = new Map(
      signals.map((signal) => [signal.id, signal]),
    );
    for (const signal of uniqueSignals.values()) {
      const patch = ACHIEVEMENT_PATCH_REGISTRY[signal.id];
      if (!patch) continue;
      if (patch.claimDate && this.todayKey(date) !== patch.claimDate) continue;
      if (
        patch.claimDate &&
        !(await this.db.playerStates.get(profileId))?.created
      ) {
        continue;
      }
      const existingProgress = await this.db.achievementProgress.get(
        this.progressId(patch.achievement.id),
      );
      if (patch.claimDate && existingProgress?.unlocked) continue;
      await this.ensurePatchProgress(patch);
      const ensuredMail = await this.ensurePatchMail(
        patch,
        signal.opened,
      );
      let record = ensuredMail.record;
      if (ensuredMail.created && !patch.silentMailDelivery) {
        result.receivedMailIds.push(patch.mail.id);
      }

      if (signal.opened && !record.rewardClaimedAt) {
        const newlyClaimed = await this.claimPatchReward(
          profileId,
          record,
          patch,
        );
        await this.unlock(patch.achievement.id);
        if (newlyClaimed) {
          await this.syncCounterProgress('economy.goldGained');
          result.claimedRewardIds.push(patch.mail.id);
          if (patch.presentLetterOnClaim) {
            result.claimedAchievementIds.push(patch.achievement.id);
          }
        }
        record = (await this.db.mailRecords.get(record.id)) ?? record;
      }
      if (record.rewardClaimedAt) {
        await this.ensurePatchCollectible(profileId, patch);
        await this.unlockSilently(
          patch.achievement.id,
          record.openedAt ?? record.rewardClaimedAt,
        );
      }
    }
    return result;
  }

  async mailboxState(profileId: string): Promise<MailboxState> {
    await this.ensurePoemMail(profileId);
    const [records, player] = await Promise.all([
      this.db.mailRecords
        .where('profileId')
        .equals(GLOBAL_ACHIEVEMENT_PROFILE_ID)
        .toArray(),
      this.db.playerStates.get(profileId),
    ]);
    const playerName = player?.name.trim() || '冒险者';
    const entries = records
      .flatMap((record) => {
        const definition = MAIL_CATALOG[record.mailId];
        if (!definition) return [];
        return [
          {
            id: definition.id,
            source: record.source,
            title: definition.title,
            preview: definition.preview,
            sender: definition.sender,
            body: definition.body.map((paragraph) =>
              paragraph.replaceAll('{{playerName}}', playerName),
            ),
            signature: definition.signature ?? '',
            rewardText: definition.rewardText,
            achievementId: definition.achievementId,
            receivedAt: record.receivedAt,
            openedAt: record.openedAt,
            rewardClaimedAt: record.rewardClaimedAt,
            unread: !record.openedAt,
          },
        ];
      })
      .sort((left, right) => {
        const unreadDifference = Number(right.unread) - Number(left.unread);
        if (unreadDifference !== 0) return unreadDifference;
        return right.receivedAt - left.receivedAt;
      });
    return {
      unreadCount: entries.filter((entry) => entry.unread).length,
      entries,
    };
  }

  async openMail(profileId: string, mailId: string): Promise<void> {
    const record = await this.db.mailRecords.get(this.mailRecordId(mailId));
    if (!record) throw new Error('这封邮件尚未送达');
    const now = Date.now();
    const patch = patchByMailId(mailId);
    if (patch && !record.rewardClaimedAt) {
      await this.claimPatchReward(profileId, record, patch);
    } else if (patch) {
      await this.ensurePatchCollectible(profileId, patch);
    }
    await this.db.mailRecords.put({
      ...record,
      openedAt: record.openedAt ?? now,
      rewardClaimedAt:
        (await this.db.mailRecords.get(record.id))?.rewardClaimedAt ??
        record.rewardClaimedAt,
      updatedAt: now,
    });
  }

  async capture(
    profileId: string,
    command: DomainCommand,
  ): Promise<AchievementCommandCapture> {
    const capture: AchievementCommandCapture = {};
    if (
      command.type === 'player.update' ||
      command.type.startsWith('battle.') ||
      command.type.startsWith('market.')
    ) {
      capture.playerGold = (await this.db.playerStates.get(profileId))?.gold;
    }
    if (command.type === 'inventory.use-consumable') {
      capture.persistentPlayerHp = (
        await this.db.playerStates.get(profileId)
      )?.hp;
    }
    if (
      command.type === 'battle.play-card' ||
      command.type === 'battle.use-item' ||
      command.type === 'battle.end-turn' ||
      command.type === 'battle.surrender'
    ) {
      const battleId = command.payload.battleId;
      const session = await this.db.battleSessions.get(battleId);
      if (session?.profileId === profileId) {
        const state = session.state;
        capture.battle = {
          id: session.id,
          status: state.status,
          turn: state.turn,
          handCount: state.player.hand.length,
          handLimit: state.player.handLimit,
          playerHp: state.player.hp,
          ...(command.type === 'battle.play-card'
            ? {
                cardId:
                  state.player.hand[command.payload.handIndex]?.cardId,
              }
            : {}),
        };
      }
    }
    return capture;
  }

  async handleCommand(
    profileId: string,
    command: DomainCommand,
    before: AchievementCommandCapture,
  ): Promise<void> {
    if (command.type.startsWith('achievement.')) return;
    if (command.type === 'mail.open') {
      const patch = patchByMailId(command.payload.mailId);
      if (patch) {
        await this.unlock(patch.achievement.id);
        await this.syncCounterProgress('economy.goldGained');
      }
      return;
    }

    if (command.type === 'player.reclass') {
      const count = (await this.db.playerStates.get(profileId))?.reclassCount ?? 0;
      await this.setCounter('career.reclass', count);
      await this.syncCounterProgress('career.reclass');
    }

    if (command.type === 'player.update' && before.playerGold !== undefined) {
      const nextGold = (await this.db.playerStates.get(profileId))?.gold ?? 0;
      if (nextGold > before.playerGold) {
        await this.incrementCounter(
          'economy.goldGained',
          nextGold - before.playerGold,
        );
        await this.syncCounterProgress('economy.goldGained');
      }
    }

    if (command.type === 'world.move') {
      await this.recordTravel(command.payload);
    }

    if (command.type === 'craft.item') {
      await this.incrementCounter('craft.item', command.payload.count);
      await this.syncCounterProgress('craft.item');
    }

    if (
      command.type === 'craft.equipment' &&
      command.payload.stars + 1 >= 3
    ) {
      await this.unlock('ach_craft_3star_equipment');
    }

    if (command.type === 'battle.play-card' && before.battle) {
      await this.recordPlayedCard(profileId, before.battle);
    }

    if (command.type === 'battle.use-item' && before.battle) {
      const session = await this.db.battleSessions.get(before.battle.id);
      if ((session?.state.player.hp ?? 0) > before.battle.playerHp) {
        await this.unlock('ach_consumable_heal_hp');
      }
    }

    if (
      command.type === 'inventory.use-consumable' &&
      before.persistentPlayerHp !== undefined
    ) {
      const player = await this.db.playerStates.get(profileId);
      if ((player?.hp ?? 0) > before.persistentPlayerHp) {
        await this.unlock('ach_consumable_heal_hp');
      }
    }

    if (
      command.type === 'battle.end-turn' &&
      before.battle &&
      before.battle.handCount >= before.battle.handLimit
    ) {
      await this.unlock('ach_full_hand_end_turn');
    }

    if (command.type === 'battle.surrender') {
      await this.unlock('ach_battle_escape');
    }

    if (command.type.startsWith('battle.') && before.battle) {
      await this.recordBattleResult(profileId, before);
    }

    if (before.playerGold !== undefined && command.type.startsWith('battle.')) {
      const nextGold = (await this.db.playerStates.get(profileId))?.gold ?? 0;
      if (nextGold > before.playerGold) {
        await this.incrementCounter(
          'economy.goldGained',
          nextGold - before.playerGold,
        );
        await this.syncCounterProgress('economy.goldGained');
      }
    }

    if (
      before.playerGold !== undefined &&
      (command.type === 'market.sell-item' ||
        command.type === 'market.sell-equipment')
    ) {
      const nextGold = (await this.db.playerStates.get(profileId))?.gold ?? 0;
      const gained = Math.max(0, nextGold - before.playerGold);
      if (gained > 0) {
        await this.incrementCounter('economy.sellGold', gained);
        await this.incrementCounter('economy.goldGained', gained);
        await this.syncCounterProgress('economy.sellGold');
        await this.syncCounterProgress('economy.goldGained');
      }
    }

    await this.scanStatic(profileId);
  }

  async scanStatic(profileId: string, chatTexts: string[] = []): Promise<void> {
    await this.unlock('ach_re_oseas');

    const text = chatTexts.slice(2).join('\n');
    if (text.includes('凯利安')) {
      await this.unlock('ach_first_meet_caelian');
    }
    if (
      /(?:抱起|抱抱|抱一抱|抱了|抱住|抱)\s*特莱奥|特莱奥[\s\S]{0,18}(?:被)?\s*(?:抱起|抱抱|抱住|抱)/i.test(
        text,
      )
    ) {
      await this.unlock('ach_trelao_hug');
    }

    const [
      player,
      social,
      world,
      quests,
      history,
      relics,
      specials,
      loadout,
      equipment,
    ] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.socialProgress.get(`${profileId}:caelian`),
      this.db.worldStates.get(profileId),
      this.db.questRecords.where('profileId').equals(profileId).toArray(),
      this.db.questHistory.where('profileId').equals(profileId).toArray(),
      this.db.ownedRelics.where('profileId').equals(profileId).toArray(),
      this.db.specialCollectibles
        .where('profileId')
        .equals(profileId)
        .toArray(),
      this.db.equipmentLoadouts.get(profileId),
      this.db.equipmentInstances.where('profileId').equals(profileId).toArray(),
    ]);

    if (social) {
      await this.setProgress(
        'ach_caelian_affection_100',
        social.affinity,
      );
    }
    if (player) {
      await this.setCounter('career.reclass', player.reclassCount);
      await this.syncCounterProgress('career.reclass');
    }
    if (world && !/圣德里安学院/.test(`${world.region} ${world.location}`)) {
      await this.recordTravel(world);
    }
    if (
      history.length > 0 ||
      quests.some((quest) => quest.status === 'completed')
    ) {
      await this.unlock('ach_first_task_complete');
    }
    for (const record of [...quests, ...history]) {
      for (const [questId, achievementId] of Object.entries(
        MAIN_QUEST_ACHIEVEMENTS,
      )) {
        if (record.id.endsWith(questId)) await this.unlock(achievementId);
      }
    }

    await this.setProgress('ach_relic_10', relics.length);
    await this.setProgress('ach_special_collectible_5', specials.length);
    if (
      relics.some(
        (relic) =>
          relic.carried &&
          (relic.relicId === BLANK_PAGE_RELIC_ID ||
            specials.some(
              (special) => special.collectibleId === relic.relicId,
            )),
      )
    ) {
      await this.unlock('ach_equip_special_relic');
    }
    if (loadout) {
      const equipped = [
        loadout.weaponId,
        loadout.armorId,
        loadout.accessoryId,
      ].map((id) => equipment.find((item) => item.id === id));
      if (
        equipped.every(
          (item) => item !== undefined && Number(item.stars) >= 3,
        )
      ) {
        await this.unlock('ach_equip_all_3star');
      }
    }

    const start = await this.db.achievementProgress.get(
      this.progressId('ach_re_oseas'),
    );
    if (start?.unlockedAt) {
      const days = Math.max(
        0,
        Math.floor((Date.now() - start.unlockedAt) / 86_400_000),
      );
      await this.setProgress('ach_calendar_month', days);
      await this.setProgress('ach_calendar_year', days);
    }

    if (
      await this.isUnlocked(PAST_PRESENT_POEM_ID)
    ) {
      await this.ensureBlankPage(profileId);
    }

    for (const counterKey of Object.keys(COUNTER_PROGRESS)) {
      await this.syncCounterProgress(counterKey);
    }
  }

  async recordExternal(
    profileId: string,
    payload: AchievementRecordPayload,
  ): Promise<void> {
    const amount = Math.max(0, Number(payload.amount ?? payload.count ?? 1));
    switch (payload.event) {
      case 'special.old-player':
        await this.unlock('ach_thanks_old_caelian');
        break;
      case 'special.repo-reward':
        await this.unlock('ach_repo_reward');
        break;
      case 'quest.complete':
        await this.unlock('ach_first_task_complete');
        if (payload.questId) {
          const main = MAIN_QUEST_ACHIEVEMENTS[payload.questId];
          if (main) await this.unlock(main);
          if (payload.questId === 'side_flora_says') {
            if (/^A$|结局A/i.test(payload.ending ?? '')) {
              await this.unlock('ach_flora_flower_language');
            }
            if (/^B$|结局B/i.test(payload.ending ?? '')) {
              await this.unlock('ach_flora_waiting_bloom');
            }
          }
        }
        break;
      case 'caelian.gift':
        if (payload.success !== false) {
          await this.incrementCounter('caelian.gift', 1);
          await this.incrementCounter(
            'caelian.giftFavor',
            Math.max(0, Number(payload.favor ?? 0)),
          );
          await this.markDailySocial(profileId, 'gift');
          if (/特产|specialty/i.test(payload.category ?? '')) {
            await this.unlock('ach_caelian_gift_specialty');
          }
          if (/奇怪|不优雅|可出售|weird|sellable/i.test(payload.category ?? '')) {
            await this.unlock('ach_caelian_gift_weird');
          }
        }
        break;
      case 'caelian.invite':
        if (payload.success !== false) {
          await this.incrementCounter('caelian.invite', 1);
          await this.markDailySocial(profileId, 'invite');
          if (payload.region) {
            const visited = await this.counter(`travel.region.${payload.region}`);
            if (visited.value <= 0) {
              await this.unlock('ach_caelian_invite_new_region');
            }
          }
        }
        break;
      case 'trelao.pet':
        if (payload.success === false || payload.positive === false) {
          await this.unlock('ach_trelao_pet_reject_first');
          await this.setCounter('trelao.petStreak', 0);
        } else {
          await this.incrementCounter('trelao.pet', 1);
          await this.incrementCounter('trelao.petStreak', 1);
        }
        break;
      case 'trelao.feed':
        await this.recordTrelaoFeed(profileId, payload);
        break;
      case 'battle.consumable-heal':
        await this.unlock('ach_consumable_heal_hp');
        break;
      case 'battle.astrology-draw':
        await this.incrementCounter('battle.astrologyDraw', amount);
        break;
      case 'battle.merchant-bribe-victory':
        await this.unlock('ach_merchant_bribe_win');
        break;
      case 'gold.gain':
        await this.incrementCounter('economy.goldGained', amount);
        break;
      case 'gold.sell':
        await this.incrementCounter('economy.sellGold', amount);
        break;
      case 'craft.item':
        await this.incrementCounter('craft.item', amount);
        break;
      case 'craft.equipment':
        if (Number(payload.star ?? 1) >= 3) {
          await this.unlock('ach_craft_3star_equipment');
        }
        break;
      case 'workshop.class':
        await this.unlock('ach_workshop_create_class');
        break;
      case 'workshop.card':
        await this.unlock('ach_workshop_create_deck');
        break;
      case 'collectible.special':
        await this.incrementCounter(
          'collection.special',
          Math.max(1, payload.ids?.length ?? amount),
        );
        await this.setProgress(
          'ach_special_collectible_5',
          (await this.counter('collection.special')).value,
        );
        break;
    }
    for (const counterKey of Object.keys(COUNTER_PROGRESS)) {
      await this.syncCounterProgress(counterKey);
    }
    await this.scanStatic(profileId);
  }

  async importLegacy(
    profileId: string,
    payload: LegacyAchievementPayload,
  ): Promise<void> {
    const marker = await this.counter('legacy.imported');
    this.suppressUnlockNotices = true;
    try {
      const definitions = await this.loadDefinitions();
      const now = Date.now();

      for (const [id, raw] of Object.entries(payload.definitions ?? {})) {
        const definition = this.normalizeExternalDefinition(id, raw);
        if (!definition) continue;
        definitions[id] = definition;
        await this.setCounter(
          `${EXTERNAL_DEFINITION_COUNTER_PREFIX}${id}`,
          1,
          definition,
        );
      }

      for (const [id, raw] of Object.entries(payload.unlocked ?? {})) {
        const fallback = this.normalizeExternalDefinition(id, raw);
        if (!definitions[id] && fallback) {
          definitions[id] = fallback;
          await this.setCounter(
            `${EXTERNAL_DEFINITION_COUNTER_PREFIX}${id}`,
            1,
            fallback,
          );
        }
        if (!definitions[id]) continue;
        const existing = await this.db.achievementProgress.get(
          this.progressId(id),
        );
        if (existing?.unlocked) continue;
        const value =
          raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
        const timestamp = Date.parse(
          String(
            value.completedAt ??
              value.unlockedAt ??
              value.time ??
              value.date ??
              '',
          ),
        );
        await this.db.achievementProgress.put({
          id: this.progressId(id),
          profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
          achievementId: id,
          progress: achievementTarget(id),
          unlocked: true,
          unlockedAt: Number.isFinite(timestamp) ? timestamp : now,
          updatedAt: now,
        });
      }

      if (marker.value <= 0) {
        const advanced = payload.advanced ?? {};
        const economy = this.object(advanced.economy);
        const combat = this.object(advanced.combat);
        const craft = this.object(advanced.craft);
        const collectibles = this.object(advanced.collectibles);
        await this.setCounter(
          'economy.goldGained',
          this.number(economy.total_gold_gained),
        );
        await this.setCounter(
          'economy.sellGold',
          this.number(economy.sell_gold_gained),
        );
        await this.setCounter(
          'battle.astrologyDraw',
          this.number(combat.astrology_draw_count),
        );
        await this.setCounter(
          'craft.item',
          this.number(craft.item_craft_count),
        );
        const specialIds = Array.isArray(
          collectibles.special_obtained_ids,
        )
          ? collectibles.special_obtained_ids
          : [];
        await this.setCounter('collection.special', specialIds.length);
        await this.setProgress('ach_special_collectible_5', specialIds.length);

        if (payload.oldPlayerPatch) {
          await this.unlockSilently('ach_thanks_old_caelian');
        }
        if (payload.repoRewardPatch) {
          await this.unlockSilently('ach_repo_reward');
        }
        if (payload.poemRewardGranted) {
          await this.unlockSilently(
            PAST_PRESENT_POEM_ID,
            Date.parse(payload.poemUnlockedAt ?? '') || now,
          );
          await this.setCounter('poem.claimed', 1);
          await this.ensureBlankPage(profileId);
          await this.ensurePoemMail(profileId);
        }
        if (payload.poemDailyGiftDate) {
          await this.setCounter('poem.dailyGift', 1, {
            date: payload.poemDailyGiftDate,
            items: this.normalizeGiftItems(payload.poemDailyGiftItems),
          });
        }

        const local = await this.db.achievementProgress
          .where('profileId')
          .equals(profileId)
          .toArray();
        for (const record of local) {
          if (!record.unlocked) continue;
          await this.unlockSilently(
            record.achievementId,
            record.unlockedAt ?? record.updatedAt,
          );
        }

        await this.setCounter('legacy.imported', 1);
      }
    } finally {
      this.suppressUnlockNotices = false;
    }
    await this.scanStatic(profileId);
  }

  async claimPoemLetter(profileId: string): Promise<void> {
    const claimed = await this.counter('poem.claimed');
    if (claimed.value <= 0) {
      const player = await this.db.playerStates.get(profileId);
      if (!player) throw new Error('玩家档案不存在');
      player.gold += POEM_REWARD_GOLD;
      player.updatedAt = Date.now();
      await this.db.playerStates.put(player);
      await this.incrementCounter('economy.goldGained', POEM_REWARD_GOLD);
      await this.setCounter('poem.claimed', 1);
    }
    await this.ensureBlankPage(profileId);
    await this.unlock(PAST_PRESENT_POEM_ID);
    await this.ensurePoemMail(profileId);
    await this.syncCounterProgress('economy.goldGained');
  }

  async claimDailyGift(profileId: string): Promise<void> {
    const state = await this.specialState(profileId);
    if (!state.letterClaimed) throw new Error('请先开启写给今昔的感谢信');
    if (!state.dailyGiftAvailable) throw new Error('今天已经领取过赠礼');
    const items = this.pickDailyGifts();
    const now = Date.now();
    for (const item of items) {
      const id = `${profileId}:${item.itemId}`;
      const current = await this.db.inventoryStacks.get(id);
      const stack: InventoryStackRecord = {
        id,
        profileId,
        itemId: item.itemId,
        name: item.name,
        quantity: (current?.quantity ?? 0) + item.quantity,
        updatedAt: now,
      };
      await this.db.inventoryStacks.put(stack);
    }
    await this.setCounter('poem.dailyGift', 1, {
      date: this.todayKey(),
      items,
    });
  }

  async claimCreatorGift(profileId: string): Promise<void> {
    const counterId = this.counterId(CREATOR_GIFT_KEY);
    const claimed = await this.db.achievementCounters.get(counterId);
    if ((claimed?.value ?? 0) > 0) {
      throw new Error('这份特殊赠礼已经领取过了');
    }
    const player = await this.db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    const now = Date.now();
    player.gold += CREATOR_GIFT_GOLD;
    player.updatedAt = now;
    await this.db.playerStates.put(player);
    for (const item of CREATOR_GIFT_ITEMS) {
      const id = `${profileId}:${item.itemId}`;
      const current = await this.db.inventoryStacks.get(id);
      await this.db.inventoryStacks.put({
        id,
        profileId,
        itemId: item.itemId,
        name: item.name,
        quantity: (current?.quantity ?? 0) + item.quantity,
        updatedAt: now,
      });
    }
    await this.db.achievementCounters.put({
      id: counterId,
      profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
      key: CREATOR_GIFT_KEY,
      value: 1,
      updatedAt: now,
    });
  }

  async specialState(
    profileId: string,
  ): Promise<AchievementSpecialState> {
    const [claimed, daily, poem, creatorGift] = await Promise.all([
      this.counter('poem.claimed'),
      this.counter('poem.dailyGift'),
      this.db.achievementProgress.get(this.progressId(PAST_PRESENT_POEM_ID)),
      this.counter(CREATOR_GIFT_KEY),
    ]);
    const data = this.object(daily.data);
    const items = Array.isArray(data.items)
      ? data.items.flatMap((item) => {
          const value = this.object(item);
          const itemId = String(value.itemId ?? '');
          const name = String(value.name ?? '');
          const quantity = Math.max(0, this.number(value.quantity));
          return itemId && name && quantity > 0
            ? [{ itemId, name, quantity }]
            : [];
        })
      : [];
    const letterClaimed = claimed.value > 0 || poem?.unlocked === true;
    const lastDailyGiftDate = String(data.date ?? '');
    if (letterClaimed) {
      await this.ensureBlankPage(profileId);
      await this.ensurePoemMail(profileId);
    }
    return {
      letterClaimed,
      dailyGiftAvailable:
        letterClaimed && lastDailyGiftDate !== this.todayKey(),
      lastDailyGiftDate,
      lastDailyGiftItems: items,
      creatorGiftAvailable: creatorGift.value <= 0,
      creatorGiftClaimed: creatorGift.value > 0,
      creatorGiftItems: CREATOR_GIFT_ITEMS.map((item) => ({ ...item })),
      creatorGiftGold: CREATOR_GIFT_GOLD,
    };
  }

  private async recordPlayedCard(
    profileId: string,
    battle: NonNullable<AchievementCommandCapture['battle']>,
  ): Promise<void> {
    const turnKey = `battle.turn.${battle.id}.${battle.turn}`;
    const turnCount = await this.incrementCounter(`${turnKey}.cards`, 1);
    await this.setProgress('ach_turn_play_5', turnCount.value);

    const cardId = battle.cardId;
    if (!cardId) return;
    const cards = await loadCardCatalog();
    const card = cards[cardId];
    if (!card) return;
    const summon = [
      card.type,
      card.cat,
      card.description,
      ...card.effects.map((effect) => effect.type),
    ].some((value) => /summon|召唤/i.test(String(value ?? '')));
    if (summon) await this.unlock('ach_first_summon_card');

    const player = await this.db.playerStates.get(profileId);
    const isAttack = /attack|攻击/i.test(card.type);
    const isWeaponMaster =
      player?.subclass === 'weapon_master' ||
      /武器大师|weapon.*master/i.test(
        `${player?.subclass ?? ''} ${card.cls ?? ''} ${card.cat ?? ''}`,
      );
    if (!isAttack || !isWeaponMaster) return;
    const chainKey = `${turnKey}.sameCard`;
    const current = await this.counter(chainKey);
    const data = this.object(current.data);
    const count =
      String(data.cardId ?? '') === cardId ? current.value + 1 : 1;
    await this.setCounter(chainKey, count, { cardId });
    await this.setProgress('ach_weapon_master_same_5', count);
  }

  private async recordBattleResult(
    profileId: string,
    before: AchievementCommandCapture,
  ): Promise<void> {
    if (!before.battle || before.battle.status !== 'ongoing') return;
    const session = await this.db.battleSessions.get(before.battle.id);
    if (!session || session.state.status === 'ongoing') return;
    const marker = await this.counter(`battle.result.${session.id}`);
    if (marker.value > 0) return;
    await this.setCounter(`battle.result.${session.id}`, 1);

    const state = session.state;
    if (state.status === 'victory') {
      await this.unlock('ach_battle_victory');
      if (state.turn <= 3) {
        await this.unlock('ach_fast_victory_under_3_turns');
      }
      if (state.player.hp >= state.player.hpMax) {
        await this.unlock('ach_battle_full_hp_win');
      }
    } else if (state.status === 'defeat') {
      await this.unlock('ach_battle_defeat');
    } else if (state.status === 'surrendered') {
      await this.unlock('ach_battle_escape');
    }
    await this.scanStatic(profileId);
  }

  private async recordTravel(destination: {
    region: string;
    place?: string;
    location: string;
  }): Promise<void> {
    const text = `${destination.region} ${destination.place ?? ''} ${destination.location}`;
    if (!/圣德里安学院/.test(text)) {
      await this.unlock('ach_travel_beyond_academy');
    }
    for (const rule of TRAVEL_ACHIEVEMENT_PATTERNS) {
      if (rule.pattern.test(text)) await this.unlock(rule.id);
    }
    const region = destination.region.trim() || destination.location.trim();
    if (!region || /圣德里安学院/.test(region)) return;
    await this.setCounter(`travel.region.${region}`, 1);
    const visited = await this.countCounters('travel.region.');
    await this.setProgress('ach_travel_first_new_region', visited);
    await this.setProgress('ach_travel_oseas_5_regions', visited);
    await this.setProgress('ach_travel_oseas_10_regions', visited);
  }

  private async recordTrelaoFeed(
    profileId: string,
    payload: AchievementRecordPayload,
  ): Promise<void> {
    const liked = payload.liked !== false;
    const category = payload.category ?? '';
    const day = await this.interactionDayKey(profileId);
    if (liked) {
      await this.incrementCounter('trelao.feedLike', 1);
      await this.incrementCounter('trelao.feedLikeStreak', 1);
      await this.setCounter('trelao.feedDislikeStreak', 0);
      const daily = await this.incrementCounter(
        `trelao.feedLike.daily.${day}`,
        1,
      );
      await this.setProgress('ach_trelao_feed_like_daily_5', daily.value);
      if (/肉|meat/i.test(category)) {
        await this.unlock('ach_trelao_feed_meat_like');
      }
      if (/甜|dessert|sweet/i.test(category)) {
        await this.unlock('ach_trelao_feed_dessert_like');
      }
      if (/特产|specialty/i.test(category)) {
        await this.unlock('ach_trelao_feed_specialty_like');
      }
    } else {
      await this.incrementCounter('trelao.feedDislike', 1);
      await this.incrementCounter('trelao.feedDislikeStreak', 1);
      await this.setCounter('trelao.feedLikeStreak', 0);
      const daily = await this.incrementCounter(
        `trelao.feedDislike.daily.${day}`,
        1,
      );
      await this.setProgress('ach_trelao_feed_dislike_daily_5', daily.value);
      if (/蔬菜|西蓝花|vegetable/i.test(category)) {
        await this.unlock('ach_trelao_feed_vegetable_dislike');
      }
      if (/吐|呕吐|vomit/i.test(`${category} ${payload.reaction ?? ''}`)) {
        await this.unlock('ach_trelao_feed_bad_reaction');
      }
    }
  }

  private async markDailySocial(
    profileId: string,
    kind: 'gift' | 'invite',
  ): Promise<void> {
    const day = await this.interactionDayKey(profileId);
    await this.setCounter(`caelian.social.${day}.${kind}`, 1);
    const [gift, invite] = await Promise.all([
      this.counter(`caelian.social.${day}.gift`),
      this.counter(`caelian.social.${day}.invite`),
    ]);
    if (gift.value > 0 && invite.value > 0) {
      await this.unlock('ach_caelian_social_same_day');
    }
  }

  private async syncCounterProgress(key: string): Promise<void> {
    const ids = COUNTER_PROGRESS[key];
    if (!ids) return;
    const current = await this.counter(key);
    for (const id of ids) await this.setProgress(id, current.value);
  }

  private async setProgress(id: string, progress: number): Promise<void> {
    const definitions = await this.loadDefinitions();
    if (!definitions[id]) return;
    const target = achievementTarget(id);
    const value = Math.max(0, Math.min(target, Number(progress) || 0));
    const existing = await this.db.achievementProgress.get(this.progressId(id));
    if (existing?.unlocked) return;
    if (value >= target) {
      await this.unlock(id);
      return;
    }
    const now = Date.now();
    await this.db.achievementProgress.put({
      id: this.progressId(id),
      profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
      achievementId: id,
      progress: value,
      unlocked: false,
      unlockedAt: null,
      updatedAt: now,
    });
  }

  private async unlock(id: string): Promise<boolean> {
    return this.unlockInternal(
      id,
      Date.now(),
      !this.suppressUnlockNotices,
    );
  }

  private async unlockSilently(
    id: string,
    unlockedAt = Date.now(),
  ): Promise<boolean> {
    return this.unlockInternal(id, unlockedAt, false);
  }

  private async unlockInternal(
    id: string,
    unlockedAt: number,
    notify: boolean,
  ): Promise<boolean> {
    const definitions = await this.loadDefinitions();
    const definition = definitions[id];
    if (!definition) return false;
    const existing = await this.db.achievementProgress.get(this.progressId(id));
    if (existing?.unlocked) return false;
    const now = Date.now();
    await this.db.achievementProgress.put({
      id: this.progressId(id),
      profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
      achievementId: id,
      progress: achievementTarget(id),
      unlocked: true,
      unlockedAt,
      updatedAt: now,
    });
    if (notify) {
      await this.events.emit('achievement.unlocked', {
        achievementId: id,
        name: definition.name,
        description: definition.description,
        stars: Number(definition.star ?? 1),
        unlockedAt,
      });
    }
    return true;
  }

  private async isUnlocked(id: string): Promise<boolean> {
    return Boolean(
      (await this.db.achievementProgress.get(this.progressId(id)))?.unlocked,
    );
  }

  private async ensureBlankPage(profileId: string): Promise<void> {
    const now = Date.now();
    await this.db.specialCollectibles.put({
      id: `${profileId}:${BLANK_PAGE_RELIC_ID}`,
      profileId,
      collectibleId: BLANK_PAGE_RELIC_ID,
      name: '空白的书页',
      summary: '未来的冒险还在等你来写就。',
      source: '特殊成就：今昔的诗行',
      acquiredDate: new Date(now).toISOString(),
      updatedAt: now,
    });
    const ownedId = `${profileId}:${BLANK_PAGE_RELIC_ID}`;
    const existing = await this.db.ownedRelics.get(ownedId);
    if (!existing) {
      await this.db.ownedRelics.put({
        id: ownedId,
        profileId,
        relicId: BLANK_PAGE_RELIC_ID,
        carried: false,
        acquiredAt: now,
        updatedAt: now,
      });
    }
  }

  private async ensurePoemMail(profileId: string): Promise<void> {
    const existing = await this.db.mailRecords.get(
      this.mailRecordId(POEM_MAIL_ID),
    );
    if (existing) return;
    const [claimed, progress] = await Promise.all([
      this.counter('poem.claimed'),
      this.db.achievementProgress.get(this.progressId(PAST_PRESENT_POEM_ID)),
    ]);
    if (claimed.value <= 0 && progress?.unlocked !== true) return;
    const player = await this.db.playerStates.get(profileId);
    if (!player) return;
    const timestamp = progress?.unlockedAt ?? Date.now();
    await this.db.mailRecords.put({
      id: this.mailRecordId(POEM_MAIL.id),
      profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
      mailId: POEM_MAIL.id,
      source: POEM_MAIL.source,
      receivedAt: timestamp,
      openedAt: timestamp,
      rewardClaimedAt: timestamp,
      updatedAt: Date.now(),
    });
  }

  private async claimPatchReward(
    profileId: string,
    record: MailRecord,
    patch: AchievementPatchCatalogEntry,
  ): Promise<boolean> {
    const newlyClaimed = await this.db.transaction(
      'rw',
      [
        this.db.mailRecords,
        this.db.playerStates,
        this.db.achievementCounters,
        this.db.specialCollectibles,
        this.db.ownedRelics,
      ],
      async () => {
        const current = await this.db.mailRecords.get(record.id);
        if (!current) throw new Error('这封补丁邮件尚未送达');
        if (current.rewardClaimedAt) return false;
        const player = await this.db.playerStates.get(profileId);
        if (!player) throw new Error('玩家档案不存在');
        const now = Date.now();
        player.gold += patch.reward.gold;
        player.updatedAt = now;
        await this.db.playerStates.put(player);
        await this.incrementCounter(
          'economy.goldGained',
          patch.reward.gold,
        );
        await this.ensurePatchCollectible(profileId, patch);
        await this.db.mailRecords.put({
          ...current,
          openedAt: current.openedAt ?? now,
          rewardClaimedAt: now,
          updatedAt: now,
        });
        return true;
      },
    );
    if (!newlyClaimed) {
      await this.ensurePatchCollectible(profileId, patch);
    }
    return newlyClaimed;
  }

  private async ensurePatchMail(
    patch: AchievementPatchCatalogEntry,
    opened: boolean,
  ): Promise<{ record: MailRecord; created: boolean }> {
    return this.db.transaction('rw', this.db.mailRecords, async () => {
      const id = this.mailRecordId(patch.mail.id);
      const existing = await this.db.mailRecords.get(id);
      const now = Date.now();
      if (existing) {
        const record =
          opened && !existing.openedAt
            ? { ...existing, openedAt: now, updatedAt: now }
            : existing;
        if (record !== existing) await this.db.mailRecords.put(record);
        return { record, created: false };
      }
      const record: MailRecord = {
        id,
        profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
        mailId: patch.mail.id,
        source: patch.mail.source,
        receivedAt: now,
        openedAt: opened ? now : null,
        rewardClaimedAt: null,
        updatedAt: now,
      };
      await this.db.mailRecords.put(record);
      return { record, created: true };
    });
  }

  private async ensurePatchCollectible(
    profileId: string,
    patch: AchievementPatchCatalogEntry,
  ): Promise<void> {
    const collectible = patch.reward.collectible;
    if (!collectible) return;
    const now = Date.now();
    const id = `${profileId}:${collectible.id}`;
    await this.db.specialCollectibles.put({
      id,
      profileId,
      collectibleId: collectible.id,
      name: collectible.name,
      summary: collectible.summary,
      source: collectible.source,
      acquiredDate:
        (await this.db.specialCollectibles.get(id))?.acquiredDate ??
        new Date(now).toISOString(),
      updatedAt: now,
    });
    if (!collectible.relic) {
      await this.db.ownedRelics.delete(id);
      return;
    }
    const existingRelic = await this.db.ownedRelics.get(id);
    if (existingRelic) return;
    const carriedCount = await this.db.ownedRelics
      .where('profileId')
      .equals(profileId)
      .filter((entry) => entry.carried)
      .count();
    await this.db.ownedRelics.put({
      id,
      profileId,
      relicId: collectible.id,
      carried: carriedCount < 5,
      acquiredAt: now,
      updatedAt: now,
    });
  }

  private async ensurePatchProgress(
    patch: AchievementPatchCatalogEntry,
  ): Promise<void> {
    const id = this.progressId(patch.achievement.id);
    if (await this.db.achievementProgress.get(id)) return;
    await this.db.achievementProgress.put({
      id,
      profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
      achievementId: patch.achievement.id,
      progress: 0,
      unlocked: false,
      unlockedAt: null,
      updatedAt: Date.now(),
    });
  }

  private pickDailyGifts(): AchievementSpecialState['lastDailyGiftItems'] {
    const pool = [...(this.dailyGiftPool ?? [])];
    if (pool.length < 2) {
      throw new Error('区域集市物品库为空，无法生成每日赠礼');
    }
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(this.random() * (index + 1));
      const current = pool[index]!;
      pool[index] = pool[swap]!;
      pool[swap] = current;
    }
    const maximumKinds = Math.min(5, pool.length, 10);
    const kindCount =
      2 + Math.floor(this.random() * (maximumKinds - 1));
    const picked = pool.slice(0, kindCount).map((item) => ({
      itemId: item.itemId,
      name: item.name,
      quantity: 1,
    }));
    let remaining = 10 - picked.length;
    while (remaining > 0) {
      const index = Math.floor(this.random() * picked.length);
      picked[index]!.quantity += 1;
      remaining -= 1;
    }
    return picked.sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-Hans-CN'),
    );
  }

  private normalizeGiftItems(
    raw: unknown,
  ): AchievementSpecialState['lastDailyGiftItems'] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const value = this.object(item);
      const itemId = String(value.itemId ?? value.id ?? '');
      const name = String(value.name ?? '');
      const quantity = this.number(value.quantity ?? value.count);
      return itemId && name && quantity > 0
        ? [{ itemId, name, quantity }]
        : [];
    });
  }

  private async counter(key: string): Promise<AchievementCounterRecord> {
    return (
      (await this.db.achievementCounters.get(this.counterId(key))) ?? {
        id: this.counterId(key),
        profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
        key,
        value: 0,
        updatedAt: 0,
      }
    );
  }

  private async setCounter(
    key: string,
    value: number,
    data?: unknown,
  ): Promise<AchievementCounterRecord> {
    const current = await this.counter(key);
    const next: AchievementCounterRecord = {
      ...current,
      value: Math.max(0, Number(value) || 0),
      ...(data === undefined ? {} : { data }),
      updatedAt: Date.now(),
    };
    await this.db.achievementCounters.put(next);
    return next;
  }

  private async incrementCounter(
    key: string,
    amount: number,
  ): Promise<AchievementCounterRecord> {
    const current = await this.counter(key);
    return this.setCounter(key, current.value + Math.max(0, amount));
  }

  private async countCounters(prefix: string): Promise<number> {
    return this.db.achievementCounters
      .where('profileId')
      .equals(GLOBAL_ACHIEVEMENT_PROFILE_ID)
      .filter((record) => record.key.startsWith(prefix) && record.value > 0)
      .count();
  }

  private async loadDefinitions() {
    this.definitions ??= await loadAchievementDefinitions();
    return this.definitions;
  }

  private normalizeExternalDefinition(
    id: string,
    raw: unknown,
  ): AchievementDefinition | undefined {
    const normalizedId = String(id ?? '').trim().slice(0, 180);
    if (!normalizedId) return undefined;
    const source = this.object(raw);
    const name = String(source.name ?? source.title ?? normalizedId)
      .trim()
      .slice(0, 80);
    if (!name) return undefined;
    return {
      id: normalizedId,
      name,
      description: String(
        source.description ?? source.desc ?? source.summary ?? '',
      )
        .trim()
        .slice(0, 500),
      condition: String(
        source.condition ?? source.requirement ?? source.hint ?? '通过外部成就脚本获得',
      )
        .trim()
        .slice(0, 300),
      star: Math.max(
        0,
        Math.min(5, Math.floor(this.number(source.star ?? source.stars ?? 1))),
      ),
      category: String(source.category ?? 'special').trim().slice(0, 40),
      hidden: source.hidden === true,
      special: source.special !== false,
      patchOnly: source.patchOnly !== false,
      source: String(source.source ?? 'external_achievement').slice(0, 80),
    };
  }

  private progressId(id: string): string {
    return `${GLOBAL_ACHIEVEMENT_PROFILE_ID}:${id}`;
  }

  private counterId(key: string): string {
    return `${GLOBAL_ACHIEVEMENT_PROFILE_ID}:${key}`;
  }

  private mailRecordId(mailId: string): string {
    return `${GLOBAL_ACHIEVEMENT_PROFILE_ID}:${mailId}`;
  }

  private todayKey(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async interactionDayKey(profileId: string): Promise<string> {
    const gameDate = (await this.db.worldStates.get(profileId))?.gameDate.trim();
    return gameDate || this.todayKey();
  }

  private number(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
