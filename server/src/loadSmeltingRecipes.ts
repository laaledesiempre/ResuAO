export {};

const vars = require("./vars");
const { loadDefaultSmeltingRecipesData } = require("./smeltingRecipeData");
const { initializeSmeltingRecipesFromApi } = require("./gameDataSync");

class LoadSmeltingRecipes {
    async initialize() {
        await this.load();
        console.log("Recetas de fundición cargadas.");
    }

    async load() {
        vars.smeltingRecipes = loadDefaultSmeltingRecipesData();

        try {
            const result = await initializeSmeltingRecipesFromApi();
            console.log(
                `[GAME DATA] Fundición hidratada desde DB: ${result.loadedRecipes}. Version aplicada: ${result.currentVersion}.`,
            );
        } catch {
            console.warn("[GAME DATA] No se pudo hidratar fundición desde API al iniciar. Se usan datos locales.");
        }
    }
}

module.exports = LoadSmeltingRecipes;
