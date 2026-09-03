import fs from "node:fs";
import path from "node:path";

import type { SmeltingRecipe } from "./smeltingRecipes";

const DEFAULT_SMELTING_RECIPES_JSON_PATH = path.resolve(__dirname, "../jsons/smeltingRecipes.json");

function normalizeSmeltingRecipe(recipe: SmeltingRecipe): SmeltingRecipe {
    return {
        id: Number(recipe.id ?? 0),
        mineralItemId: Number(recipe.mineralItemId ?? 0),
        ingotItemId: Number(recipe.ingotItemId ?? 0),
        requiredSkill: Number(recipe.requiredSkill ?? 0),
        mineralsPerIngot: Number(recipe.mineralsPerIngot ?? 0),
    };
}

export function normalizeSmeltingRecipesData(recipes: SmeltingRecipe[]): SmeltingRecipe[] {
    return recipes.map(normalizeSmeltingRecipe).filter((recipe) => recipe.id > 0);
}

export function loadSmeltingRecipesDataFromJsonFile(filePath: string): SmeltingRecipe[] {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeSmeltingRecipesData(JSON.parse(raw) as SmeltingRecipe[]);
}

export function loadDefaultSmeltingRecipesData(): SmeltingRecipe[] {
    return loadSmeltingRecipesDataFromJsonFile(DEFAULT_SMELTING_RECIPES_JSON_PATH);
}

export { DEFAULT_SMELTING_RECIPES_JSON_PATH };
