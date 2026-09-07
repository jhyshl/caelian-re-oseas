import type { EquipmentInstanceRecord, MarketListing, MarketView } from '@/domain/types';
export const CARRIAGES = {
  ordinary: {name:'普通马车', capacity:50, price:10000},
  medium: {name:'中级马车', capacity:80, price:30000},
  advanced: {name:'高级马车', capacity:120, price:50000},
} as const;
export type CarriageTier = keyof typeof CARRIAGES;
export interface FreightCargo {listing:MarketListing; quantity:number; equipment?:EquipmentInstanceRecord}
export interface FreightJob {
  id:string; direction:'buy'|'sell'; regionId:string; origin:string;
  cargo:FreightCargo[]; saleGold:number; fee:number; carriageIds:string[];
  departedAt:number; arrivesAt:number; deliveredAt?:number; refund?:number;
}
export interface FreightState {
  profileId:string; carriages:Array<{id:string;tier:CarriageTier}>;
  equippedIds:string[]; dayKey:string; dispatchCount:number; jobs:FreightJob[]; updatedAt:number;
}
export interface FreightRegion extends MarketView {prices:Array<{key:string;itemId:string;name:string;buy:number|null;sell:number|null;stock:number}>}
export interface FreightView {
  state:FreightState; regionId:string; gold:number; regions:FreightRegion[];
  nextFee:number; nextResetAt:number;
}
export interface FreightOrder {regionId:string;direction:'buy'|'sell';carriageIds:string[];rows:Array<{key:string;quantity:number}>;refreshKey:string}
export function freightDayKey(date:Date) {return [date.getFullYear(),date.getMonth()+1,date.getDate()].join('-');}
export function freightFee(used:number) {return used<3?0:used===3?500:used===4?1000:2000;}
export function nextFreightReset(date:Date) {return new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime();}
