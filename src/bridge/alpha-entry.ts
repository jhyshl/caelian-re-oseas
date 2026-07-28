import '@/styles/alpha.css';
import { createKernel } from '@/kernel/create-kernel';
import { resolveTavernHost } from '@/tavern/adapter';

const host = resolveTavernHost(window);

export async function bootstrapCaelian(): Promise<void> {
  const existing = host.Caelian;

  if (existing?.buildId === __CAELIAN_BUILD_ID__) return;
  if (existing) await existing.shutdown();

  const kernel = createKernel({
    channel: 'alpha',
    version: __CAELIAN_VERSION__,
    buildId: __CAELIAN_BUILD_ID__,
    sourceWindow: window,
  });
  host.Caelian = kernel.api;
  try {
    await kernel.initialize();
  } catch (error) {
    await kernel.api.shutdown().catch(() => undefined);
    if (host.Caelian === kernel.api) delete host.Caelian;
    throw error;
  }
}

// Keep old fixed bridges compatible; the new bridge also calls this export
// explicitly when it needs to recover a cached build.
await bootstrapCaelian();
