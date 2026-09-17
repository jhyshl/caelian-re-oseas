import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const id='a1990827-99d5-4fb8-8847-cd4a054129b9',token='cb990827-99d5-4fb8-8847-cd4a054129b9';
function fixture(kind='custom_class',status='published',published:string|null='2026-09-01T00:00:00Z') {
 let row:Record<string,unknown>|undefined={id,submission_token:token,kind,status,published_at:published,title:'测试作品'};
 let handler:(r:Request)=>Promise<Response>;
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>{
   if(!url.includes('submission_token=eq.'+token)||!row)return new Response('[]',{status:200});
   if(options?.method==='PATCH')row={...row,...JSON.parse(String(options.body))};
   const result=[row];if(options?.method==='DELETE')row=undefined;
   return new Response(JSON.stringify(result),{status:200});
 });
 const code=ts.transpile(readFileSync('supabase/functions/caelian-card-square-status/index.ts','utf8').replace(/^import[^\n]+\n/,''),{target:ts.ScriptTarget.ES2022});
 runInNewContext(code,{Deno:{env:{get:(name:string)=>name==='SUPABASE_URL'?'https://test.invalid':'server-only'},serve:(fn:typeof handler)=>{handler=fn;}},fetch,Response,Request,TextEncoder});
 const call=(action:string,receipt=token)=>handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Receipt '+receipt,'Content-Type':'application/json'},body:JSON.stringify({id,action})}));
 return {call,fetch,row:()=>row};
}
it('回执所有者可下架、恢复、删除；错误回执不能修改他人记录',async()=>{
 const f=fixture();expect((await f.call('unpublish')).status).toBe(200);expect(f.row()?.status).toBe('unpublished');expect(f.row()?.published_at).toBeTruthy();
 expect((await f.call('republish')).status).toBe(200);expect(f.row()?.status).toBe('published');
 expect((await f.call('delete','11111111-1111-4111-8111-111111111111')).status).toBe(404);expect(f.row()).toBeDefined();
 expect((await f.call('delete')).status).toBe(200);expect(f.row()).toBeUndefined();
});
it('未审核机制下架再上架仍需审核，不能绕过审批',async()=>{
 const f=fixture('mechanism','pending',null);await f.call('unpublish');await f.call('republish');expect(f.row()?.status).toBe('pending');
 const approved=fixture('mechanism');await approved.call('unpublish');await approved.call('republish');expect(approved.row()?.status).toBe('published');
});
