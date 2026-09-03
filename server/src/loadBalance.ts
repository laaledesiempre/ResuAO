export {};

const { initializeBalanceFromApi } = require("./gameDataSync");

class LoadBalance {
    async initialize() {
        await this.load();
        console.log("Balance cargado.");
    }

    async load() {
        try {
            const result = await initializeBalanceFromApi();
            console.log(
                `[GAME DATA] Balance hidratado desde DB: ${result.loadedProfiles}. Version aplicada: ${result.currentVersion}. Personajes refrescados: ${result.refreshedCharacters}.`,
            );
        } catch {
            console.warn("[GAME DATA] No se pudo hidratar balance desde API al iniciar. Se usan datos locales.");
        }
    }
}

module.exports = LoadBalance;
