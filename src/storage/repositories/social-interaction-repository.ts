import { loadBattleItems } from '@/content/catalogs/inventory';
import {
  loadMarketCatalogs,
  type MarketCatalogs,
} from '@/content/catalogs/market';
import {
  loadRegionPlaces,
  loadRegions,
} from '@/content/catalogs/world';
import type {
  RegionDefinition,
  RegionPlaceDefinition,
} from '@/content/types';
import type { DomainCommand } from '@/domain/commands';
import type {
  InventoryStackRecord,
  SocialInteractionOptions,
} from '@/domain/types';
import { relationshipStage } from '@/mvu/contracts';
import {
  TRELAO_DISLIKED_ITEMS,
  TRELAO_LIKE_FEEDBACK,
  TRELAO_MILD_DISLIKE_FEEDBACK,
  clampInteractionAffinity,
  giftAffinityDelta,
  interactionItemTags,
  pickInteractionFeedback,
  trelaoFeedMeta,
} from '@/social-interaction-rules';
import type { CaelianDatabase } from '@/storage/database';
import {
  COOKING_DISHES,
  isCookingMaterial,
  isDish,
} from '@/content/cooking';
import { defaultTrelaoProgress } from '@/storage/defaults';
import {
  clampTrelaoAffinity,
  pickTrelaoTouchReaction,
  trelaoStageLabel,
} from '@/trelao';

export type SocialInteractionInput = Extract<
  DomainCommand,
  { type: 'social.interact' }
>['payload'];

type AchievementRecordPayload = Extract<
  DomainCommand,
  { type: 'achievement.record' }
>['payload'];

export interface SocialInteractionOutcome {
  message: string;
  prompt?: string;
  affinityChanged?: boolean;
  achievement: AchievementRecordPayload;
}

export function normalizePendingAffinityDelta(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 2) / 2;
}

export class SocialInteractionRepository {
  private markets?: MarketCatalogs;
  private battleItems?: Awaited<ReturnType<typeof loadBattleItems>>;
  private regions?: RegionDefinition[];
  private places?: Record<string, RegionPlaceDefinition[]>;

  constructor(
    private readonly db: CaelianDatabase,
    private readonly random: () => number = Math.random,
  ) {}

  async prepare(): Promise<void> {
    const [markets, battleItems, regions, places] = await Promise.all([
      loadMarketCatalogs(),
      loadBattleItems(),
      loadRegions(),
      loadRegionPlaces(),
    ]);
    this.markets = markets;
    this.battleItems = battleItems;
    this.regions = regions;
    this.places = places;
  }

  async options(profileId: string): Promise<SocialInteractionOptions> {
    await this.prepare();
    const [inventory, player, accessRecords] = await Promise.all([
      this.db.inventoryStacks.where('profileId').equals(profileId).toArray(),
      this.db.playerStates.get(profileId),
      this.db.regionAccess.where('profileId').equals(profileId).toArray(),
    ]);
    if (!player) throw new Error('玩家档案不存在');

    const gifts = inventory
      .filter(
        (stack) =>
          stack.quantity > 0 &&
          !isCookingMaterial(stack.itemId) &&
          !isCookingMaterial(stack.name),
      )
      .flatMap((stack) => {
        const price = this.giftPrice(stack);
        if (price <= 0) return [];
        const isConsumable = this.isConsumable(stack);
        const tags = interactionItemTags(stack.name, isConsumable);
        return [
          {
            itemId: stack.itemId,
            name: stack.name,
            quantity: stack.quantity,
            price,
            tags,
            affinityDelta: isDish(stack.itemId) || isDish(stack.name)
              ? (COOKING_DISHES[stack.itemId] ?? COOKING_DISHES[stack.name])
                  ?.caelianLiked
                ? 0.5
                : -1
              : giftAffinityDelta(tags),
            ...((COOKING_DISHES[stack.itemId] ?? COOKING_DISHES[stack.name])
              ?.caelianLiked === false
              ? { affinityDeltaLabel: '好感 -1～-5' }
              : {}),
          },
        ];
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));

    const feeds = inventory
      .filter((stack) => stack.quantity > 0)
      .flatMap((stack) => {
        const meta = trelaoFeedMeta(
          stack.name,
          this.isConsumable(stack),
        );
        if (!meta.allowed) return [];
        return [
          {
            itemId: stack.itemId,
            name: stack.name,
            quantity: stack.quantity,
            result: meta.result,
            category: meta.category,
            source: meta.source,
            tags: meta.tags,
          },
        ];
      })
      .sort((left, right) => {
        if (left.result !== right.result) {
          return left.result === 'like' ? -1 : 1;
        }
        return left.name.localeCompare(right.name, 'zh-Hans-CN');
      });

    const accessByRegion = new Map(
      accessRecords.map((record) => [record.regionId, record]),
    );
    const inviteRegions = this.regionCatalog()
      .filter((region) => {
        const access = accessByRegion.get(region.id);
        return (
          (access?.accessible ?? region.unlocked) &&
          player.level >= region.minLevel
        );
      })
      .map((region) => ({
        regionId: region.id,
        name: region.name,
        places: (this.placeCatalog()[region.id] ?? []).map((place) => ({
          name: place.name,
          description: place.desc,
        })),
      }));

    return { gifts, feeds, inviteRegions };
  }

