import {
  loadCraftingRecipes,
  type CraftingRecipeDefinition,
} from '@/content/catalogs/crafting';
import { loadEquipmentDefinitions } from '@/content/catalogs/inventory';
import type { EquipmentDefinition } from '@/content/types';
import type {
  EquipmentInstanceRecord,
  EquipmentLoadoutRecord,
  EquipmentSlot,
  InventoryStackRecord,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';

const STAR_MULTIPLIER: Record<number, number> = {
  1: 1,
  2: 1.45,
  3: 2,
};
const STAT_NAMES: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  speed: '速度',
  hp: '生命',
  hp_max: '生命上限',
  hpMax: '生命上限',
  mp: '魔力',
  mp_max: '魔力上限',
  mpMax: '魔力上限',
  ap_per_turn: '每回合AP',
  action_points: '行动点',
  actionPointsPerTurn: '每回合行动点',
  draw: '抽牌',
  drawPerTurn: '每回合抽牌',
};

export interface EquipmentMergeResult {
  instanceId: string;
  stars: 2 | 3;
  inheritedSlot: EquipmentSlot | null;
}

export class CraftingRepository {
  private recipes?: Map<string, CraftingRecipeDefinition>;
  private equipment?: Record<string, EquipmentDefinition>;

  constructor(private readonly db: CaelianDatabase) {}

  async prepare(): Promise<void> {
    const [recipes, equipment] = await Promise.all([
      loadCraftingRecipes(),
      loadEquipmentDefinitions(),
    ]);
    this.recipes ??= new Map(recipes.map((recipe) => [recipe.id, recipe]));
    this.equipment ??= equipment;
  }

  async craftItem(
    profileId: string,
    recipeId: string,
    count: number,
  ): Promise<void> {
    const recipe = this.requireRecipe(recipeId);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('合成数量必须是大于 0 的整数');
    }

