import { emptyRuleProgram, type RuleProgram } from '@/workshop-program';
import { workshopStatusKey, type WorkshopMechanismManifest, type WorkshopMechanismStatus } from '@/workshop-mechanisms';

/** Standalone definitions use the same interpreter and state lifecycle as cards. */
export function workshopStatusProgram(manifest: WorkshopMechanismManifest, status: WorkshopMechanismStatus): RuleProgram {
  if (status.program) return status.program;
  return { version: 2, id: workshopStatusKey(manifest.id, status.id), name: status.label, variables: [], rules: [], statuses: [{
    id: status.id, name: status.label, polarity: status.polarity, turns: 1,
    cleanseable: true, dispellable: true, baseChance: 100, stacking: 'add', refresh: 'refresh',
    data: { layers: 1 }, modifiers: [], rules: [],
  }] };
}
export function emptyStatusProgram(): RuleProgram {
  const program = emptyRuleProgram();
  program.rules = [];
  program.statuses = [{ id: 'state', name: '自定义状态', polarity: 'buff', turns: 2,
    cleanseable: true, dispellable: true, baseChance: 100, stacking: 'independent',
    data: {}, modifiers: [], rules: [] }];
  return program;
}
