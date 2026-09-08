import buffNames from '@/content/generated/battle/card-buff-names.json';
import debuffNames from '@/content/generated/battle/card-debuff-names.json';
import worldBuffNames from '@/content/generated/battle/world-buff-names.json';
import worldDebuffNames from '@/content/generated/battle/world-debuff-names.json';
import catalog from '@/battle/rework/catalog.json';

export interface WorkshopStatusOption { id:string; name:string; polarity:'buff'|'debuff'; kind:'buff'|'debuff'|'dot'; value:number; unit:'count'|'percent'|'ratio'; template?:Record<string,any> }
const entries=new Map<string,WorkshopStatusOption>();
for(const [names,polarity] of [[{...worldBuffNames,...buffNames},'buff'],[{...worldDebuffNames,...debuffNames},'debuff']] as const){
  for(const [id,name] of Object.entries(names))entries.set(id,{id,name:String(name),polarity,kind:polarity,value:1,unit:'count'});
}
function visit(raw:unknown):void {
  if(!raw||typeof raw!=='object')return;
  if(Array.isArray(raw)){raw.forEach(visit);return;}
  const e=raw as Record<string,unknown>,kind=e.kind??e.type;
  if(['buff','debuff','dot'].includes(String(kind))&&typeof e.status==='string'){
    const old=entries.get(e.status);entries.set(e.status,{id:e.status,name:old?.name??e.status,polarity:kind==='buff'?'buff':'debuff',kind:kind as WorkshopStatusOption['kind'],value:Number(kind==='dot'?e.atk??.35:e.value??1),unit:kind==='dot'?'ratio':['ratio','percent'].includes(String(e.valueUnit))?e.valueUnit as 'ratio'|'percent':'count',template:{...e}});
  }
  Object.values(e).forEach(visit);
}
visit(catalog);
for(const [id,name,polarity,value,unit] of [
  ['taunt','嘲讽','buff',1,'count'],['swift','迅捷','buff',1,'count'],['freeze','冻结：跳过下一次行动','debuff',1,'count'],
  ['petrify','石化：跳过下一次行动','debuff',1,'count'],['stun','眩晕','debuff',1,'count'],['sleep','沉眠','debuff',1,'count'],
  ['vulnerable','易伤','debuff',.15,'ratio'],['direct_damage_reduction','坚韧：直接减伤','buff',.15,'ratio'],
  ['attack_up','攻击力提高','buff',.2,'ratio'],['defense_up','防御提高','buff',.2,'ratio'],
] as const)entries.set(id,{id,name,polarity,kind:polarity,value,unit});
// The legacy workbench also exposes these effects outside the content catalog.
for(const [id,name] of [['ap_regen','回合恢复AP'],['draw_regen','回合抽牌'],['mp_regen','魔力再生'],['shield_regen','护盾再生'],['heal_regen','生命再生'],['damage_bonus','直接增伤'],['spell_damage_bonus','法术增伤'],['defense_reflect','防御反震'],['counterattack','反击']] as const)entries.set(id,{id,name,polarity:'buff',kind:'buff',value:1,unit:['damage_bonus','spell_damage_bonus'].includes(id)?'percent':'count'});
const legacyAliases:Record<string,string>={damage_halve:'direct_damage_reduction',damage_resist:'direct_damage_reduction',monster_frenzy:'direct_damage_up',death_save:'濒死保留1HP',heal_block:'healing_down',spell_heal_shield_amp:'治疗与护盾提高%',undead_damage_bonus:'对吸血鬼或不死直接增伤',blood_moon:'血月猎杀',damage_bonus:'direct_damage_up',spell_damage_bonus:'直接伤害提高%',spell_amp_percent:'直接伤害提高%',blood_burn:'direct_damage_up',empower:'下张攻击直接增伤',next_attack_bonus:'下张攻击直接增伤'};
for(const [id,canonicalStatus] of Object.entries(legacyAliases)){const e=entries.get(id);if(!e)continue;e.template={...e.template,canonicalStatus};if(id==='damage_halve'){e.value=50;e.unit='percent';}else if(['damage_resist','monster_frenzy','heal_block','spell_heal_shield_amp','undead_damage_bonus','spell_amp_percent','blood_burn'].includes(id))e.unit='percent';if(id==='death_save'||id==='empower'||id==='next_attack_bonus')e.template.charges=1;}
export const WORKSHOP_STATUS_LIBRARY=[...entries.values()].filter(e=>!['agility','敏捷'].includes(e.id)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
export function workshopBuiltinStatus(id:string):WorkshopStatusOption|undefined{return entries.get(id);}
