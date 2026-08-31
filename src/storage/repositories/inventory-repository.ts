import type {
  EquipmentInstanceRecord,
  EquipmentLoadoutRecord,
  EquipmentSlot,
  InventoryStackRecord,
  PlayerRecord,
} from '@/domain/types';
import type { BattleItemDefinition, CardEffect } from '@/content/types';
import { loadItemCatalog } from '@/content/catalogs/inventory';
import {
  canApplyInventoryConsumable,
  childEffects,
  isInventoryUsableEffect,
} from '@/battle/consumables';
import { aggregateEquipmentStats } from '@/equipment-stats';
import type { CaelianDatabase } from '@/storage/database';

export class InventoryRepository {
  private items?: Record<string, BattleItemDefinition>;

  constructor(private readonly db: CaelianDatabase) {}

  async prepare(): Promise<void> {
    this.items ??= await loadItemCatalog();
  }

  async adjust(
    profileId: string,
    input: { itemId: string; name?: string; delta: number },
  ): Promise<void> {
    const id = `${profileId}:${input.itemId}`;
    const current = await this.db.inventoryStacks.get(id);
    const quantity = (current?.quantity ?? 0) + input.delta;
    if (quantity < 0) throw new Error('背包数量不能小于 0');
    if (quantity === 0) {
      await this.db.inventoryStacks.delete(id);
      return;
    }
    const stack: InventoryStackRecord = {
      id,
      profileId,
      itemId: input.itemId,
      name: input.name ?? current?.name ?? input.itemId,
      quantity,
      updatedAt: Date.now(),
    };
    await this.db.inventoryStacks.put(stack);
  }

