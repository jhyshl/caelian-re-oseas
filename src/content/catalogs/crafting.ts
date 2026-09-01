import { COOKING_RECIPES } from '@/content/cooking';

export interface CraftingRecipeDefinition {
  id: string;
  name: string;
  inputs: Record<string, number>;
  output: string;
  count: number;
  basePrice: number;
  category: string;
  effectText?: string;
}

let recipeCache: readonly CraftingRecipeDefinition[] | undefined;

export async function loadCraftingRecipes(): Promise<
  readonly CraftingRecipeDefinition[]
> {
  if (!recipeCache) {
    const module = await import('@/content/generated/crafting/recipes.json');
    recipeCache = [
      ...(module.default as unknown as CraftingRecipeDefinition[]),
      ...COOKING_RECIPES,
    ];
  }
  return recipeCache;
}
