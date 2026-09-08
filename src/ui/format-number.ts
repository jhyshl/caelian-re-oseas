const formatter = new Intl.NumberFormat('zh-CN', { useGrouping: false, maximumFractionDigits: 2 });

export function formatNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? formatter.format(Object.is(number, -0) ? 0 : number) : '0';
}

/** Presentation only: never write rounded values back into combat state. */
export function roundNumbersInText(text: string): string {
  return text.replace(/-?\d+\.\d{3,}/g, value => formatNumber(Number(value)));
}