  async interact(
    profileId: string,
    input: SocialInteractionInput,
  ): Promise<SocialInteractionOutcome> {
    this.assertPrepared();
    if (input.action === 'caelian.gift') {
      return this.gift(profileId, input.itemId);
    }
    if (input.action === 'caelian.invite') {
      return this.invite(profileId, input.regionId, input.place);
    }
    if (input.action === 'trelao.pet') return this.pet(profileId);
    return this.feed(profileId, input.itemId);
  }

  async pendingAffinityDelta(profileId: string): Promise<number> {
    const social = await this.db.socialProgress.get(`${profileId}:caelian`);
    return normalizePendingAffinityDelta(social?.pendingAffinityDelta);
  }

  async acknowledgePendingAffinityDelta(
    profileId: string,
    acknowledgedDelta: number,
  ): Promise<number> {
    const acknowledged = normalizePendingAffinityDelta(acknowledgedDelta);
    if (acknowledged === 0) return this.pendingAffinityDelta(profileId);
    return this.db.transaction('rw', this.db.socialProgress, async () => {
      const id = `${profileId}:caelian`;
      const social = await this.db.socialProgress.get(id);
      if (!social) throw new Error('凯利安状态不存在');
      const remaining = normalizePendingAffinityDelta(
        normalizePendingAffinityDelta(social.pendingAffinityDelta) -
          acknowledged,
      );
      await this.db.socialProgress.put({
        ...social,
        pendingAffinityDelta: remaining,
      });
      return remaining;
    });
  }

  private async gift(
    profileId: string,
    itemId: string,
  ): Promise<SocialInteractionOutcome> {
    const stack = await this.ownedStack(profileId, itemId);
    if (isCookingMaterial(stack.itemId) || isCookingMaterial(stack.name)) {
      throw new Error('料理材料只能投喂特莱奥，不能赠送给凯利安');
    }
    if (this.giftPrice(stack) <= 0) {
      throw new Error('这个物品不能在集市出售，无法作为礼物');
    }
    const tags = interactionItemTags(
      stack.name,
      this.isConsumable(stack),
    );
    const dish = COOKING_DISHES[stack.itemId] ?? COOKING_DISHES[stack.name];
    const requestedDelta = dish
      ? dish.caelianLiked
        ? 0.5
        : -(1 + Math.floor(this.random() * 5))
      : giftAffinityDelta(tags);
    const social = await this.db.socialProgress.get(`${profileId}:caelian`);
    if (!social) throw new Error('凯利安状态不存在');
    const affinity = clampInteractionAffinity(
      social.affinity + requestedDelta,
    );
    const appliedDelta = affinity - social.affinity;
    const pendingAffinityDelta = normalizePendingAffinityDelta(
      normalizePendingAffinityDelta(social.pendingAffinityDelta) +
        appliedDelta,
    );
    await Promise.all([
      this.consume(stack),
      this.db.socialProgress.put({
        ...social,
        affinity,
        pendingAffinityDelta,
        relationshipStage: relationshipStage(affinity),
        updatedAt: Date.now(),
      }),
    ]);
    const category = [
      tags.includes('specialty') ? 'specialty' : '',
      tags.includes('weird_or_dirty') ? 'weird_or_dirty' : '',
    ]
      .filter(Boolean)
      .join(' ') || 'normal';
    const favorText = this.deltaText(appliedDelta);
    const reaction = dish && !dish.caelianLiked
      ? '凯利安尝了一口便安静地放下餐具；这道料理显然不合他的口味。'
      : tags.includes('weird_or_dirty')
      ? '凯利安收下时的微笑有一瞬间变得很勉强。'
      : tags.includes('specialty')
        ? '他似乎多看了一眼这份特产。'
        : '他礼貌地收下了礼物。';
    return {
      message: `你将「${stack.name}」送给了凯利安。好感度${favorText}。${reaction}`,
      affinityChanged: appliedDelta !== 0,
      achievement: {
        event: 'caelian.gift',
        success: true,
        favor: requestedDelta,
        category,
      },
    };
  }

