import fs from "node:fs";
import path from "node:path";

import { loadDefaultObjectsData, loadObjectsDataFromJsonFile } from "../objectData";

type SourceObject = {
    name: string;
    objType?: number;
    grhIndex: number | string;
    minHit?: number;
    maxHit?: number;
    minDef?: number;
    maxDef?: number;
    minDefMag?: number;
    maxDefMag?: number;
    resistenciaMagica?: number;
    apu?: number;
    proyectil?: number;
    staffDamageBonus?: number;
    magicDamageBonus?: number;
};

type ClientObject = {
    name: string;
    grhIndex: string;
    objType?: number;
    minHit?: number;
    maxHit?: number;
    minDef?: number;
    maxDef?: number;
    minDefMag?: number;
    maxDefMag?: number;
    resistenciaMagica?: number;
    apu?: number;
    proyectil?: number;
    staffDamageBonus?: number;
    magicDamageBonus?: number;
};

type ObjectsMap = Record<string, SourceObject>;

const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, "../../../frontend/public/init/objs.json");

function resolveCliPath(value: string | undefined, fallback: string) {
    if (!value?.trim()) {
        return fallback;
    }

    return path.resolve(process.cwd(), value);
}

function addOptionalNumber(
    target: Partial<ClientObject>,
    key: Exclude<keyof ClientObject, "name" | "grhIndex">,
    value: number | undefined,
) {
    if (typeof value !== "number" || value === 0) {
        return;
    }

    target[key] = value;
}

function toClientObject(source: SourceObject): ClientObject {
    const clientObject: Partial<ClientObject> = {
        name: source.name,
        grhIndex: String(source.grhIndex),
    };

    addOptionalNumber(clientObject, "objType", source.objType);
    addOptionalNumber(clientObject, "minHit", source.minHit);
    addOptionalNumber(clientObject, "maxHit", source.maxHit);
    addOptionalNumber(clientObject, "minDef", source.minDef);
    addOptionalNumber(clientObject, "maxDef", source.maxDef);
    addOptionalNumber(clientObject, "minDefMag", source.minDefMag);
    addOptionalNumber(clientObject, "maxDefMag", source.maxDefMag);
    addOptionalNumber(clientObject, "resistenciaMagica", source.resistenciaMagica);
    addOptionalNumber(clientObject, "apu", source.apu);
    addOptionalNumber(clientObject, "proyectil", source.proyectil);
    addOptionalNumber(clientObject, "staffDamageBonus", source.staffDamageBonus);
    addOptionalNumber(clientObject, "magicDamageBonus", source.magicDamageBonus);

    return clientObject as ClientObject;
}

function main() {
    const inputArg = process.argv[2]?.trim();
    const inputPath = inputArg ? resolveCliPath(inputArg, inputArg) : null;
    const outputPath = resolveCliPath(process.argv[3], DEFAULT_OUTPUT_PATH);

    const source = (inputPath ? loadObjectsDataFromJsonFile(inputPath) : loadDefaultObjectsData()) as ObjectsMap;
    const exportedObjects = Object.fromEntries(
        Object.entries(source).map(([id, objectData]) => [id, toClientObject(objectData)]),
    );

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(exportedObjects));

    console.log(`Exported ${Object.keys(exportedObjects).length} objects to ${outputPath}`);
}

main();