  async useConsumable(profileId: string, itemId: string): Promise<void> {
    if (!this.items) throw new Error('消耗品目录尚未加载');
    const activeBattle = await this.db.battleSessions
      .where('profileId')
      .equals(profileId)
      .filter((session) => session.active)
      .first();
    if (activeBattle) throw new Error('战斗中请从战斗背包使用消耗品');

    const stackId = `${profileId}:${itemId}`;
    const [stack, player, loadout, equipment] = await Promise.all([
      this.db.inventoryStacks.get(stackId),
      this.db.playerStates.get(profileId),
      this.db.equipmentLoadouts.get(profileId),
      this.db.equipmentInstances
        .where('profileId')
        .equals(profileId)
        .toArray(),
    ]);
    if (!stack || stack.quantity <= 0) throw new Error('背包中没有这个物品');
    if (!player?.created) throw new Error('玩家档案不存在');

    const definition = this.items[stack.itemId] ?? this.items[stack.name];
    const effect = definition?.effect;
    if (!effect || !isInventoryUsableEffect(effect)) {
      throw new Error('这个消耗品需要在战斗中或作为战前道具使用');
    }
    const equippedIds = new Set(
      loadout
        ? [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(
            (id): id is string => Boolean(id),
          )
        : [],
    );
    const equipmentBonus = aggregateEquipmentStats(
      equipment.filter((item) => equippedIds.has(item.id)),
    );
    const effectiveHpMax = Math.max(1, player.hpMax + equipmentBonus.hpMax);
    const effectiveMpMax = Math.max(0, player.mpMax + equipmentBonus.mpMax);
    const effectivePlayer = {
      ...player,
      hpMax: effectiveHpMax,
      mpMax: effectiveMpMax,
    };
    if (!canApplyInventoryConsumable(effect, effectivePlayer)) {
      throw new Error('当前生命与魔力均无需恢复');
    }

    this.applyRestoration(player, effect, effectiveHpMax, effectiveMpMax);
    player.updatedAt = Date.now();
    await this.db.playerStates.put(player);
    if (stack.quantity === 1) {
      await this.db.inventoryStacks.delete(stackId);
    } else {
      await this.db.inventoryStacks.put({
        ...stack,
        quantity: stack.quantity - 1,
        updatedAt: Date.now(),
      });
    }
  }

  async equip(profileId: string, instanceId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.equipmentInstances,
        this.db.equipmentLoadouts,
        this.db.playerStates,
      ],
      async () => {
        const [equipment, loadout, player, allEquipment] = await Promise.all([
          this.db.equipmentInstances.get(instanceId),
          this.db.equipmentLoadouts.get(profileId),
          this.db.playerStates.get(profileId),
          this.db.equipmentInstances
            .where('profileId')
            .equals(profileId)
            .toArray(),
        ]);
        if (!equipment || equipment.profileId !== profileId) {
          throw new Error('装备实例不存在');
        }
        if (!loadout) throw new Error('装备栏不存在');
        if (!player) throw new Error('玩家档案不存在');
        const field = this.loadoutField(equipment.slot);
        const now = Date.now();
        const nextLoadout = {
          ...loadout,
          [field]: instanceId,
          updatedAt: now,
        };
        this.clampPlayerResources(player, nextLoadout, allEquipment);
        player.updatedAt = now;
        await this.db.equipmentLoadouts.put(nextLoadout);
        await this.db.playerStates.put(player);
      },
    );
  }

  async unequip(profileId: string, slot: EquipmentSlot): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.equipmentInstances,
        this.db.equipmentLoadouts,
        this.db.playerStates,
      ],
      async () => {
        const [loadout, player, equipment] = await Promise.all([
          this.db.equipmentLoadouts.get(profileId),
          this.db.playerStates.get(profileId),
          this.db.equipmentInstances
            .where('profileId')
            .equals(profileId)
            .toArray(),
        ]);
        if (!loadout) throw new Error('装备栏不存在');
        if (!player) throw new Error('玩家档案不存在');
        const field = this.loadoutField(slot);
        const now = Date.now();
        const nextLoadout = {
          ...loadout,
          [field]: null,
          updatedAt: now,
        };
        this.clampPlayerResources(player, nextLoadout, equipment);
        player.updatedAt = now;
        await this.db.equipmentLoadouts.put(nextLoadout);
        await this.db.playerStates.put(player);
      },
    );
  }

  async setRelicCarried(
    profileId: string,
    relicId: string,
    carried: boolean,
  ): Promise<void> {
    const id = `${profileId}:${relicId}`;
    const relic = await this.db.ownedRelics.get(id);
    if (!relic) throw new Error('尚未拥有该藏品');
    if (carried && !relic.carried) {
      const count = await this.db.ownedRelics
        .where('profileId')
        .equals(profileId)
        .filter((entry) => entry.carried)
        .count();
      if (count >= 5) throw new Error('最多只能携带 5 个藏品');
    }
    await this.db.ownedRelics.put({
      ...relic,
      carried,
      updatedAt: Date.now(),
    });
  }

  private loadoutField(
    slot: EquipmentSlot,
  ): 'weaponId' | 'armorId' | 'accessoryId' {
    if (slot === 'weapon') return 'weaponId';
    if (slot === 'armor') return 'armorId';
    return 'accessoryId';
  }

  private clampPlayerResources(
    player: PlayerRecord,
    loadout: EquipmentLoadoutRecord,
    equipment: EquipmentInstanceRecord[],
  ): void {
    const equippedIds = new Set(
      [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(
        (id): id is string => Boolean(id),
      ),
    );
    const equipmentBonus = aggregateEquipmentStats(
      equipment.filter((item) => equippedIds.has(item.id)),
    );
    player.hp = Math.min(
      player.hp,
      Math.max(1, player.hpMax + equipmentBonus.hpMax),
    );
    player.mp = Math.min(
      player.mp,
      Math.max(0, player.mpMax + equipmentBonus.mpMax),
    );
  }

  private applyRestoration(
    player: PlayerRecord,
    effect: CardEffect,
    hpMax: number,
    mpMax: number,
  ): void {
    if (effect.type === 'multi') {
      for (const child of childEffects(effect)) {
        this.applyRestoration(player, child, hpMax, mpMax);
      }
      return;
    }
    if (effect.type === 'heal') {
      player.hp = Math.min(hpMax, player.hp + this.number(effect.value));
    } else if (effect.type === 'gain_mp') {
      player.mp = Math.min(mpMax, player.mp + this.number(effect.value));
    } else if (effect.type === 'heal_mp') {
      player.hp = Math.min(hpMax, player.hp + this.number(effect.heal));
      player.mp = Math.min(mpMax, player.mp + this.number(effect.mp));
    }
  }

  private number(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
}
