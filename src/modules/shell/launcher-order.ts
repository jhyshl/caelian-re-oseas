import type { PanelName } from '@/kernel/public-api';

export const LAUNCHER_ORDER_STORAGE_KEY = 'caelian_launcher_order_v1';

export function normalizeLauncherOrder(
  value: unknown,
  availablePanels: readonly PanelName[],
): PanelName[] {
  const available = new Set<PanelName>(availablePanels);
  const seen = new Set<PanelName>();
  const normalized: PanelName[] = [];

  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (
        typeof candidate !== 'string' ||
        !available.has(candidate as PanelName) ||
        seen.has(candidate as PanelName)
      ) {
        continue;
      }
      const panel = candidate as PanelName;
      seen.add(panel);
      normalized.push(panel);
    }
  }

  for (const panel of availablePanels) {
    if (seen.has(panel)) continue;
    seen.add(panel);
    normalized.push(panel);
  }

  return normalized;
}

export function moveLauncherPanel(
  order: readonly PanelName[],
  panel: PanelName,
  direction: -1 | 1,
): PanelName[] {
  const currentIndex = order.indexOf(panel);
  if (currentIndex < 0) return [...order];
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= order.length) return [...order];

  const next = [...order];
  const [moved] = next.splice(currentIndex, 1);
  if (moved) next.splice(targetIndex, 0, moved);
  return next;
}

export function moveLauncherPanelBefore(
  order: readonly PanelName[],
  panel: PanelName,
  beforePanel: PanelName,
): PanelName[] {
  if (panel === beforePanel || !order.includes(panel)) return [...order];
  const next = order.filter((candidate) => candidate !== panel);
  const targetIndex = next.indexOf(beforePanel);
  if (targetIndex < 0) return [...order];
  next.splice(targetIndex, 0, panel);
  return next;
}
