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

export function prioritizeLauncherPanels(
  order: readonly PanelName[],
  priority: readonly PanelName[],
): PanelName[] {
  const available = new Set(order);
  const selected = priority.filter(
    (panel, index) =>
      available.has(panel) && priority.indexOf(panel) === index,
  );
  const selectedSet = new Set(selected);
  return [
    ...selected,
    ...order.filter((panel) => !selectedSet.has(panel)),
  ];
}
