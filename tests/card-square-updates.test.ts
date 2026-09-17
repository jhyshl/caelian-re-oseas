import { afterEach, expect, it, vi } from 'vitest';
import { syncSquareInstallations, trackSquareInstallation, readSquareInstallations } from '@/card-square-updates';
import { manageCardSquareSubmission, saveCardSquareReceipt, readCardSquareReceipts, submitCardSquareEntry, type CardSquareEntry } from '@/card-square';
import { saveWorkshopPack, readWorkshopPacks } from '@/workshop';
import { testPack } from './fixtures/square-fix-pack';
import type { CaelianPublicApi } from '@/kernel/public-api';
import type { RuntimeInfo } from '@/domain/types';
const id='a1990827-99d5-4fb8-8847-cd4a054129b9',token='cb990827-99d5-4fb8-8847-cd4a054129b9';
const entry=():CardSquareEntry=>({id,kind:'custom_class',status:'published',title:'自动更新作品',authorName:'测试',summary:'自动更新测试',tags:[],professionId:'custom_class_regression_fix',professionName:'回归职业',payload:testPack(),appVersion:'test',buildId:'test',createdAt:'2026-09-01T00:00:00Z',publishedAt:'2026-09-01T00:00:00Z'});
const receipt=()=>({id,receiptToken:token,title:'自动更新作品',kind:'custom_class' as const,sourceId:'custom_class_regression_fix',status:'published' as const,reviewNote:null,createdAt:'2026-09-01T00:00:00.000Z',reviewedAt:null,publishedAt:'2026-09-01T00:00:00.000Z',lastCheckedAt:'2026-09-01T00:00:00.000Z'});
const row=(e:CardSquareEntry)=>({id:e.id,kind:e.kind,status:e.status,title:e.title,author_name:e.authorName,summary:e.summary,tags:e.tags,profession_id:e.professionId,profession_name:e.professionName,payload:e.payload,app_version:e.appVersion,build_id:e.buildId,created_at:e.createdAt,published_at:e.publishedAt});
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
it('相同作品 ID 更新已安装职业，战斗中延后，下架或删除不影响本地',async()=>{
 const original=entry();saveWorkshopPack(original.payload);trackSquareInstallation(original,original.professionId,window);
 const next=entry(),pack=testPack();pack.classes[0]!.cards[0]!.description='更新后的作者说明';next.payload=pack;next.publishedAt='2026-09-17T00:00:00Z';
 let battle:unknown={id:'busy'};const query=vi.fn(async()=>({battle,decks:[],player:{subclass:original.professionId}}));const api={query} as unknown as CaelianPublicApi;const fetch=vi.fn(async(url:unknown)=>{expect(String(url)).toContain('caelian_card_square_entries');return new Response(JSON.stringify([row(next)]),{status:200});});vi.stubGlobal('fetch',fetch);
 expect(await syncSquareInstallations(api,window)).toEqual([]);expect(fetch).not.toHaveBeenCalled();battle=null;
 expect(await syncSquareInstallations(api,window)).toEqual([original.title]);expect(String(fetch.mock.calls[0]?.[0])).toContain('id=in.('+id+')');expect(readWorkshopPacks()[0]!.classes[0]!.cards[0]!.description).toBe('更新后的作者说明');
 expect(readSquareInstallations(window)[0]?.publishedAt).toBe(next.publishedAt);expect(await syncSquareInstallations(api,window)).toEqual([]);
 fetch.mockImplementation(async()=>new Response('[]',{status:200}));expect(await syncSquareInstallations(api,window)).toEqual([]);expect(readWorkshopPacks()).toHaveLength(1);
});
it('作者重新上传同一本地职业会更新原 ID，删除只移除投稿回执',async()=>{
 const current=receipt();saveCardSquareReceipt(current,window);saveWorkshopPack(testPack());const requests:Array<{url:string;body:any}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{const body=JSON.parse(init.body);requests.push({url:String(url),body});return new Response(JSON.stringify(body.action==='delete'?{deleted:id}:{result:{id,kind:'custom_class',title:current.title,status:'published',review_note:null,reviewed_at:null,published_at:'2026-09-17T00:00:00Z'}}),{status:200});}));
 const saved=await submitCardSquareEntry({kind:'custom_class',title:current.title,anonymous:true,authorName:'',summary:'更新职业内容',tags:[],payload:testPack()}, {version:'test',buildId:'test'} as RuntimeInfo,window);
 expect(saved.id).toBe(id);expect(requests[0]?.body.action).toBe('update');expect(requests[0]?.url).toContain('/functions/');
 await manageCardSquareSubmission(saved,'delete',window);expect(readCardSquareReceipts(window)).toEqual([]);expect(readWorkshopPacks()).toHaveLength(1);
});
