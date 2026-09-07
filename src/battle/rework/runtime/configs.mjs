/* global structuredClone */
import {catalog} from './physics.mjs';
const smart={allocationCriticalWeight:{apothecary:0},smartPriest:true,smartFlying:true};
const mechanics={...smart,shieldCounter:true,skipWeakSelfBuff:true};
const overrides={};for(const [id,index,values] of [['ap_bitter_toxin',0,{flat:20,atk:.4}],['ap_needle_injection',0,{flat:25,atk:.75}],['pr_smite',0,{flat:30,atk:.9}],['pr_judgement',0,{flat:55,atk:1.65}],['mg_smoke_and_mirrors',1,{flat:20,def:.65}],['pr_sacred_ground',0,{ticks:2}]]){const c=structuredClone(catalog.cards.find(c=>c.id===id));Object.assign(c.effects[index],values);overrides[id]={effects:c.effects};}
export const configs={calibrated:smart,mechanics,selective:{...mechanics,cardOverrides:overrides},pressure:{...mechanics,cardOverrides:overrides,attackTierRamp:{normal:.2,elite:.3}}};
