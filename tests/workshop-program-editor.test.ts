import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App, type Ref } from 'vue';
import WorkshopProgramEditor from '@/modules/deck/WorkshopProgramEditor.vue';
import { describeRuleProgram, emptyRuleProgram, normalizeRuleProgram, readRuleTemplates, type RuleProgram } from '@/workshop-program';
import { WORKSHOP_RULE_EXAMPLES } from '@/workshop-program-templates';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.replaceChildren();localStorage.clear();});
function mountProgram(draft:Ref<RuleProgram>,host:HTMLElement):void{app=createApp({setup:()=>()=>h(WorkshopProgramEditor,{modelValue:draft.value,'onUpdate:modelValue':value=>{draft.value=value;}})});app.mount(host);}
describe('通用积木编辑器交互',()=>{
 it('从示例生成独立草稿、修改状态名称、保存组合模板并完整往返',async()=>{
  const draft=ref(emptyRuleProgram()),originalId=draft.value.id,host=document.createElement('div');document.body.append(host);
  mountProgram(draft,host);
  const picker=host.querySelector<HTMLSelectElement>('.template-actions select')!;picker.value=WORKSHOP_RULE_EXAMPLES[5]!.id;picker.dispatchEvent(new Event('change'));await nextTick();
  expect(draft.value.id).toBe(originalId);expect(draft.value.statuses[0]!.modifiers[0]!.status).toBe('freeze');
  const name=host.querySelector<HTMLInputElement>('.rule-status header input')!;name.value='晶化';name.dispatchEvent(new Event('input'));await nextTick();expect(draft.value.statuses[0]!.name).toBe('晶化');
  const effects=[...host.querySelectorAll<HTMLOptionElement>('.rule-modifier select option')].map(e=>e.value);expect(effects).toContain('taunt');expect(effects).toContain('thorns');expect(effects).not.toContain('荆棘反击');expect(effects).not.toContain('dragon_soul');expect(effects).not.toContain('exam_overload');
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

it('组合 DOT 和复用效果显示单位与可编辑上限，模板保存后完整保留',async()=>{
  const draft=ref(emptyRuleProgram());draft.value.rules[0]!.steps=[{type:'native_status',status:'burn',value:.35,turns:5,maxStacks:6}];
  draft.value.statuses=[{id:'f',name:'火焰',polarity:'debuff',turns:5,maxStacks:6,stacking:'independent',cleanseable:true,dispellable:true,baseChance:100,data:{},rules:[],modifiers:[{status:'burn',value:35,unit:'percent'}]}];
  const host=document.createElement('div');document.body.append(host);mountProgram(draft,host);
  expect([...host.querySelectorAll('.rule-steps')].map(e=>e.textContent).join(' ')).toContain('每跳攻击倍率（0.35 = 35%）');
  expect([...host.querySelectorAll('.rule-steps')].map(e=>e.textContent).join(' ')).toContain('可叠加上限（0 为不设上限）');
  expect(host.querySelector('.rule-modifier')!.textContent).toContain('每跳攻击百分数（35 = 35%）');
  const cap=[...host.querySelectorAll('.rule-status label')].find(l=>l.textContent?.startsWith('可叠加上限'))!.querySelector('input')!;
  cap.value='9';cap.dispatchEvent(new Event('input'));await nextTick();expect(draft.value.statuses[0]!.maxStacks).toBe(9);
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='保存组合模板')!.click();await nextTick();
  const saved=readRuleTemplates()[0]!;expect(saved.statuses[0]).toMatchObject({maxStacks:9,turns:5,modifiers:[{status:'burn',value:35,unit:'percent'}]});
  expect(saved.rules[0]!.steps[0]).toMatchObject({maxStacks:6,turns:5,value:.35});
});
