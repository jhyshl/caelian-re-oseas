import type { LocalBattleState } from '@/domain/types';
export function create(state: LocalBattleState, options?: {level?:number; explicit?:boolean; region?:string; seed?:number; locked?:boolean; stars?:Record<string,number>}): any;
export function hydrate(snapshot: unknown): any;
export function snapshot(game: any): unknown;
export function project(game: any, state: LocalBattleState, options?:{checkpoint?:boolean}): void;
export function syncExternal(game: any, state: LocalBattleState): void;
export function sync(state: LocalBattleState): void;
export function play(state: LocalBattleState, index:number, targetIndex?:number, answers?:number[][], allyTargetId?:string,configureGame?:(game:any,state:LocalBattleState)=>(()=>void)): boolean;
export function choose(state: LocalBattleState,index:number,finish?:boolean): void;
export function discard(state: LocalBattleState): void;
export function endPlayer(game:any): void;
export function enemiesTurn(game:any): void;
export function nextTurn(game:any): void;
export function action(state:LocalBattleState,id:string,targetId?:string): void;
export function legacyDamage(state:LocalBattleState,sourceId:string,targetId:string,amount:number,label:string,ignoreDefense?:boolean): number;
export function encode(value:unknown): unknown;
export function decode(value:unknown): any;
export function regionLevel(level:number,region:string): number;

export function preview(state:LocalBattleState,cardId:string,targetIndex:number,allyTargetId?:string): import('@/battle/card-preview').BattleCardPreview;

export function planActor(game:any,actor:any):any;
