/** Shared Alpha tuning. Applied exactly once when an encounter is created. */
export const BALANCE_PATCH = Object.freeze({
  shieldCounter: true,
  skipWeakSelfBuff: true,
  attackTierRamp: Object.freeze({normal: .2, elite: .3}),
  attackLevelRamp: Object.freeze({normal: .5, elite: 2, boss: 2}),
  hpLevelRamp: Object.freeze({boss: 0}),
});
