const CAELIAN_CHARACTER_NAMES = new Set([
  '凯利安',
  '凯利安alpha',
  '凯利安beta',
]);
const CAELIAN_WORLDBOOK_BASE_NAMES = [
  '孔雀开屏你说看不见',
  '孔雀开屏你说你看不见',
] as const;

export function isCaelianCharacterName(raw: unknown): boolean {
  return CAELIAN_CHARACTER_NAMES.has(normalizeCharacterName(raw));
}

export function caelianWorldbookFamily(raw: unknown): string {
  const normalized = normalizeIdentifier(raw);
  return (
    CAELIAN_WORLDBOOK_BASE_NAMES.find((name) =>
      [name, `${name}alpha`, `${name}beta`].includes(normalized),
    ) ?? ''
  );
}

export function isCaelianWorldbookName(raw: unknown): boolean {
  return Boolean(caelianWorldbookFamily(raw));
}

function normalizeCharacterName(raw: unknown): string {
  return normalizeIdentifier(raw);
}

function normalizeIdentifier(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s._·:：/\\\-()[\]{}（）【】]+/g, '');
}
