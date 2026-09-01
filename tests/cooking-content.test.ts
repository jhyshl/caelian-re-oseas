import { describe, expect, it } from 'vitest';
import {
  COOKING_DISHES,
  COOKING_MATERIALS,
  COOKING_RECIPES,
  DISHES_BY_REGION,
  HUNTING_MATERIAL_IDS,
} from '@/content/cooking';

describe('料理内容目录', () => {
  it('包含11种来源互斥的料理材料并遵守基础价格区间', () => {
    expect(Object.keys(COOKING_MATERIALS)).toHaveLength(11);
    expect(HUNTING_MATERIAL_IDS).toEqual(['鸡蛋', '鸡肉', '野猪肉', '鱼肉']);
    expect(
      Object.values(COOKING_MATERIALS).filter((item) => item.huntingOnly),
    ).toHaveLength(4);
    expect(
      Object.values(COOKING_MATERIALS).filter((item) => item.marketOnly),
    ).toHaveLength(7);
    for (const item of Object.values(COOKING_MATERIALS)) {
      expect(item.basePrice).toBeGreaterThanOrEqual(50);
      expect(item.basePrice).toBeLessThanOrEqual(200);
      expect(Boolean(item.huntingOnly)).not.toBe(Boolean(item.marketOnly));
    }
  });

  it('包含20道料理、恰好一半被凯利安讨厌且覆盖10个地区', () => {
    const dishes = Object.values(COOKING_DISHES);
    expect(dishes).toHaveLength(20);
    expect(dishes.filter((dish) => dish.caelianLiked)).toHaveLength(10);
    expect(dishes.filter((dish) => !dish.caelianLiked)).toHaveLength(10);
    for (const dish of dishes) {
      expect(dish.basePrice).toBeGreaterThanOrEqual(500);
      expect(dish.basePrice).toBeLessThanOrEqual(1000);
    }
    expect(Object.keys(DISHES_BY_REGION)).toHaveLength(10);
    for (const ids of Object.values(DISHES_BY_REGION)) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(COOKING_DISHES[id]).toBeDefined();
    }
  });

  it('20份配方各消耗2至6种材料、每种1至5个并包含采集植物', () => {
    expect(COOKING_RECIPES).toHaveLength(20);
    expect(new Set(COOKING_RECIPES.map((recipe) => recipe.output)).size).toBe(20);
    expect(new Set(COOKING_RECIPES.map((recipe) => recipe.output))).toEqual(
      new Set(Object.keys(COOKING_DISHES)),
    );
    let plantRecipeCount = 0;
    for (const recipe of COOKING_RECIPES) {
      const ingredients = Object.entries(recipe.inputs);
      expect(ingredients.length).toBeGreaterThanOrEqual(2);
      expect(ingredients.length).toBeLessThanOrEqual(6);
      for (const [, quantity] of ingredients) {
        expect(quantity).toBeGreaterThanOrEqual(1);
        expect(quantity).toBeLessThanOrEqual(5);
      }
      if (COOKING_DISHES[recipe.output]?.containsPlant) plantRecipeCount += 1;
    }
    expect(plantRecipeCount).toBeGreaterThan(0);
  });
});
