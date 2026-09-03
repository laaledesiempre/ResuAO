export {};

const vars = require("./vars");
const { loadDefaultCraftingRecipesData } = require("./craftingRecipeData");
const { initializeCraftingRecipesFromApi } = require("./gameDataSync");

class LoadCraftingRecipes {
    async initialize() {
        await this.load();
        console.log("Recetas de crafting cargadas.");
    }

    async load() {
        vars.craftingRecipes = loadDefaultCraftingRecipesData();

        try {
            const result = await initializeCraftingRecipesFromApi();
            console.log(
                `[GAME DATA] Crafting hidratado desde DB: ${result.loadedRecipes}. Version aplicada: ${result.currentVersion}.`,
            );
        } catch {
            console.warn("[GAME DATA] No se pudo hidratar crafting desde API al iniciar. Se usan datos locales.");
        }
    }
}

module.exports = LoadCraftingRecipes;
