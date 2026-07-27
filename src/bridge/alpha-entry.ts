import '@/styles/alpha.css';
import { createKernel } from '@/kernel/create-kernel';

function resolveHost(sourceWindow: Window): Window {
  try {
    return sourceWindow.parent && sourceWindow.parent.document
      ? sourceWindow.parent
      : sourceWindow;
  } catch {
    return sourceWindow;
  }
}

const host = resolveHost(window);
const existing = host.Caelian;

if (existing && existing.buildId !== __CAELIAN_BUILD_ID__) {
  await existing.shutdown();
}

if (!host.Caelian || host.Caelian.buildId !== __CAELIAN_BUILD_ID__) {
  const kernel = createKernel({
    channel: 'alpha',
    version: __CAELIAN_VERSION__,
    buildId: __CAELIAN_BUILD_ID__,
    sourceWindow: host,
  });
  host.Caelian = kernel.api;
  await kernel.initialize();
}
