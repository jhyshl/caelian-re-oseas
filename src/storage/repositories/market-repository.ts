import {
  loadMarketCatalogs,
  type MarketCatalogs,
  type MarketMonsterDefinition,
} from '@/content/catalogs/market';
import type { EquipmentDefinition, RelicDefinition } from '@/content/types';
import type {
  EquipmentInstanceRecord,
  MarketListing,
  MarketListingKind,
  MarketListingTab,
  MarketStateRecord,
  MarketView,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';
import { GLOBAL_ACHIEVEMENT_PROFILE_ID } from '@/achievements/catalog';

interface Candidate {
  key: string;
  kind: MarketListingKind;
  tab: MarketListingTab;
  itemId: string;
  refId?: string;
  name: string;
  rarity: string;
  source: string;
  detail: string;
  stockMin: number;
  stockMax: number;
  basePrice?: number;
  stars?: number;
}

const REGION_STOCK_VERSION = 1;
const COMMON_CARD_BASE_PRICE: Record<string, number> = {
  common: 50,
  uncommon: 90,
  rare: 130,
  epic: 170,
  legendary: 200,
};
const COMMON_CARD_RARITY_WEIGHT: Record<string, number> = {
  common: 40,
  uncommon: 25,
  rare: 20,
  epic: 10,
  legendary: 5,
};
const RARITY_MULTIPLIER: Record<string, number> = {
  common: 1,
  uncommon: 1.35,
  rare: 1.9,
  epic: 2.8,
  legendary: 4.2,
};

export class MarketRepository {
  private catalogs?: MarketCatalogs;

  constructor(
    private readonly db: CaelianDatabase,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {}

  async prepare(): Promise<void> {
    this.catalogs ??= await loadMarketCatalogs();
  }

  async view(profileId: string): Promise<MarketView> {
    await this.prepare();
    const [player, world, inventory, equipment, loadout] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.worldStates.get(profileId),
      this.db.inventoryStacks.where('profileId').equals(profileId).toArray(),
      this.db.equipmentInstances.where('profileId').equals(profileId).toArray(),
      this.db.equipmentLoadouts.get(profileId),
    ]);
    if (!player || !world || !loadout) {
      throw new Error('集市所需的冒险档案尚未初始化');
    }
    const date = this.now();
    const refreshKey = currentMarketSlotKey(date);
    const regionId = this.resolveRegion(world.region, world.location);
    const [regionState, cardState] = await Promise.all([
      this.ensureRegionState(profileId, regionId, refreshKey, player.level),
      this.ensureCardState(profileId, refreshKey),
    ]);
    const listings = [
      ...regionState.inventory.listings,
      ...cardState.inventory.listings,
    ].filter((listing) => listing.stock > 0);
    const sellItems = inventory
      .filter((stack) => stack.quantity > 0)
      .map((stack) => ({
        itemId: stack.itemId,
        name: stack.name,
        quantity: stack.quantity,
        detail: this.catalog().items[stack.itemId]?.desc ?? '',
        price: this.sellItemPrice(stack.itemId, stack.name, regionId, refreshKey),
      }));
    const equipped = new Set(
      [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(Boolean),
    );
    const isMerchant =
      player.classMain === 'merchant' || player.subclass === 'merchant';
    const sellEquipment = isMerchant
      ? equipment
          .filter((entry) => !equipped.has(entry.id))
          .map((entry) => ({
            instanceId: entry.id,
            name: entry.name,
            description: entry.description,
            stars: entry.stars,
            price: this.sellEquipmentPrice(entry, regionId, refreshKey),
          }))
      : [];

    return {
      regionId,
      refreshKey,
      nextRefreshAt: nextMarketRefresh(date).getTime(),
      gold: player.gold,
      isMerchant,
      listings,
      sellItems,
      sellEquipment,
    };
  }

  async buy(
    profileId: string,
    input: { listingKey: string; quantity: number },
  ): Promise<void> {
    this.assertPrepared();
    const [player, world] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.worldStates.get(profileId),
    ]);
    if (!player || !world) throw new Error('集市所需的冒险档案不存在');
    const refreshKey = currentMarketSlotKey(this.now());
    const regionId = this.resolveRegion(world.region, world.location);
    const states = await Promise.all([
      this.ensureRegionState(profileId, regionId, refreshKey, player.level),
      this.ensureCardState(profileId, refreshKey),
    ]);
    const located = states
      .map((state) => ({
        state,
        index: state.inventory.listings.findIndex(
          (listing) => listing.key === input.listingKey,
        ),
      }))
      .find((entry) => entry.index >= 0);
    if (!located) throw new Error('该商品已经不在当前集市');
    const listing = located.state.inventory.listings[located.index];
    if (!listing || listing.stock <= 0) throw new Error('该商品已经售罄');
    const quantity =
      listing.kind === 'item'
        ? Math.min(listing.stock, Math.max(1, Math.floor(input.quantity)))
        : 1;
    const fullPrice = listing.price * quantity;
    if (player.gold < fullPrice) throw new Error('金币不足');
    const silverForkDiscount = await this.rollSilverForkDiscount(
      profileId,
      listing,
    );
    const totalPrice = silverForkDiscount
      ? Math.max(1, Math.ceil(fullPrice * 0.5))
      : fullPrice;

    if (listing.kind === 'item') {
      await this.addItem(
        profileId,
        listing.itemId,
        listing.name,
        quantity,
      );
    } else if (listing.kind === 'equipment') {
      await this.addEquipment(profileId, listing);
    } else if (listing.kind === 'relic') {
      await this.addRelic(profileId, listing);
    } else {
      await this.addCard(profileId, listing);
    }

    const now = Date.now();
    listing.stock -= quantity;
    located.state.updatedAt = now;
    await Promise.all([
      this.db.playerStates.put({
        ...player,
        gold: player.gold - totalPrice,
        updatedAt: now,
      }),
      this.db.marketStates.put(located.state),
    ]);
  }

  async sellItem(
    profileId: string,
    input: { itemId: string; quantity: number },
  ): Promise<void> {
    this.assertPrepared();
    const [player, world, stack] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.worldStates.get(profileId),
      this.db.inventoryStacks.get(`${profileId}:${input.itemId}`),
    ]);
    if (!player || !world) throw new Error('集市所需的冒险档案不存在');
    if (!stack || stack.quantity <= 0) throw new Error('背包中没有该物品');
    const quantity = Math.min(
      stack.quantity,
      Math.max(1, Math.floor(input.quantity)),
    );
    const refreshKey = currentMarketSlotKey(this.now());
    const regionId = this.resolveRegion(world.region, world.location);
    const gain =
      this.sellItemPrice(input.itemId, stack.name, regionId, refreshKey) *
      quantity;
    const nextQuantity = stack.quantity - quantity;
    const now = Date.now();
    await this.db.playerStates.put({
      ...player,
      gold: player.gold + gain,
      updatedAt: now,
    });
    if (nextQuantity <= 0) {
      await this.db.inventoryStacks.delete(stack.id);
    } else {
      await this.db.inventoryStacks.put({
        ...stack,
        quantity: nextQuantity,
        updatedAt: now,
      });
    }
  }

  async sellEquipment(profileId: string, instanceId: string): Promise<void> {
    this.assertPrepared();
    const [player, world, loadout, equipment] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.worldStates.get(profileId),
      this.db.equipmentLoadouts.get(profileId),
      this.db.equipmentInstances.get(instanceId),
    ]);
    if (!player || !world || !loadout) {
      throw new Error('集市所需的冒险档案不存在');
    }
    if (
      player.classMain !== 'merchant' &&
      player.subclass !== 'merchant'
    ) {
      throw new Error('只有商人职业可以出售装备');
    }
    if (!equipment || equipment.profileId !== profileId) {
      throw new Error('装备实例不存在');
    }
    if (
      [loadout.weaponId, loadout.armorId, loadout.accessoryId].includes(
        instanceId,
      )
    ) {
      throw new Error('请先卸下装备');
    }
    const refreshKey = currentMarketSlotKey(this.now());
    const regionId = this.resolveRegion(world.region, world.location);
    const gain = this.sellEquipmentPrice(
      equipment,
      regionId,
      refreshKey,
    );
    const now = Date.now();
    await Promise.all([
      this.db.equipmentInstances.delete(instanceId),
      this.db.playerStates.put({
        ...player,
        gold: player.gold + gain,
        updatedAt: now,
      }),
    ]);
  }

  private async ensureRegionState(
    profileId: string,
    regionId: string,
    refreshKey: string,
    level: number,
  ): Promise<MarketStateRecord> {
    const id = `${profileId}:market:${regionId}`;
    const current = await this.db.marketStates.get(id);
    if (
      current?.refreshKey === refreshKey &&
      current.inventory?.version === REGION_STOCK_VERSION
    ) {
      return current;
    }
    const candidates = [
      ...this.buildSpecialties(regionId),
      ...(await this.buildGearAndRelics(
        profileId,
        regionId,
        refreshKey,
        level,
      )),
      ...this.buildLootAndCraft(regionId, refreshKey),
    ];
    const now = Date.now();
    const state: MarketStateRecord = {
      id,
      profileId,
      regionId,
      refreshKey,
      inventory: {
        version: 1,
        listings: candidates.map((candidate) =>
          this.toListing(candidate, regionId, refreshKey),
        ),
      },
      updatedAt: now,
    };
    await this.db.marketStates.put(state);
    return state;
  }

  private async ensureCardState(
    profileId: string,
    refreshKey: string,
  ): Promise<MarketStateRecord> {
    const id = `${profileId}:market:common-cards`;
    const current = await this.db.marketStates.get(id);
    if (
      current?.refreshKey === refreshKey &&
      current.inventory?.version === REGION_STOCK_VERSION
    ) {
      return current;
    }
    const candidates: Candidate[] = [];
    for (let index = 0; index < 10; index += 1) {
      const cardId = this.weightedCommonCardId(refreshKey, index);
      const card = this.catalog().commonCards[cardId];
      if (!card) continue;
      candidates.push({
        key: `common-card:${refreshKey}:${index}:${cardId}`,
        kind: 'card',
        tab: 'cards',
        itemId: cardId,
        refId: cardId,
        name: card.name,
        rarity: card.rarity || 'common',
        source: '通用卡牌',
        detail: this.cardDetail(card),
        stockMin: 1,
        stockMax: 1,
      });
    }
    const state: MarketStateRecord = {
      id,
      profileId,
      regionId: '__common_cards__',
      refreshKey,
      inventory: {
        version: 1,
        listings: candidates.map((candidate) =>
          this.toListing(candidate, 'all-regions', refreshKey),
        ),
      },
      updatedAt: Date.now(),
    };
    await this.db.marketStates.put(state);
    return state;
  }

  private buildSpecialties(regionId: string): Candidate[] {
    const rows =
      this.catalog().marketItems[regionId] ??
      this.catalog().marketItems['伊拉亚城'] ??
      [];
    return rows
      .filter(
        (row) =>
          row.marketKind !== 'equipment' && row.marketKind !== 'relic',
      )
      .map((row) => ({
        key: `specialty:${row.name}`,
        kind: 'item',
        tab: 'specialty',
        itemId: row.name,
        name: row.name,
        rarity: row.rarity || 'common',
        source: '区域特产',
        detail: this.catalog().items[row.name]?.desc ?? '',
        stockMin: row.stockMin * 50,
        stockMax: row.stockMax * 50,
        basePrice: row.basePrice,
      }));
  }

  private async buildGearAndRelics(
    profileId: string,
    regionId: string,
    refreshKey: string,
    level: number,
  ): Promise<Candidate[]> {
    const [equipmentInventory, ownedRelics] = await Promise.all([
      this.db.equipmentInstances.where('profileId').equals(profileId).toArray(),
      this.db.ownedRelics.where('profileId').equals(profileId).toArray(),
    ]);
    const ownedThreeStar = new Set(
      equipmentInventory
        .filter((entry) => entry.stars >= 3)
        .map((entry) => entry.baseId),
    );
    const ownedRelicIds = new Set(
      ownedRelics.map((entry) => entry.relicId),
    );
    const candidates: Candidate[] = [];
    for (const equipment of Object.values(this.catalog().equipment)) {
      if (ownedThreeStar.has(equipment.id)) continue;
      const chance =
        {
          common: 0.18,
          uncommon: 0.13,
          rare: 0.08,
          epic: 0.04,
          legendary: 0.018,
        }[equipment.rarity || 'common'] ?? 0.08;
      if (
        seededRandom(`${refreshKey}:${regionId}:eq:${equipment.id}`) >=
        chance
      ) {
        continue;
      }
      const stars = starForLevel(
        level,
        `${refreshKey}:${regionId}:eqstar:${equipment.id}`,
      );
      const stats = scaleStats(equipment.stats, stars);
      candidates.push({
        key: `equipment:${equipment.id}:s${stars}`,
        kind: 'equipment',
        tab: 'gear',
        itemId: equipment.id,
        refId: equipment.id,
        name: `${equipment.name} ${starText(stars)}`,
        rarity: equipment.rarity || 'common',
        source: '装备',
        detail: this.equipmentDetail(equipment, stars, stats),
        stockMin: 1,
        stockMax: 1,
        stars,
      });
    }
    for (const [relicId, relic] of Object.entries(this.catalog().relics)) {
      if (
        ownedRelicIds.has(relicId) ||
        relic.mainQuestOnly ||
        relic.source === 'special_patch'
      ) {
        continue;
      }
      const rarity = String(relic.rarity || 'rare');
      const chance =
        {
          common: 0.08,
          uncommon: 0.06,
          rare: 0.04,
          epic: 0.022,
          legendary: 0.01,
        }[rarity] ?? 0.035;
      if (
        seededRandom(`${refreshKey}:${regionId}:relic:${relicId}`) >=
        chance
      ) {
        continue;
      }
      candidates.push({
        key: `relic:${relicId}`,
        kind: 'relic',
        tab: 'gear',
        itemId: relicId,
        refId: relicId,
        name: relic.name,
        rarity,
        source: '藏品',
        detail: relic.description,
        stockMin: 1,
        stockMax: 1,
      });
    }
    return candidates.slice(0, 12);
  }

  private buildLootAndCraft(
    regionId: string,
    refreshKey: string,
  ): Candidate[] {
    const candidates: Candidate[] = [];
    const add = (
      name: string,
      rarity = 'common',
      stockMin = 1,
      stockMax = 4,
      source = '材料',
    ) => {
      if (!name) return;
      candidates.push({
        key: `loot:${name}`,
        kind: 'item',
        tab: 'loot',
        itemId: name,
        name,
        rarity,
        source,
        detail: this.catalog().items[name]?.desc ?? '',
        stockMin,
        stockMax,
      });
    };
    for (const name of this.catalog().gatherByRegion[regionId] ?? []) {
      const definition = this.catalog().gatherResources[name];
      const rarity = definition?.rarity ?? 'common';
      const chance =
        { common: 0.7, uncommon: 0.45, rare: 0.25, epic: 0.1 }[
          rarity
        ] ?? 0.5;
      if (
        seededRandom(`${refreshKey}:${regionId}:gather:${name}`) <
        chance
      ) {
        add(
          name,
          rarity,
          1,
          definition?.category === 'consumable' ? 3 : 6,
          '采集物',
        );
      }
    }
    for (const monster of Object.values(this.catalog().monsters)) {
      if (!this.monsterMatchesRegion(monster, regionId)) continue;
      const info = difficultyInfo(monster.difficulty);
      for (const loot of monster.loot ?? []) {
        const name = loot.name || loot.id || '';
        const chance = info.chance * Number(loot.chance ?? 0.5);
        if (
          seededRandom(
            `${refreshKey}:${regionId}:loot:${monster.id}:${name}`,
          ) < chance
        ) {
          add(
            name,
            difficultyRarity(monster.difficulty),
            info.stock[0],
            info.stock[1],
            `${monster.name || monster.id}掉落`,
          );
        }
      }
    }
    for (const recipe of this.catalog().recipes) {
      const price = Number(recipe.basePrice ?? 0);
      const rarity =
        price > 1000
          ? 'epic'
          : price > 450
            ? 'rare'
            : price > 180
              ? 'uncommon'
              : 'common';
      const chance =
        { common: 0.22, uncommon: 0.14, rare: 0.07, epic: 0.025 }[
          rarity
        ] ?? 0.025;
      const name = recipe.output || recipe.name;
      if (
        seededRandom(`${refreshKey}:${regionId}:craft:${name}`) < chance
      ) {
        add(name, rarity, 1, rarity === 'common' ? 3 : 1, '合成物');
      }
    }
    const seen = new Set<string>();
    return candidates
      .filter((candidate) => {
        if (seen.has(candidate.name)) return false;
        seen.add(candidate.name);
        return true;
      })
      .slice(0, 24);
  }

  private toListing(
    candidate: Candidate,
    regionId: string,
    refreshKey: string,
  ): MarketListing {
    const basePrice = this.basePrice(candidate);
    const factor = marketFactor(candidate.key, regionId, refreshKey);
    const stock =
      candidate.kind === 'item'
        ? stockFor(candidate, regionId, refreshKey)
        : 1;
    return {
      key: candidate.key,
      kind: candidate.kind,
      tab: candidate.tab,
      itemId: candidate.itemId,
      ...(candidate.refId ? { refId: candidate.refId } : {}),
      name: candidate.name,
      rarity: candidate.rarity,
      source: candidate.source,
      detail: candidate.detail,
      stock,
      basePrice,
      price: Math.max(1, Math.round(basePrice * factor)),
      factor,
      ...(candidate.stars ? { stars: candidate.stars } : {}),
    };
  }

  private basePrice(candidate: Candidate): number {
    if (candidate.kind === 'equipment') {
      const definition = this.catalog().equipment[candidate.refId ?? ''];
      return definition
        ? equipmentPrice(definition, candidate.stars ?? 1)
        : 100;
    }
    if (candidate.kind === 'relic') {
      return relicPrice(this.catalog().relics[candidate.refId ?? '']);
    }
    if (candidate.kind === 'card') {
      return COMMON_CARD_BASE_PRICE[candidate.rarity] ?? 50;
    }
    return (
      candidate.basePrice ??
      this.catalog().itemPrices[candidate.itemId] ??
      10
    );
  }

  private async addItem(
    profileId: string,
    itemId: string,
    name: string,
    quantity: number,
  ): Promise<void> {
    const id = `${profileId}:${itemId}`;
    const current = await this.db.inventoryStacks.get(id);
    await this.db.inventoryStacks.put({
      id,
      profileId,
      itemId,
      name,
      quantity: (current?.quantity ?? 0) + quantity,
      updatedAt: Date.now(),
    });
  }

  private async addEquipment(
    profileId: string,
    listing: MarketListing,
  ): Promise<void> {
    const definition = this.catalog().equipment[listing.refId ?? ''];
    if (!definition) throw new Error('装备库中不存在该商品');
    const hasThreeStar = await this.db.equipmentInstances
      .where('profileId')
      .equals(profileId)
      .filter(
        (entry) => entry.baseId === definition.id && entry.stars >= 3,
      )
      .count();
    if (hasThreeStar > 0) {
      throw new Error('已经拥有该装备的三星版本，无法继续购买同名装备');
    }
    const stars = listing.stars ?? 1;
    const suffix = uniqueSuffix();
    await this.db.equipmentInstances.add({
      id: `${profileId}:${definition.id}:s${stars}:${suffix}`,
      profileId,
      baseId: definition.id,
      name: `${definition.name} ${starText(stars)}`,
      slot: definition.slot,
      rarity: definition.rarity,
      stars,
      stats: scaleStats(definition.stats, stars),
      description: `${definition.description}（${starText(stars)}${
        stars > 1 ? '，属性已提升' : ''
      }）`,
      updatedAt: Date.now(),
    });
  }

  private async rollSilverForkDiscount(
    profileId: string,
    listing: MarketListing,
  ): Promise<boolean> {
    if (listing.kind !== 'item' || listing.tab !== 'specialty') return false;
    const silverFork = await this.db.ownedRelics.get(
      `${profileId}:special_silver_fork`,
    );
    if (!silverFork) return false;
    const key = 'market.silverForkDiscountMisses';
    const id = `${GLOBAL_ACHIEVEMENT_PROFILE_ID}:${key}`;
    const current = await this.db.achievementCounters.get(id);
    const misses = Math.max(0, Math.floor(current?.value ?? 0));
    const hit = misses >= 9 || this.random() < 0.2;
    await this.db.achievementCounters.put({
      id,
      profileId: GLOBAL_ACHIEVEMENT_PROFILE_ID,
      key,
      value: hit ? 0 : misses + 1,
      data: {
        lastTriggered: hit,
        guaranteed: hit && misses >= 9,
      },
      updatedAt: Date.now(),
    });
    return hit;
  }

  private async addRelic(
    profileId: string,
    listing: MarketListing,
  ): Promise<void> {
    const relicId = listing.refId ?? listing.itemId;
    if (!this.catalog().relics[relicId]) {
      throw new Error('藏品库中不存在该商品');
    }
    const id = `${profileId}:${relicId}`;
    if (await this.db.ownedRelics.get(id)) throw new Error('该藏品已经拥有');
    const carriedCount = await this.db.ownedRelics
      .where('profileId')
      .equals(profileId)
      .filter((entry) => entry.carried)
      .count();
    const now = Date.now();
    await this.db.ownedRelics.add({
      id,
      profileId,
      relicId,
      carried: carriedCount < 5,
      acquiredAt: now,
      updatedAt: now,
    });
  }

  private async addCard(
    profileId: string,
    listing: MarketListing,
  ): Promise<void> {
    const cardId = listing.refId ?? listing.itemId;
    if (!this.catalog().commonCards[cardId]) {
      throw new Error('卡牌库中不存在该商品');
    }
    const id = `${profileId}:${cardId}`;
    const current = await this.db.ownedCards.get(id);
    await this.db.ownedCards.put({
      id,
      profileId,
      cardId,
      quantity: (current?.quantity ?? 0) + 1,
      source: current?.source ?? 'market',
      updatedAt: Date.now(),
    });
  }

  private sellItemPrice(
    itemId: string,
    name: string,
    regionId: string,
    refreshKey: string,
  ): number {
    const basePrice =
      this.catalog().itemPrices[itemId] ??
      this.catalog().itemPrices[name] ??
      10;
    return Math.max(
      1,
      Math.round(
        basePrice * marketFactor(`sell:${name}`, regionId, refreshKey),
      ),
    );
  }

  private sellEquipmentPrice(
    equipment: EquipmentInstanceRecord,
    regionId: string,
    refreshKey: string,
  ): number {
    const stats = Object.values(equipment.stats).reduce(
      (total, value) => total + Math.max(0, Number(value || 0)),
      0,
    );
    const base = Math.max(
      80,
      Math.round(
        (120 + stats * 42) *
          rarityMultiplier(equipment.rarity) *
          (1 + (equipment.stars - 1) * 0.85),
      ),
    );
    return Math.max(
      1,
      Math.round(
        base *
          0.7 *
          marketFactor(
            `selleq:${equipment.id}`,
            regionId,
            refreshKey,
          ),
      ),
    );
  }

  private weightedCommonCardId(refreshKey: string, index: number): string {
    const entries = Object.entries(this.catalog().commonCards);
    const total = entries.reduce(
      (sum, [, card]) =>
        sum + Math.max(1, COMMON_CARD_RARITY_WEIGHT[card.rarity] ?? 1),
      0,
    );
    let roll =
      seededRandom(`${refreshKey}:common-card:${index}:roll`) * total;
    for (const [id, card] of entries) {
      roll -= Math.max(
        1,
        COMMON_CARD_RARITY_WEIGHT[card.rarity] ?? 1,
      );
      if (roll <= 0) return id;
    }
    return entries.at(-1)?.[0] ?? '';
  }

  private resolveRegion(region: string, location: string): string {
    const known = Object.keys(this.catalog().marketItems);
    if (known.includes(region)) return region;
    const combined = `${region} ${location}`;
    return (
      known.find((candidate) => combined.includes(candidate)) ??
      (known.includes('伊拉亚城') ? '伊拉亚城' : known[0] ?? '伊拉亚城')
    );
  }

  private monsterMatchesRegion(
    monster: MarketMonsterDefinition,
    regionId: string,
  ): boolean {
    const regions = monster.regions ?? monster.region ?? [];
    if (
      (Array.isArray(regions) && regions.length === 0) ||
      (!Array.isArray(regions) && !regions)
    ) {
      return true;
    }
    return JSON.stringify(regions).includes(regionId);
  }

  private equipmentDetail(
    equipment: EquipmentDefinition,
    stars: number,
    stats: Record<string, number>,
  ): string {
    const statText = Object.entries(stats)
      .map(([key, value]) => `${key}+${value}`)
      .join('、');
    return [
      `${equipment.description}（${starText(stars)}${
        stars > 1 ? '，属性已提升' : ''
      }）`,
      statText ? `词条：${statText}` : '',
    ]
      .filter(Boolean)
      .join('｜');
  }

  private cardDetail(card: {
    type: string;
    cost: number;
    mpCost?: number;
    brief?: string;
    description: string;
  }): string {
    const type =
      card.type === 'attack'
        ? '攻击'
        : card.type === 'defense'
          ? '防御'
          : '技能';
    const mp = Number(card.mpCost || 0) > 0 ? ` / MP ${card.mpCost}` : '';
    return `${type}｜AP ${card.cost}${mp}｜${
      card.brief || card.description
    }`;
  }

  private catalog(): MarketCatalogs {
    const catalogs = this.catalogs;
    if (!catalogs) throw new Error('集市数据库尚未加载');
    return catalogs;
  }

  private assertPrepared(): void {
    if (!this.catalogs) throw new Error('集市数据库尚未加载');
  }
}