  private async invite(
    profileId: string,
    regionId: string,
    rawPlace: string,
  ): Promise<SocialInteractionOutcome> {
    const [player, access] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.regionAccess.get(`${profileId}:${regionId}`),
    ]);
    if (!player) throw new Error('玩家档案不存在');
    const region = this.regionCatalog().find((entry) => entry.id === regionId);
    if (!region) throw new Error('邀约地区不存在');
    if (!(access?.accessible ?? region.unlocked)) {
      throw new Error(access?.unlockCondition || '该地区尚未解锁');
    }
    if (player.level < region.minLevel) {
      throw new Error(`该地区需要玩家等级 Lv.${region.minLevel}`);
    }
    const place = rawPlace.trim();
    if (
      place &&
      !(this.placeCatalog()[region.id] ?? []).some(
        (entry) => entry.name === place,
      )
    ) {
      throw new Error('该地点不属于所选地区');
    }
    const destination = place ? `${region.name} · ${place}` : region.name;
    return {
      message: `已将前往「${destination}」的邀约填入聊天输入框。`,
      prompt: `邀请凯利安前往${destination}`,
      achievement: {
        event: 'caelian.invite',
        success: true,
        region: region.name,
      },
    };
  }

  private async pet(profileId: string): Promise<SocialInteractionOutcome> {
    const social = await this.ensureTrelao(profileId);
    const reaction = pickTrelaoTouchReaction(social.affinity, this.random);
    const magnitude = reaction.direction === 'neutral'
      ? 0
      : 1 + Math.floor(this.random() * 10);
    const requestedDelta = reaction.direction === 'down' ? -magnitude : magnitude;
    const affinity = clampTrelaoAffinity(social.affinity + requestedDelta);
    const appliedDelta = affinity - social.affinity;
    await this.db.socialProgress.put({
      ...social,
      affinity,
      relationshipStage: trelaoStageLabel(affinity),
      mood: reaction.direction === 'down' ? '不满' : reaction.direction === 'up' ? '开心' : '平静',
      updatedAt: Date.now(),
    });
    return {
      message: `${reaction.text}${this.trelaoDeltaText(appliedDelta)}`,
      achievement: {
        event: 'trelao.pet',
        success: true,
        positive: reaction.direction === 'up',
        reaction: reaction.direction,
      },
    };
  }

  private async feed(
    profileId: string,
    itemId: string,
  ): Promise<SocialInteractionOutcome> {
    const stack = await this.ownedStack(profileId, itemId);
    const meta = trelaoFeedMeta(stack.name, this.isConsumable(stack));
    if (!meta.allowed) throw new Error('这个物品不能投喂给特莱奥');
    const badReaction =
      meta.result === 'dislike' &&
      (TRELAO_DISLIKED_ITEMS.has(stack.name) ||
        meta.tags.includes('weird_or_dirty') ||
        this.random() < 0.28);
    const social = await this.ensureTrelao(profileId);
    const magnitude = 1 + Math.floor(this.random() * 10);
    const requestedDelta = meta.result === 'like' ? magnitude : -magnitude;
    const affinity = clampTrelaoAffinity(social.affinity + requestedDelta);
    const appliedDelta = affinity - social.affinity;
    await Promise.all([
      this.consume(stack),
      this.db.socialProgress.put({
        ...social,
        affinity,
        relationshipStage: trelaoStageLabel(affinity),
        mood: meta.result === 'like' ? '满足' : '嫌弃',
        updatedAt: Date.now(),
      }),
    ]);
    const feedback = badReaction
      ? '特莱奥不喜欢吃这个，他被你喂吐了。'
      : pickInteractionFeedback(
          meta.result === 'like'
            ? TRELAO_LIKE_FEEDBACK
            : TRELAO_MILD_DISLIKE_FEEDBACK,
          this.random(),
        ).replaceAll('{item}', stack.name);
    return {
      message: `${feedback}${this.trelaoDeltaText(appliedDelta)}`,
      achievement: {
        event: 'trelao.feed',
        success: true,
        liked: meta.result === 'like',
        category: [meta.category, ...meta.tags].join(' '),
        reaction: badReaction ? '呕吐' : meta.result,
      },
    };
  }

  private async ownedStack(
    profileId: string,
    itemId: string,
  ): Promise<InventoryStackRecord> {
    const stack = await this.db.inventoryStacks.get(`${profileId}:${itemId}`);
    if (!stack || stack.quantity <= 0) throw new Error('背包中没有这个物品');
    return stack;
  }

  private async ensureTrelao(profileId: string) {
    const id = `${profileId}:trelao`;
    const current = await this.db.socialProgress.get(id);
    if (current) return current;
    const created = defaultTrelaoProgress(profileId, Date.now());
    await this.db.socialProgress.put(created);
    return created;
  }

  private consume(stack: InventoryStackRecord): Promise<unknown> {
    if (stack.quantity <= 1) return this.db.inventoryStacks.delete(stack.id);
    return this.db.inventoryStacks.put({
      ...stack,
      quantity: stack.quantity - 1,
      updatedAt: Date.now(),
    });
  }

  private giftPrice(stack: InventoryStackRecord): number {
    const catalog = this.marketCatalog();
    const direct =
      catalog.itemPrices[stack.itemId] ?? catalog.itemPrices[stack.name];
    if (Number(direct) > 0) return Number(direct);
    for (const rows of Object.values(catalog.marketItems)) {
      const item = rows.find(
        (entry) =>
          entry.marketKind !== 'equipment' &&
          entry.marketKind !== 'relic' &&
          (entry.id === stack.itemId || entry.name === stack.name),
      );
      if (item && Number(item.basePrice) > 0) return Number(item.basePrice);
    }
    // The market currently accepts every positive-quantity inventory stack
    // and falls back to a base price of 10 when no explicit price exists.
    // Keep gift eligibility identical to that player-visible sell list.
    return 10;
  }

  private isConsumable(stack: InventoryStackRecord): boolean {
    const items = this.battleItems;
    return Boolean(items?.[stack.itemId] ?? items?.[stack.name]);
  }

  private deltaText(delta: number): string {
    if (delta > 0) return ` +${delta}`;
    if (delta < 0) return ` ${delta}`;
    return '没有变化';
  }

  private trelaoDeltaText(delta: number): string {
    if (delta > 0) return ` 特莱奥好感度 +${delta}。`;
    if (delta < 0) return ` 特莱奥好感度 ${delta}。`;
    return ' 特莱奥好感度没有变化。';
  }

  private marketCatalog(): MarketCatalogs {
    if (!this.markets) throw new Error('互动道具目录尚未加载');
    return this.markets;
  }

  private regionCatalog(): RegionDefinition[] {
    if (!this.regions) throw new Error('互动地区目录尚未加载');
    return this.regions;
  }

  private placeCatalog(): Record<string, RegionPlaceDefinition[]> {
    if (!this.places) throw new Error('互动地点目录尚未加载');
    return this.places;
  }

  private assertPrepared(): void {
    this.marketCatalog();
    this.regionCatalog();
    this.placeCatalog();
    if (!this.battleItems) throw new Error('互动消耗品目录尚未加载');
  }
}
