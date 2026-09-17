import { listCardSquareEntries, readCardSquareReceipts, type CardSquareEntry, type CardSquareKind, type SquareDeckBuild } from '@/card-square';
import { normalizeWorkshopPack, readWorkshopPacks, saveWorkshopPack } from '@/workshop';
import { isWorkshopScriptMechanism, normalizeWorkshopMechanism, readWorkshopMechanisms, saveWorkshopMechanism } from '@/workshop-mechanisms';
import { prepareWorkshopScriptRuntime, validateWorkshopScriptMechanism } from '@/workshop-script-runtime';
import { loadCardCatalog, refreshWorkshopCardCatalog } from '@/content/catalogs/cards';
import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import { refreshWorkshopPassiveCatalog } from '@/content/catalogs/battle';
import { readSavedDeckBuilds, saveNamedDeckBuild } from '@/saved-decks';
import type { CaelianPublicApi } from '@/kernel/public-api';
import { commandId } from '@/kernel/ids';

export const CARD_SQUARE_INSTALLS_KEY='caelian_card_square_installs_v1';
export interface SquareInstallation { entryId:string; kind:CardSquareKind; localId:string; publishedAt:string|null; cardIds?:string[] }
export function readSquareInstallations(source:Window):SquareInstallation[] {
  try {const raw:unknown=JSON.parse(source.localStorage.getItem(CARD_SQUARE_INSTALLS_KEY)??'[]');return Array.isArray(raw)?raw.filter(r=>r&&/^[0-9a-f-]{36}$/i.test(r.entryId)&&['deck_build','custom_class','mechanism'].includes(r.kind)&&typeof r.localId==='string').slice(0,500):[];}catch{return [];}
}
export function trackSquareInstallation(entry:CardSquareEntry,localId:string,source:Window):void {
  const rows=readSquareInstallations(source).filter(r=>r.entryId!==entry.id&&!(r.kind===entry.kind&&r.localId===localId));
  rows.push({entryId:entry.id,kind:entry.kind,localId,publishedAt:entry.publishedAt,...(entry.kind==='deck_build'?{cardIds:(entry.payload as SquareDeckBuild).cardIds}:{})});
  source.localStorage.setItem(CARD_SQUARE_INSTALLS_KEY,JSON.stringify(rows));
}
const sameDeck=(a:string[],b:string[])=>{const sorted=[...b].sort();return a.length===b.length&&[...a].sort().every((id,i)=>id===sorted[i]);};
function exists(row:SquareInstallation,source:Window):boolean {
  return row.kind==='custom_class'?readWorkshopPacks().some(p=>p.classes.some(c=>c.id===row.localId)):row.kind==='mechanism'?readWorkshopMechanisms().some(m=>m.id===row.localId):readSavedDeckBuilds(source).some(d=>d.id===row.localId);
}
export async function syncSquareInstallations(api:CaelianPublicApi,source:Window,options:{adoptLegacy?:boolean;cancelled?:()=>boolean}={}):Promise<string[]> {
  if(options.cancelled?.()||(await api.query('state')).battle)return [];
  const installs=readSquareInstallations(source).filter(row=>exists(row,source));
  if(!installs.length&&!readWorkshopPacks().length&&!readWorkshopMechanisms().length&&!readSavedDeckBuilds(source).length)return [];
  if(options.adoptLegacy) {
    const entries=await listCardSquareEntries(source),receipts=readCardSquareReceipts(source);
    for(const entry of entries) {
      if(entry.kind==='deck_build') {
        const build=entry.payload as SquareDeckBuild;
        const matches=readSavedDeckBuilds(source).filter(d=>d.professionId===build.professionId&&d.name===build.name&&sameDeck(d.cardIds,build.cardIds));
        const alternatives=entries.filter(e=>e.kind==='deck_build'&&e.professionId===build.professionId&&(e.payload as SquareDeckBuild).name===build.name);
        if(matches.length===1&&alternatives.length===1&&!receipts.some(r=>r.id===entry.id)&&!installs.some(r=>r.entryId===entry.id||r.localId===matches[0]!.id))installs.push({entryId:entry.id,kind:entry.kind,localId:matches[0]!.id,publishedAt:entry.publishedAt,cardIds:build.cardIds});
        continue;
      }
      if(installs.some(r=>r.entryId===entry.id||r.kind===entry.kind&&r.localId===entry.professionId))continue;
      // Only migrate unambiguous legacy identities, and never subscribe an author's own draft.
      if(entries.filter(e=>e.kind===entry.kind&&e.professionId===entry.professionId).length!==1||receipts.some(r=>r.id===entry.id||r.kind===entry.kind&&r.sourceId===entry.professionId))continue;
      const row:SquareInstallation={entryId:entry.id,kind:entry.kind,localId:entry.professionId,publishedAt:null};
      if(exists(row,source))installs.push(row);
    }
    if(options.cancelled?.())return [];
    source.localStorage.setItem(CARD_SQUARE_INSTALLS_KEY,JSON.stringify(installs));
  }
  if(!installs.length)return [];
  const entries:CardSquareEntry[]=[];
  for(let i=0;i<installs.length;i+=100)entries.push(...await listCardSquareEntries(source,installs.slice(i,i+100).map(r=>r.entryId)));
  const updated:string[]=[];
  for(const entry of entries) {
    const binding=installs.find(r=>r.entryId===entry.id);if(!binding||entry.kind!==binding.kind||entry.publishedAt===binding.publishedAt)continue;
    if(options.cancelled?.()||(await api.query('state')).battle)break;
    if(!exists(binding,source))continue;
    if(entry.kind==='deck_build') {
      const build=entry.payload as SquareDeckBuild, saved=readSavedDeckBuilds(source).find(d=>d.id===binding.localId)!;
      const snapshot=await api.query('state');if(snapshot.battle||options.cancelled?.())break;
      const active=snapshot.decks.find(d=>d.active);
      if(active&&binding.cardIds&&snapshot.player.subclass===build.professionId&&sameDeck(active.cardIds,binding.cardIds)) {
        const result=await api.execute({id:commandId('square-update-deck'),type:'deck.update',payload:{cardIds:build.cardIds}});
        if(result.status==='rejected')continue; // Retry after the player obtains missing cards; never grant them.
      }
      saveNamedDeckBuild({...saved,name:build.name,professionId:build.professionId,professionName:build.professionName,mainClass:build.mainClass,cardIds:build.cardIds,cardStars:undefined},source);
    } else {
      if(entry.professionId!==binding.localId)continue;
      const pack=entry.kind==='custom_class'?normalizeWorkshopPack(entry.payload):undefined;
      const mechanism=entry.kind==='mechanism'?normalizeWorkshopMechanism(entry.payload):undefined;
      if(pack&&(pack.classes.length!==1||pack.classes[0]?.id!==binding.localId)||mechanism&&mechanism.id!==binding.localId)continue;
      const scripts=(pack?.mechanisms??(mechanism?[mechanism]:[])).filter(isWorkshopScriptMechanism);
      if(scripts.length){await prepareWorkshopScriptRuntime();for(const script of scripts)await validateWorkshopScriptMechanism(script);}
      await loadCardCatalog();
      if(options.cancelled?.()||(await api.query('state')).battle)break;
      if(pack)saveWorkshopPack(pack);else saveWorkshopMechanism(mechanism!);
      refreshWorkshopProfessionCatalogs();refreshWorkshopCardCatalog();refreshWorkshopPassiveCatalog();
    }
    trackSquareInstallation(entry,binding.localId,source);updated.push(entry.title);
  }
  return updated;
}
export function startSquareUpdates(api:CaelianPublicApi,source:Window):()=>void {
  let running=false,stopped=false,adoptLegacy=true;
  const check=async()=>{
    if(running||stopped)return;running=true;
    try {if((await api.query('state')).battle)return;const titles=await syncSquareInstallations(api,source,{adoptLegacy,cancelled:()=>stopped});adoptLegacy=false;
      if(titles.length&&!stopped)api.notify({kind:'success',title:'卡牌广场已更新：'+titles.join('、')});
    } catch { /* Keep the installed version offline and retry at the next interval. */ }
    finally {running=false;}
  };
  void check();const timer=source.setInterval(()=>void check(),60_000);
  return ()=>{stopped=true;source.clearInterval(timer);};
}
