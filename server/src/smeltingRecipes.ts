import smeltingRecipesJson from "../jsons/smeltingRecipes.json";
const vars = require("./vars");

export type SmeltingRecipe = {
    id: number;
    mineralItemId: number;
    ingotItemId: number;
    requiredSkill: number;
    mineralsPerIngot: number;
};

export const SMELTING_RECIPES = smeltingRecipesJson as SmeltingRecipe[];

export function getSmeltingRecipes(): SmeltingRecipe[] {
    return Array.isArray(vars.smeltingRecipes) && vars.smeltingRecipes.length > 0
        ? vars.smeltingRecipes
        : SMELTING_RECIPES;
}

export function getSmeltingRecipesByMineral(): Record<number, SmeltingRecipe> {
    return Object.fromEntries(getSmeltingRecipes().map((recipe) => [recipe.mineralItemId, recipe])) as Record<
        number,
        SmeltingRecipe
    >;
}