export function currentMarketSlotKey(date = new Date()): string {
  const slots = [8, 12, 16, 20];
  if (date.getHours() < 8) {
    const previous = new Date(date.getTime() - 86_400_000);
    return `${previous.getFullYear()}-${previous.getMonth() + 1}-${previous.getDate()}-20`;
  }
  let hour = slots[0];
  for (const slot of slots) {
    if (date.getHours() >= slot) hour = slot;
  }
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${hour}`;
}

export function nextMarketRefresh(date = new Date()): Date {
  const current = new Date(date);
  for (const hour of [8, 12, 16, 20]) {
    if (current.getHours() < hour) {
      current.setHours(hour, 0, 0, 0);
      return current;
    }
  }
  current.setDate(current.getDate() + 1);
  current.setHours(8, 0, 0, 0);
  return current;
}

function seededRandom(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 100_000) / 100_000;
}

function marketFactor(key: string, regionId: string, refreshKey: string) {
  return Math.max(
    0.5,
    Math.min(
      1.8,
      0.55 +
        seededRandom(`${refreshKey}:${regionId}:${key}:price`) * 1.25,
    ),
  );
}

function stockFor(
  candidate: Candidate,
  regionId: string,
  refreshKey: string,
): number {
  const roll = seededRandom(
    `${refreshKey}:${regionId}:${candidate.key}:stock`,
  );
  const scale = candidate.tab === 'loot' ? 10 : 1;
  const minimum =
    Math.max(1, Number(candidate.stockMin || 1)) * scale;
  const maximum = Math.max(
    minimum,
    Number(candidate.stockMax || candidate.stockMin || 1) * scale,
  );
  return Math.floor(minimum + roll * (maximum - minimum + 1));
}

function rarityMultiplier(rarity: string): number {
  return RARITY_MULTIPLIER[rarity] ?? 1;
}

function starForLevel(level = 1, seed = ''): number {
  const normalizedLevel = Math.max(1, Number(level || 1));
  const one = Math.max(24, 108 - normalizedLevel * 3.2);
  const two = 12 + normalizedLevel * 2.4;
  const three = 1 + Math.max(0, normalizedLevel - 5) * 1.65;
  let roll = seededRandom(seed) * (one + two + three);
  if (roll <= one) return 1;
  roll -= one;
  if (roll <= two) return 2;
  return 3;
}

function starText(stars: number): string {
  const value = Math.max(1, Math.min(3, Number(stars || 1)));
  return `${'★'.repeat(value)}${'☆'.repeat(3 - value)}`;
}

function scaleStats(
  stats: Record<string, number>,
  stars: number,
): Record<string, number> {
  const multiplier = { 1: 1, 2: 1.45, 3: 2 }[stars] ?? 1;
  return Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [
      key,
      Math.max(1, Math.round(Number(value || 0) * multiplier)),
    ]),
  );
}

function equipmentPrice(
  equipment: EquipmentDefinition,
  stars: number,
): number {
  const stats = Object.values(scaleStats(equipment.stats, stars)).reduce(
    (total, value) => total + Math.max(0, Number(value || 0)),
    0,
  );
  return Math.max(
    80,
    Math.round(
      (120 + stats * 42) *
        rarityMultiplier(equipment.rarity) *
        (1 + (stars - 1) * 0.85),
    ),
  );
}

function relicPrice(relic: RelicDefinition | undefined): number {
  if (!relic) return 200;
  const description = String(relic.description || '');
  const clauses = (description.match(/[，；、;+]/g) ?? []).length + 1;
  const strong =
    /额外|翻倍|免疫|每回合|抽|AP|魔力|伤害|护盾|治疗|金币|经验/.test(
      description,
    )
      ? 1.3
      : 1;
  return Math.max(
    160,
    Math.round(
      (160 + clauses * 90) *
        rarityMultiplier(String(relic.rarity || 'rare')) *
        strong,
    ),
  );
}

function difficultyInfo(difficulty?: string): {
  chance: number;
  stock: [number, number];
} {
  return (
    {
      easy: { chance: 0.42, stock: [3, 8] as [number, number] },
      normal: { chance: 0.28, stock: [2, 5] as [number, number] },
      hard: { chance: 0.16, stock: [1, 3] as [number, number] },
      nightmare: { chance: 0.08, stock: [1, 2] as [number, number] },
    }[String(difficulty || 'normal')] ?? {
      chance: 0.24,
      stock: [1, 4],
    }
  );
}

function difficultyRarity(difficulty?: string): string {
  if (difficulty === 'nightmare') return 'epic';
  if (difficulty === 'hard') return 'rare';
  if (difficulty === 'normal') return 'uncommon';
  return 'common';
}

function uniqueSuffix(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;
  }
}
