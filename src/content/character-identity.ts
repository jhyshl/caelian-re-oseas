const CAELIAN_CHARACTER_NAMES = new Set([
  '凯利安',
  '凯利安alpha',
  '凯利安beta',
]);

export function isCaelianCharacterName(raw: unknown): boolean {
  return CAELIAN_CHARACTER_NAMES.has(normalizeCharacterName(raw));
}

function normalizeCharacterName(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s._·:：/\\\-()[\]{}（）【】]+/g, '');
}
