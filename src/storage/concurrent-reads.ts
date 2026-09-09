import Dexie from 'dexie';
import type { CaelianDatabase } from '@/storage/database';

/** Share only reads already in flight. Never retain a snapshot across a write. */
export class ConcurrentReads {
  private readonly pending = new Map<string, Promise<unknown>>();
  private writes = 0;

  constructor(db: CaelianDatabase) {
    db.use({
      stack: 'dbcore',
      name: `caelian-concurrent-reads-${crypto.randomUUID()}`,
      create: (core) => ({
        ...core,
        transaction: (stores, mode, options) => {
          const transaction = core.transaction(stores, mode, options);
          if (mode === 'readwrite') {
            this.pending.clear();
            this.writes += 1;
            const native = transaction as IDBTransaction;
            const finish = () => {
              this.pending.clear();
              this.writes -= 1;
              native.removeEventListener('complete', finish);
              native.removeEventListener('abort', finish);
            };
            native.addEventListener('complete', finish);
            native.addEventListener('abort', finish);
          }
          return transaction;
        },
      }),
    });
  }

  async read<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.writes > 0 || Dexie.currentTransaction) return load();
    let task = this.pending.get(key) as Promise<T> | undefined;
    if (!task) {
      task = load().finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key);
      });
      this.pending.set(key, task);
    }
    // Battle animation and draft views may mutate their copy of a snapshot.
    return structuredClone(await task);
  }
}
