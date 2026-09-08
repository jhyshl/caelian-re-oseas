import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import WorkshopProgramEditor from '@/modules/deck/WorkshopProgramEditor.vue';
import { describeRuleProgram, emptyRuleProgram, normalizeRuleProgram, readRuleTemplates } from '@/workshop-program';
import { WORKSHOP_RULE_EXAMPLES } from '@/workshop-program-templates';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.replaceChildren();localStorage.clear();});
describe('通用积木编辑器交互',()=>{
 it('从示例生成独立草稿、修改状态名称、保存组合模板并完整往返',async()=>{
  const draft=ref(emptyRuleProgram()),originalId=draft.value.id,host=document.createElement('div');document.body.append(host);
  app=createApp({setup:()=>()=>h(WorkshopProgramEditor,{modelValue:draft.value,'onUpdate:modelValue':value=>{draft.value=value;}})});app.mount(host);
  const picker=host.querySelector<HTMLSelectElement>('.template-actions select')!;picker.value=WORKSHOP_RULE_EXAMPLES[5]!.id;picker.dispatchEvent(new Event('change'));await nextTick();
  expect(draft.value.id).toBe(originalId);expect(draft.value.statuses[0]!.modifiers[0]!.status).toBe('freeze');
  const name=host.querySelector<HTMLInputElement>('.rule-status header input')!;name.value='晶化';name.dispatchEvent(new Event('input'));await nextTick();expect(draft.value.statuses[0]!.name).toBe('晶化');
  const effects=[...host.querySelectorAll<HTMLOptionElement>('.rule-modifier select option')].map(e=>e.value);expect(effects).toContain('taunt');expect(effects).toContain('荆棘反击');
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='复制')!.click();await nextTick();expect(draft.value.rules[0]!.steps).toHaveLength(2);expect(draft.value.rules[0]!.steps[0]).not.toBe(draft.value.rules[0]!.steps[1]);
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='保存组合模板')!.click();await nextTick();
  const saved=readRuleTemplates()[0]!;expect(saved.statuses[0]!.name).toBe('晶化');expect(normalizeRuleProgram(JSON.parse(JSON.stringify(saved)))).toEqual(normalizeRuleProgram(draft.value));
  expect(WORKSHOP_RULE_EXAMPLES[5]!.statuses[0]!.name).toBe('石化');
 });
 it('背包保留公式，战斗卡面换算真实属性与对应星级',()=>{
  const p=emptyRuleProgram();p.rules[0]!.steps=[{type:'damage',value:{op:'add',args:[18,{op:'mul',args:[.45,{op:'stat',key:'defense',target:'self'}]}]},stars:[1,1.1,1.2]}];
  expect(describeRuleProgram(p)).toContain('防御');expect(describeRuleProgram(p,{self:{defense:100},star:1})).toContain('造成伤害 63');expect(describeRuleProgram(p,{self:{defense:100},star:3})).toContain('75.6');
 });
});
