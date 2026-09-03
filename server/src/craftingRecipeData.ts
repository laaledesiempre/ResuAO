import fs from "node:fs";
import path from "node:path";

import type { CraftingRecipe } from "./craftingRecipes";

const DEFAULT_CRAFTING_RECIPES_JSON_PATH = path.resolve(__dirname, "../jsons/craftingRecipes.json");

function normalizeCraftingRecipe(recipe: CraftingRecipe): CraftingRecipe {
    return {
        id: Number(recipe.id ?? 0),
        profession: recipe.profession,
        category: String(recipe.category ?? ""),
        sortOrder: Number(recipe.sortOrder ?? recipe.id ?? 0),
        deleted: Boolean(recipe.deleted ?? false),
        itemId: Number(recipe.itemId ?? 0),
        skill: Number(recipe.skill ?? 0),
        materials: Array.isArray(recipe.materials)
            ? recipe.materials.map((material) => ({
                  itemId: Number(material.itemId ?? 0),
                  amount: Number(material.amount ?? 0),
              }))
            : [],
    };
}

export function normalizeCraftingRecipesData(recipes: CraftingRecipe[]): CraftingRecipe[] {
    return recipes.map(normalizeCraftingRecipe).filter((recipe) => recipe.id > 0);
}

export function loadCraftingRecipesDataFromJsonFile(filePath: string): CraftingRecipe[] {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeCraftingRecipesData(JSON.parse(raw) as CraftingRecipe[]);
}

export function loadDefaultCraftingRecipesData(): CraftingRecipe[] {
    return loadCraftingRecipesDataFromJsonFile(DEFAULT_CRAFTING_RECIPES_JSON_PATH);
}

export { DEFAULT_CRAFTING_RECIPES_JSON_PATH };
