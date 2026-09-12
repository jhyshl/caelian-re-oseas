import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive, type App } from 'vue';
import WorkshopDialog from '@/modules/deck/WorkshopDialog.vue';
import { WORKSHOP_DRAFT_STORAGE_KEY } from '@/workshop';
import { prepareWorkshopDraft } from '@/workshop-drafts';
import type { PanelContext } from '@/kernel/public-api';

let app:App|undefined;
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function draft(value:Record<string,unknown>,id='draft-one') {return {id,updatedAt:123,value:{id,name:'待恢复职业',...value}};}
async function mountDrafts(values:unknown[]) {
  localStorage.setItem(WORKSHOP_DRAFT_STORAGE_KEY,JSON.stringify(values));
  const host=document.createElement('div');document.body.append(host);const errors:unknown[]=[];
  app=createApp(WorkshopDialog,{context:{document,api:{execute:vi.fn()}} as unknown as PanelContext});
  app.config.errorHandler=e=>errors.push(e);app.mount(host);
  button('草稿 '+values.length).click();await nextTick();return {errors};
}
function button(text:string):HTMLButtonElement {const el=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);expect(el,`按钮：${text}`).toBeDefined();return el!;}
async function openFirst() {document.querySelector<HTMLButtonElement>('.draft-list > button')!.click();await nextTick();}

describe('工坊草稿恢复',()=>{
  it('内部效果损坏时仍保留工坊和原始草稿，其他草稿可继续打开',async()=>{
    const values=[draft({talent:{effects:[null]}}),draft({name:'正常草稿'},'draft-two')],{errors}=await mountDrafts(values),original=localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY);
    await openFirst();expect(document.querySelector('.workshop-dialog')).not.toBeNull();expect(errors).toEqual([]);
    expect(document.querySelector('.workshop-error')?.textContent).toContain('天赋');expect(localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY)).toBe(original);
    document.querySelectorAll<HTMLButtonElement>('.draft-list > button')[1]!.click();await nextTick();expect(document.querySelector<HTMLInputElement>('.workshop-editor input[maxlength="18"]')?.value).toBe('正常草稿');
  });
  it('旧组合规则缺少容器字段时补齐编辑结构，并保留现有数值',async()=>{
    const value={cards:[{id:'card-one',name:'旧规则',effects:[{type:'rule_program',program:{version:2,id:'old-program',name:'旧组合',statuses:[{id:'burning',name:'火焰',turns:5}],rules:[{id:'cast',event:'cast',steps:[{type:'native_status',status:'burn',value:.35,turns:5,maxStacks:6}]}]}}]}]};
    const {errors}=await mountDrafts([draft(value)]);await openFirst();expect(errors).toEqual([]);
    expect(document.querySelector<HTMLInputElement>('.workshop-program-editor input[placeholder="组合名称"]')?.value).toBe('旧组合');expect(document.body.textContent).toContain('每跳攻击倍率');
  });
});

it('仅恢复草稿不会覆盖原文，编辑后才自动保存并保留 DOT 参数',async()=>{
  vi.useFakeTimers();const value={cards:[{id:'card-one',name:'灼烧',effects:[{type:'apply_debuff',nativeStatus:true,debuff:'burn',value:.35,turns:7,maxStacks:8}]}]};
  const {errors}=await mountDrafts([draft(value)]),original=localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY);await openFirst();await vi.advanceTimersByTimeAsync(500);
  expect(localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY)).toBe(original);
  const name=document.querySelector<HTMLInputElement>('.workshop-editor input[maxlength="18"]')!;name.value='继续编辑';name.dispatchEvent(new Event('input'));await nextTick();await vi.advanceTimersByTimeAsync(500);
  const saved=JSON.parse(localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY)!)[0];expect(saved.value.name).toBe('继续编辑');expect(saved.value.cards[0].effects[0]).toMatchObject({value:.35,turns:7,maxStacks:8});expect(errors).toEqual([]);
});

it('没有 structuredClone 的浏览器也能新建卡牌、填写星级并保存',async()=>{
  vi.useFakeTimers();vi.stubGlobal('structuredClone',undefined);const {errors}=await mountDrafts([draft({})]);await openFirst();button('+ 新卡牌').click();await nextTick();
  button('一键填写').click();await nextTick();const ratio=document.querySelector<HTMLInputElement>('[aria-label="2星属性倍率系数"]')!;ratio.value='1.6';ratio.dispatchEvent(new Event('input'));await nextTick();await vi.advanceTimersByTimeAsync(500);
  expect(JSON.parse(localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY)!)[0].value.cards[0].starScaling.levels[1].ratio).toBe(1.6);expect(errors).toEqual([]);
});

it('自动保存失败时在工坊内提示，保留已有草稿且仍可操作',async()=>{
  vi.useFakeTimers();const {errors}=await mountDrafts([draft({})]);await openFirst();const original=localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY),write=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key===WORKSHOP_DRAFT_STORAGE_KEY)throw new DOMException('空间不足','QuotaExceededError');return write.call(this,key,value);});
  const name=document.querySelector<HTMLInputElement>('.workshop-editor input[maxlength="18"]')!;name.value='保存失败示例';name.dispatchEvent(new Event('input'));await nextTick();await vi.advanceTimersByTimeAsync(500);
  expect(document.querySelector('.workshop-error')?.textContent).toContain('草稿自动保存失败');expect(document.querySelector('.workshop-dialog')).not.toBeNull();expect(localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY)).toBe(original);expect(errors).toEqual([]);
  button('草稿 1').click();await nextTick();expect(document.querySelector('.draft-list > button')).not.toBeNull();
});

it.each([
  {cards:[{name:'星级异常',starScaling:{version:1,levels:[null]}}]},
  {cards:[{name:'召唤异常',effects:[{type:'summon',skills:[null]}]}]},
  {cards:[{name:'条件异常',effects:[{type:'conditional_group',conditions:[null]}]}]},
])('损坏的嵌套卡牌配置会指出位置，不进入崩溃状态：%j',async value=>{
  const {errors}=await mountDrafts([draft(value)]);await openFirst();expect(errors).toEqual([]);expect(document.querySelector('.workshop-error')?.textContent).toContain(value.cards[0]!.name);expect(document.querySelector('.workshop-dialog')).not.toBeNull();
});

it('列表混有无效记录时仍可打开正常草稿，保存不会静默删掉其他记录',async()=>{
  vi.useFakeTimers();const {errors}=await mountDrafts([null,draft({})]);await openFirst();expect(document.querySelector('.workshop-error')).not.toBeNull();
  document.querySelectorAll<HTMLButtonElement>('.draft-list > button')[1]!.click();await nextTick();const name=document.querySelector<HTMLInputElement>('.workshop-editor input[maxlength="18"]')!;name.value='可编辑';name.dispatchEvent(new Event('input'));await nextTick();await vi.advanceTimersByTimeAsync(500);
  expect(JSON.parse(localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY)!)).toContain(null);expect(errors).toEqual([]);
});

it('包含嵌套响应式对象的草稿也能复制，编辑副本不会更改来源',()=>{
  const effect=reactive({type:'apply_debuff',value:.35,turns:7,maxStacks:8}),source=reactive({cards:[{name:'灼烧',effects:[effect]}]});
  const restored=prepareWorkshopDraft(source);restored.cards[0].effects[0].value=.9;
  expect(effect.value).toBe(.35);expect(restored.cards[0].effects[0]).toMatchObject({value:.9,turns:7,maxStacks:8});
});
