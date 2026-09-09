import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import type { PlayerRecord } from '@/domain/types';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];
async function fixture() {
  const db = new CaelianDatabase('alpha', `performance-reads-${crypto.randomUUID()}`);
  databases.push(db);
  const repository = new GameRepository(db, new EventBus());
  const profile = await repository.ensureProfile('performance-only');
  await repository.snapshot(profile.id);
  return { db, repository, profile };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe('按需状态读取', () => {
  it('战斗查询保持页面数据一致且不读取卡牌收藏、任务和成就', async () => {
    const { db, repository, profile } = await fixture();
    const full = await repository.snapshot(profile.id);
    const unrelated = [db.ownedCards, db.questRecords, db.achievementProgress]
      .map((table) => vi.spyOn(table, 'where'));
    const battle = await repository.battleSnapshot(profile.id);
    for (const key of Object.keys(battle) as Array<keyof typeof battle>) {
      expect(battle[key]).toEqual(full[key]);
    }
    for (const read of unrelated) expect(read).not.toHaveBeenCalled();
    expect(await repository.affinity(profile.id)).toBe(full.social.affinity);
    expect(await repository.inventorySnapshot(profile.id)).toEqual(full.inventory);
    expect(await repository.themeSnapshot(profile.id)).toMatchObject({
      social: { affinity: full.social.affinity }, settings: full.settings,
    });
  });

  it('并发全量读取共用数据库请求，但界面之间不能修改对方的数据', async () => {
    const { db, repository, profile } = await fixture();
    const reads = vi.spyOn(db.ownedCards, 'where');
    const [first, second] = await Promise.all([
      repository.snapshot(profile.id), repository.snapshot(profile.id),
    ]);
    expect(reads).toHaveBeenCalledTimes(1);
    first.player.name = '仅改这个界面的草稿';
    expect(second.player.name).not.toBe(first.player.name);
    expect((await repository.snapshot(profile.id)).player.name).toBe(second.player.name);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('写入期间不复用正在返回的旧快照，写入后立即读取新值', async () => {
    const { db, repository, profile } = await fixture();
    const original = db.playerStates.get.bind(db.playerStates);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    const playerReader = db.playerStates as unknown as {
      get: (id: string) => Promise<PlayerRecord | undefined>;
    };
    vi.spyOn(playerReader, 'get').mockImplementationOnce(async () => {
      const old = await original(profile.id);
      started();
      await gate;
      return old;
    });
    const oldRead = repository.battleSnapshot(profile.id);
    await began;
    await db.playerStates.update(profile.id, { name: '写入后的玩家' });
    const newRead = await repository.battleSnapshot(profile.id);
    release();
    expect(newRead.player.name).toBe('写入后的玩家');
    expect((await oldRead).player.name).not.toBe(newRead.player.name);
    expect((await repository.battleSnapshot(profile.id)).player.name).toBe(newRead.player.name);
  });
});
