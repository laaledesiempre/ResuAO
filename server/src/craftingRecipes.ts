import craftingRecipesJson from "../jsons/craftingRecipes.json";
const vars = require("./vars");

export type CraftingProfession = "carpentry" | "blacksmith" | "tailoring";

export type CraftingMaterial = {
    itemId: number;
    amount: number;
};

export type CraftingRecipe = {
    id: number;
    profession: CraftingProfession;
    category: string;
    sortOrder?: number;
    deleted?: boolean;
    itemId: number;
    skill: number;
    materials: CraftingMaterial[];
};

export const CRAFTING_RECIPES = craftingRecipesJson as CraftingRecipe[];

export function getCraftingRecipes(): CraftingRecipe[] {
    return Array.isArray(vars.craftingRecipes) && vars.craftingRecipes.length > 0
        ? vars.craftingRecipes
        : CRAFTING_RECIPES;
}
