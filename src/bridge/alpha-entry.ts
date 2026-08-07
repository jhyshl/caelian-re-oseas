import '@/styles/alpha.css';
import { createKernel } from '@/kernel/create-kernel';
import { resolveTavernHost } from '@/tavern/adapter';
import { createWorkshopExtensionApi } from '@/workshop';

const host = resolveTavernHost(window);
let bootstrapTask: Promise<void> | undefined;

async function initializeCaelian(): Promise<void> {
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
  host.CaelianWorkshopExtensions = createWorkshopExtensionApi();
  try {
    await kernel.initialize();
  } catch (error) {
    await kernel.api.shutdown().catch(() => undefined);
    if (host.Caelian === kernel.api) delete host.Caelian;
    throw error;
  }
}

export function bootstrapCaelian(): Promise<void> {
  if (host.Caelian?.buildId === __CAELIAN_BUILD_ID__) {
    return bootstrapTask ?? Promise.resolve();
  }
  if (bootstrapTask) return bootstrapTask;

  bootstrapTask = initializeCaelian().catch((error: unknown) => {
    bootstrapTask = undefined;
    throw error;
  });
  return bootstrapTask;
}

// Keep old fixed bridges compatible without blocking this module's evaluation.
// The current bridge calls bootstrapCaelian() again and receives the same task.
void bootstrapCaelian().catch((error: unknown) => {
  console.error('[Caelian Alpha]', error);
});
