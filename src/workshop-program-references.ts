import type { RuleProgram } from '@/workshop-program';
export function ruleProgramsIn(value: unknown): RuleProgram[] {
  const programs = new Map<string, RuleProgram>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    const p = item as RuleProgram;
    if (p.version === 2 && typeof p.id === 'string' && Array.isArray(p.statuses) && Array.isArray(p.rules)) programs.set(p.id, p);
    Object.values(item).forEach(visit);
  };
  visit(value);
  return [...programs.values()];
}
/** Fully qualified definition identifiers are shared by selectors and validation. */
export function programObjectReferences(value: unknown): string[] {
  const references = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === 'string' && /^(workshop_status|workshop_resource|program_status):/.test(item)) references.add(item);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return [...references];
}
