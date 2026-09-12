/* eslint-disable vue/one-component-per-file -- Mount the real parent with a deliberately failing child. */
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import DeckApp from '@/modules/deck/App.vue';
import type { PanelContext } from '@/kernel/public-api';

// Inject an unexpected child render failure to verify the real deck/host recovery path.
vi.mock('@/modules/deck/WorkshopDialog.vue',async()=>{
  const {defineComponent,h,ref}=await import('vue');
  return {default:defineComponent({props:{initialTab:{type:String,default:undefined}},emits:['close'],setup(props,{emit}){
    const broken=ref(false);
    return()=>{if(broken.value)throw Error('模拟草稿渲染异常');return h('section',{class:'probe-workshop'},[
      h('span',props.initialTab==='drafts'?'已返回草稿':'工坊已打开'),
      h('button',{onClick:()=>{broken.value=true;}},'读取异常草稿'),
      h('button',{onClick:()=>emit('close')},'关闭测试工坊'),
    ]);};
  }})};
});
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.replaceChildren();localStorage.clear();});
function button(text:string):HTMLButtonElement {const el=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);expect(el).toBeDefined();return el!;}
it('渲染异常显示恢复入口，返回草稿、关闭和再次打开均不会卡住',async()=>{
  const errors=vi.fn(),snapshot={world:{location:'测试'},decks:[],cards:[],player:{classMain:'knight',subclass:'holy_knight'}};
  const context={document,api:{query:async()=>snapshot,getThemeState:()=>({active:'default'}),on:()=>()=>undefined}} as unknown as PanelContext;
  const host=document.createElement('div');document.body.append(host);app=createApp(DeckApp,{context});app.config.errorHandler=errors;app.mount(host);
  await vi.waitFor(()=>expect(document.querySelector('.deck-actions')).not.toBeNull());
  button('创意工坊').click();await nextTick();button('读取异常草稿').click();await nextTick();
  expect(document.querySelector('.workshop-recovery')?.textContent).toContain('原草稿仍保留');expect(errors).not.toHaveBeenCalled();
  button('返回草稿列表').click();await nextTick();expect(document.querySelector('.probe-workshop')?.textContent).toContain('已返回草稿');
  button('关闭测试工坊').click();await nextTick();expect(document.querySelector('.probe-workshop')).toBeNull();
  button('创意工坊').click();await nextTick();expect(document.querySelector('.probe-workshop')?.textContent).toContain('工坊已打开');
  button('读取异常草稿').click();await nextTick();button('关闭创意工坊').click();await nextTick();
  button('创意工坊').click();await nextTick();expect(document.querySelector('.probe-workshop')).not.toBeNull();expect(errors).not.toHaveBeenCalled();
});
