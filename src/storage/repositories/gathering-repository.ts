import {
  loadGatheringCatalog,
  type GatheringCatalog,
} from '@/content/catalogs/gathering';
import type {
  GatheringAction,
  GatheringItem,
  GatheringState,
  GatheringStockItem,
  GatheringView,
  InventoryStackRecord,
  WorldStateRecord,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';

export interface GatheringRepositoryOptions {
  now?: () => Date;
}

const STATE_VERSION = 1 as const;
const SEARCHABLE_RESOURCES = new Set([
  '空玻璃瓶',
  '魔法粉尘',
  '帕德里湖水珠',
  '祈祷绷带',
  '潮汐贝壳',
  '蓝珊瑚碎',
  '煤晶粉',
  '铜齿轮',
  '蒸汽冷凝水',
  '血蔷薇花瓣',
  '金鳞砂',
  '黑潮残片',
  '海渊盐晶',
]);

export class GatheringRepository {
  private catalog?: GatheringCatalog;
  private readonly now: () => Date;

  constructor(
    private readonly db: CaelianDatabase,
    options: GatheringRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async prepare(): Promise<void> {
    this.catalog ??= await loadGatheringCatalog();
  }

  async view(profileId: string): Promise<GatheringView> {
    await this.prepare();
    return this.db.transaction(
      'rw',
      [
        this.db.worldStates,
        this.db.gatheringStates,
        this.db.inventoryStacks,
      ],
      async () => {
        const [world, inventory] = await Promise.all([
          this.db.worldStates.get(profileId),
          this.db.inventoryStacks
            .where('profileId')
            .equals(profileId)
            .toArray(),
        ]);
        if (!world) throw new Error('采集所需的世界状态尚未初始化');

        const date = this.now();
        const refreshKey = gatheringDayKey(date);
        const regionId = this.resolveRegion(world);
        const availableRegion = this.hasRegion(regionId);
        if (!availableRegion) {
          return {
            regionId,
            location: world.location,
            refreshKey,
            nextRefreshAt: nextGatheringRefresh(date).getTime(),
            availableRegion: false,
            items: [],
          };
        }

        const state = await this.ensureState(
          profileId,
          regionId,
          refreshKey,
        );
        return {
          regionId,
          location: world.location,
          refreshKey: state.refreshKey,
          nextRefreshAt: Math.max(
            nextGatheringRefresh(date).getTime(),
            nextRefreshAfterDayKey(state.refreshKey).getTime(),
          ),
          availableRegion: true,
          items: state.items.flatMap((item) => {
            const definition = this.catalog?.resources[item.itemId];
            if (!definition) return [];
            const action = gatheringAction(item.itemId);
            return [
              {
                listingKey: item.listingKey,
                itemId: item.itemId,
                name: definition.name,
                description: definition.desc,
                category: definition.category ?? 'material',
                rarity: definition.rarity ?? 'common',
                action,
                actionLabel: action === 'search' ? '搜寻拾取' : '采集',
                initialStock: item.initialStock,
                remaining: item.remaining,
                ownedCount: ownedQuantity(
                  inventory,
                  item.itemId,
                  definition.name,
                ),
              } satisfies GatheringItem,
            ];
          }),
        };
      },
    );
  }

  async collect(
    profileId: string,
    input: { listingKey: string; quantity: number },
  ): Promise<void> {
    await this.prepare();
    const listingKey = String(input.listingKey ?? '').trim();
    const quantity = Number(input.quantity);
    if (!listingKey) throw new Error('请选择要采集的资源');
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('采集数量必须是正整数');
    }

    await this.db.transaction(
      'rw',
      [
        this.db.worldStates,
        this.db.gatheringStates,
        this.db.inventoryStacks,
      ],
      async () => {
        const refreshKey = gatheringDayKey(this.now());
        const world = await this.db.worldStates.get(profileId);
        if (!world) throw new Error('采集所需的世界状态尚未初始化');
        const regionId = this.resolveRegion(world);
        if (!this.hasRegion(regionId)) {
          throw new Error('当前区域没有可采集或拾取的特产');
        }

        const state = await this.ensureState(
          profileId,
          regionId,
          refreshKey,
        );
        const item = state.items.find(
          (candidate) => candidate.listingKey === listingKey,
        );
        if (!item) {
          throw new Error('当前地区或资源库存已经刷新，请重新选择');
        }
        const definition = this.catalog?.resources[item.itemId];
        const allowed = this.catalog?.itemsByRegion[regionId]?.includes(
          item.itemId,
        );
        if (!definition || !allowed) {
          throw new Error('该资源不属于当前地区的真实物品库');
        }
        if (quantity > item.remaining) {
          throw new Error(`库存不足，当前只剩 ${item.remaining} 个`);
        }

        const now = Date.now();
        item.remaining -= quantity;
        state.updatedAt = now;
        const stackId = `${profileId}:${item.itemId}`;
        const current = await this.db.inventoryStacks.get(stackId);
        const stack: InventoryStackRecord = {
          id: stackId,
          profileId,
          itemId: item.itemId,
          name: definition.name,
          quantity: (current?.quantity ?? 0) + quantity,
          updatedAt: now,
        };
        await Promise.all([
          this.db.gatheringStates.put(state),
          this.db.inventoryStacks.put(stack),
        ]);
      },
    );
  }

  private async ensureState(
    profileId: string,
    regionId: string,
    refreshKey: string,
  ): Promise<GatheringState> {
    const id = `${profileId}:gathering:${regionId}`;
    const current = await this.db.gatheringStates.get(id);
    if (
      current?.version === STATE_VERSION &&
      current.refreshKey >= refreshKey
    ) {
      return current;
    }

    const itemIds = this.catalog?.itemsByRegion[regionId] ?? [];
    const items = itemIds.map((itemId) => {
      const initialStock = gatheringStock(
        `${profileId}:${regionId}:${refreshKey}:${itemId}`,
      );
      return {
        listingKey: gatheringListingKey(
          `${profileId}:${regionId}:${refreshKey}:${itemId}`,
        ),
        itemId,
        initialStock,
        remaining: initialStock,
      } satisfies GatheringStockItem;
    });
    const state: GatheringState = {
      id,
      profileId,
      regionId,
      refreshKey,
      version: STATE_VERSION,
      items,
      updatedAt: Date.now(),
    };
    await this.db.gatheringStates.put(state);
    return state;
  }

  private resolveRegion(world: WorldStateRecord): string {
    return String(world.region ?? '').trim();
  }

  private hasRegion(regionId: string): boolean {
    return Boolean(
      regionId &&
        Object.prototype.hasOwnProperty.call(
          this.catalog?.itemsByRegion ?? {},
          regionId,
        ),
    );
  }
}

export function gatheringDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nextGatheringRefresh(date = new Date()): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function nextRefreshAfterDayKey(dayKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return new Date(0);
  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(5, 7));
  const day = Number(dayKey.slice(8, 10));
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function gatheringAction(itemId: string): GatheringAction {
  return SEARCHABLE_RESOURCES.has(itemId) ? 'search' : 'gather';
}

function gatheringStock(seed: string): number {
  return 10 + Math.floor(seededRandom(`${seed}:stock`) * 11);
}

function gatheringListingKey(seed: string): string {
  return `gathering:${seedHash(`${seed}:listing`).toString(36)}`;
}

function seededRandom(seed: string): number {
  return (seedHash(seed) % 100_000) / 100_000;
}

function seedHash(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function ownedQuantity(
  inventory: InventoryStackRecord[],
  itemId: string,
  name: string,
): number {
  return inventory.reduce(
    (total, stack) =>
      stack.itemId === itemId || stack.name === name
        ? total + Math.max(0, stack.quantity)
        : total,
    0,
  );
}
