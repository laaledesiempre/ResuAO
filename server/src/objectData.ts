import { execFileSync } from "node:child_process";
import fs from "node:fs";

import type { DataObject } from "./types/runtime";

const config = require("./config");

type ObjectsById = Record<string, DataObject>;

const DEFAULT_OBJECTS_API_PATH = "/internal/game-data/objects/changes?sinceVersion=0";

const OBJECT_DEFAULTS: Record<string, unknown> = {
    name: "",
    objType: 0,
    tipoPocion: 0,
    minModificador: 0,
    maxModificador: 0,
    grhIndex: 0,
    anim: 0,
    agarrable: 0,
    valor: 0,
    minHit: 0,
    maxHit: 0,
    minDef: 0,
    maxDef: 0,
    newbie: 0,
    proyectil: 0,
    noSeCae: 0,
    clasesNoPermitidas: [],
    indexAbierta: 0,
    indexCerrada: 0,
    llave: 0,
    cerrada: 0,
    spellIndex: 0,
    razaEnana: 0,
    abriga: 0,
    apu: 0,
    porcentaje: 0,
    resistenciaMagica: 0,
    staffDamageBonus: 0,
    magicDamageBonus: 0,
    magicPenetration: 0,
    minDefMag: 0,
    maxDefMag: 0,
};

const REQUIRED_OBJECT_KEYS = new Set(["name", "objType", "grhIndex", "valor"]);

function isSameDefaultValue(value: unknown, defaultValue: unknown): boolean {
    if (Array.isArray(defaultValue)) {
        return Array.isArray(value) && value.length === 0;
    }

    return value === defaultValue;
}

function normalizeObject(objectData: DataObject): DataObject {
    return {
        ...OBJECT_DEFAULTS,
        ...objectData,
        clasesNoPermitidas: Array.isArray(objectData.clasesNoPermitidas) ? objectData.clasesNoPermitidas : [],
    } as DataObject;
}

export function normalizeObjectsData(objectsById: ObjectsById): ObjectsById {
    return Object.fromEntries(Object.entries(objectsById).map(([id, objectData]) => [id, normalizeObject(objectData)]));
}

export function compactObjectsData(objectsById: ObjectsById): ObjectsById {
    return Object.fromEntries(
        Object.entries(objectsById).map(([id, objectData]) => {
            const compactedEntries = Object.entries(objectData).filter(([key, value]) => {
                if (typeof value === "undefined") {
                    return false;
                }

                if (REQUIRED_OBJECT_KEYS.has(key)) {
                    return true;
                }

                const defaultValue = OBJECT_DEFAULTS[key];

                if (typeof defaultValue === "undefined") {
                    return true;
                }

                return !isSameDefaultValue(value, defaultValue);
            });

            return [id, Object.fromEntries(compactedEntries) as DataObject];
        }),
    );
}

export function loadObjectsDataFromJsonFile(filePath: string): ObjectsById {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeObjectsData(JSON.parse(raw) as ObjectsById);
}

type ObjectChangesResponse = {
    currentVersion: number;
    changes: Array<{ id: number; version: number; data: DataObject }>;
};

function getObjectsDbUrl(): string | null {
    return process.env.OBJECTS_DB_URL ?? process.env.BALANCE_DB_URL ?? process.env.DATABASE_URL ?? null;
}

function shouldPreferDbSource(): boolean {
    return (process.env.GAME_DATA_SOURCE ?? "").toLowerCase() === "db";
}

function fetchObjectsChangesFromApi(): ObjectChangesResponse {
    const raw = execFileSync(
        "curl",
        ["-fsSL", `${config.apiBaseUrl}${DEFAULT_OBJECTS_API_PATH}`, "-H", `Authorization: ${config.tokenAuth}`],
        { encoding: "utf8" },
    );

    console.log(`${config.apiBaseUrl}${DEFAULT_OBJECTS_API_PATH}`);

    return JSON.parse(raw) as ObjectChangesResponse;
}

export function loadObjectsDataFromApi(): ObjectsById {
    const result = fetchObjectsChangesFromApi();

    return normalizeObjectsData(
        Object.fromEntries(result.changes.map((change) => [String(change.id), change.data])) as ObjectsById,
    );
}

export function loadObjectsDataFromDb(dbUrl: string): ObjectsById {
    const raw = execFileSync(
        "psql",
        [
            dbUrl,
            "-X",
            "-A",
            "-q",
            "-t",
            "-c",
            `
              SELECT row_to_json(t)
              FROM (
                SELECT id, data
                FROM game_objects
                ORDER BY id ASC
              ) t;
            `,
        ],
        {
            encoding: "utf8",
            maxBuffer: 1024 * 1024 * 256,
        },
    );

    const rows = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { id: number; data: DataObject });

    return normalizeObjectsData(Object.fromEntries(rows.map((row) => [String(row.id), row.data])) as ObjectsById);
}

export function loadDefaultObjectsData(): ObjectsById {
    const dbUrl = getObjectsDbUrl();

    if (shouldPreferDbSource() && dbUrl) {
        return loadObjectsDataFromDb(dbUrl);
    }

    try {
        return loadObjectsDataFromApi();
    } catch (apiError) {
        if (dbUrl) {
            return loadObjectsDataFromDb(dbUrl);
        }

        throw apiError;
    }
}

export { DEFAULT_OBJECTS_API_PATH };
