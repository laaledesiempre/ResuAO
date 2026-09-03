export {};
const { initializeObjectsFromApi } = require("./gameDataSync");
const vars = require("./vars");

class LoadObjs {
    constructor() {}

    async initialize() {
        await this.load();

        console.log("Objs Cargados.");
    }

    load() {
        return new Promise(async (resolve: any, reject: any) => {
            vars.datObj = {};

            try {
                const result = await initializeObjectsFromApi();
                console.log(
                    `[GAME DATA] Objs hidratados desde DB: ${result.loadedObjects}. Version aplicada: ${result.currentVersion}.`,
                );
                if (result.loadedObjects <= 0) {
                    reject(new Error("No se pudieron cargar objetos desde la API."));
                    return;
                }
            } catch (error) {
                reject(error);
                return;
            }

            resolve(true);
        });
    }
}

module.exports = LoadObjs;
