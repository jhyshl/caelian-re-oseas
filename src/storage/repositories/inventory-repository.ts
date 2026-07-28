import type {
  EquipmentSlot,
  InventoryStackRecord,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';

export class InventoryRepository {
  constructor(private readonly db: CaelianDatabase) {}

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

  async equip(profileId: string, instanceId: string): Promise<void> {
    const [equipment, loadout] = await Promise.all([
      this.db.equipmentInstances.get(instanceId),
      this.db.equipmentLoadouts.get(profileId),
    ]);
    if (!equipment || equipment.profileId !== profileId) {
      throw new Error('装备实例不存在');
    }
    if (!loadout) throw new Error('装备栏不存在');
    const field = this.loadoutField(equipment.slot);
    await this.db.equipmentLoadouts.put({
      ...loadout,
      [field]: instanceId,
      updatedAt: Date.now(),
    });
  }

  async unequip(profileId: string, slot: EquipmentSlot): Promise<void> {
    const loadout = await this.db.equipmentLoadouts.get(profileId);
    if (!loadout) throw new Error('装备栏不存在');
    const field = this.loadoutField(slot);
    await this.db.equipmentLoadouts.put({
      ...loadout,
      [field]: null,
      updatedAt: Date.now(),
    });
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
}