    await this.db.transaction('rw', this.db.inventoryStacks, async () => {
      const stacks = await this.db.inventoryStacks
        .where('profileId')
        .equals(profileId)
        .toArray();
      const consumptions = this.planMaterialConsumption(stacks, recipe, count);
      const now = Date.now();

      for (const consumption of consumptions) {
        const quantity = consumption.stack.quantity - consumption.quantity;
        if (quantity === 0) {
          await this.db.inventoryStacks.delete(consumption.stack.id);
        } else {
          await this.db.inventoryStacks.put({
            ...consumption.stack,
            quantity,
            updatedAt: now,
          });
        }
      }

      const outputId = `${profileId}:${recipe.output}`;
      const output = await this.db.inventoryStacks.get(outputId);
      await this.db.inventoryStacks.put({
        id: outputId,
        profileId,
        itemId: recipe.output,
        name: recipe.output,
        quantity: (output?.quantity ?? 0) + recipe.count * count,
        updatedAt: now,
      });
    });
  }

  async mergeEquipment(
    profileId: string,
    baseId: string,
    stars: number,
  ): Promise<EquipmentMergeResult> {
    if (!Number.isInteger(stars) || stars < 1 || stars >= 3) {
      throw new Error('三星装备已达到最高星级');
    }

    return this.db.transaction(
      'rw',
      [this.db.equipmentInstances, this.db.equipmentLoadouts],
      async () => {
        const loadout = await this.db.equipmentLoadouts.get(profileId);
        if (!loadout) throw new Error('装备栏不存在');
        const equippedIds = new Set(
          [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(
            (id): id is string => Boolean(id),
          ),
        );
        const matches = await this.db.equipmentInstances
          .where('profileId')
          .equals(profileId)
          .filter((entry) => entry.baseId === baseId && entry.stars === stars)
          .toArray();
        matches.sort(
          (left, right) =>
            Number(equippedIds.has(left.id)) - Number(equippedIds.has(right.id)),
        );
        if (matches.length < 3) {
          throw new Error(`需要 3 件同名 ${stars} 星装备才能升星`);
        }

        const consumed = matches.slice(0, 3);
        const equipped = consumed.find((entry) => equippedIds.has(entry.id));
        const source = consumed[0]!;
        const nextStars = (stars + 1) as 2 | 3;
        const now = Date.now();
        const instanceId = `${profileId}:${baseId}:${nextStars}:${this.randomId()}`;
        const stats = this.scaledStats(source, stars, nextStars);
        const created: EquipmentInstanceRecord = {
          ...source,
          id: instanceId,
          stars: nextStars,
          stats,
          description: Object.entries(stats)
            .map(
              ([key, value]) =>
                `${STAT_NAMES[key] ?? key}${value >= 0 ? '+' : ''}${value}`,
            )
            .join('，'),
          updatedAt: now,
        };

        await this.db.equipmentInstances.bulkDelete(
          consumed.map((entry) => entry.id),
        );
        await this.db.equipmentInstances.add(created);

        const inheritedSlot = equipped?.slot ?? null;
        if (inheritedSlot) {
          await this.db.equipmentLoadouts.put(
            this.inheritLoadout(loadout, inheritedSlot, instanceId, now),
          );
        }

        return { instanceId, stars: nextStars, inheritedSlot };
      },
    );
  }

  private requireRecipe(recipeId: string): CraftingRecipeDefinition {
    const recipe = this.recipes?.get(recipeId);
    if (!recipe) throw new Error('合成配方不存在');
    return recipe;
  }

  private planMaterialConsumption(
    stacks: InventoryStackRecord[],
    recipe: CraftingRecipeDefinition,
    count: number,
  ): Array<{ stack: InventoryStackRecord; quantity: number }> {
    const remaining = new Map(stacks.map((stack) => [stack.id, stack.quantity]));
    const planned = new Map<string, number>();

    for (const [material, perCraft] of Object.entries(recipe.inputs)) {
      let needed = perCraft * count;
      const candidates = stacks
        .filter(
          (stack) => stack.itemId === material || stack.name === material,
        )
        .sort(
          (left, right) =>
            Number(right.itemId === material) - Number(left.itemId === material),
        );
      for (const stack of candidates) {
        const available = remaining.get(stack.id) ?? 0;
        const taken = Math.min(available, needed);
        if (taken <= 0) continue;
        remaining.set(stack.id, available - taken);
        planned.set(stack.id, (planned.get(stack.id) ?? 0) + taken);
        needed -= taken;
        if (needed === 0) break;
      }
      if (needed > 0) {
        throw new Error(`材料不足：${material} 还缺 ${needed}`);
      }
    }

    return [...planned].map(([id, quantity]) => ({
      stack: stacks.find((stack) => stack.id === id)!,
      quantity,
    }));
  }

  private scaledStats(
    source: EquipmentInstanceRecord,
    currentStars: number,
    nextStars: 2 | 3,
  ): Record<string, number> {
    const base = this.equipment?.[source.baseId]?.stats;
    const currentMultiplier = STAR_MULTIPLIER[currentStars] ?? 1;
    const baseStats =
      base ??
      Object.fromEntries(
        Object.entries(source.stats).map(([key, value]) => [
          key,
          Math.max(1, Math.round(value / currentMultiplier)),
        ]),
      );
    return Object.fromEntries(
      Object.entries(baseStats).map(([key, value]) => [
        key,
        Math.max(1, Math.round(value * STAR_MULTIPLIER[nextStars]!)),
      ]),
    );
  }

  private inheritLoadout(
    loadout: EquipmentLoadoutRecord,
    slot: EquipmentSlot,
    instanceId: string,
    updatedAt: number,
  ): EquipmentLoadoutRecord {
    const field =
      slot === 'weapon'
        ? 'weaponId'
        : slot === 'armor'
          ? 'armorId'
          : 'accessoryId';
    return { ...loadout, [field]: instanceId, updatedAt };
  }

  private randomId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
