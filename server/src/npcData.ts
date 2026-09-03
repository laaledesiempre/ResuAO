import { execFileSync } from "node:child_process";
import fs from "node:fs";

const config = require("./config");

type NpcDropEntry = { item: number; cant: number };
type NpcSpellEntry = { idSpell: number; cooldownSeconds?: number };

export type DataNpc = {
    name: string;
    npcType: number;
    idHead: number;
    idBody: number;
    movement: number;
    desc?: string;
    aguaValida?: number;
    tierraInvalida?: number;
    exp?: number;
    gold?: number;
    hp?: number;
    maxHp?: number;
    maxHit?: number;
    minHit?: number;
    def?: number;
    poderAtaque?: number;
    poderEvasion?: number;
    magicResistance?: number;
    magicDef?: number;
    defM?: number;
    snd1?: number;
    snd2?: number;
    soundClose?: number;
    spellCastIntervalMs?: number;
    spellRange?: number;
    spells?: NpcSpellEntry[];
    objs?: NpcDropEntry[];
    drop?: NpcDropEntry[];
    [key: string]: unknown;
};

type NpcsById = Record<string, DataNpc>;

const DEFAULT_NPCS_API_PATH = "/internal/game-data/npcs/changes?sinceVersion=0";

const NPC_DEFAULTS: Record<string, unknown> = {
    name: "",
    npcType: 0,
    idHead: 0,
    idBody: 0,
    movement: 0,
    aguaValida: 0,
    tierraInvalida: 0,
    exp: 0,
    gold: 0,
    hp: 0,
    maxHp: 0,
    minHit: 0,
    maxHit: 0,
    def: 0,
    poderAtaque: 0,
    poderEvasion: 0,
    magicResistance: 0,
    magicDef: 0,
    defM: 0,
    snd1: 0,
    snd2: 0,
    soundClose: 0,
    spellCastIntervalMs: 0,
    spellRange: 0,
    spells: [],
    objs: [],
    drop: [],
};

const REQUIRED_NPC_KEYS = new Set(["name", "npcType", "idHead", "idBody", "movement"]);

function isSameDefaultValue(value: unknown, defaultValue: unknown): boolean {
    if (Array.isArray(defaultValue)) {
        return Array.isArray(value) && value.length === 0;
    }

    return value === defaultValue;
}

function normalizeNpc(npcData: DataNpc): DataNpc {
    const normalized = {
        ...NPC_DEFAULTS,
        ...npcData,
        spells: Array.isArray(npcData.spells) ? npcData.spells : [],
        objs: Array.isArray(npcData.objs) ? npcData.objs : [],
        drop: Array.isArray(npcData.drop) ? npcData.drop : [],
    } as DataNpc;

    if (typeof npcData.magicDef === "number" && typeof npcData.defM !== "number") {
        normalized.defM = npcData.magicDef;
    }

    if (typeof npcData.defM === "number" && typeof npcData.magicDef !== "number") {
        normalized.magicDef = npcData.defM;
    }

    return normalized;
}

export function normalizeNpcData(npcData: DataNpc): DataNpc {
    return normalizeNpc(npcData);
}

export function normalizeNpcsData(npcsById: NpcsById): NpcsById {
    return Object.fromEntries(Object.entries(npcsById).map(([id, npcData]) => [id, normalizeNpc(npcData)]));
}

export function compactNpcsData(npcsById: NpcsById): NpcsById {
    return Object.fromEntries(
        Object.entries(npcsById).map(([id, npcData]) => {
            const compactedEntries = Object.entries(npcData).filter(([key, value]) => {
                if (typeof value === "undefined") {
                    return false;
                }

                if (REQUIRED_NPC_KEYS.has(key)) {
                    return true;
                }

                const defaultValue = NPC_DEFAULTS[key];

                if (typeof defaultValue === "undefined") {
                    return true;
                }

                return !isSameDefaultValue(value, defaultValue);
            });

            return [id, Object.fromEntries(compactedEntries) as DataNpc];
        }),
    );
}

export function loadNpcsDataFromJsonFile(filePath: string): NpcsById {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeNpcsData(JSON.parse(raw) as NpcsById);
}

type NpcChangesResponse = {
    currentVersion: number;
    changes: Array<{ id: number; version: number; data: DataNpc }>;
};

function getNpcsDbUrl(): string | null {
    return (
        process.env.NPCS_DB_URL ??
        process.env.OBJECTS_DB_URL ??
        process.env.BALANCE_DB_URL ??
        process.env.DATABASE_URL ??
        null
    );
}

function shouldPreferDbSource(): boolean {
    return (process.env.GAME_DATA_SOURCE ?? "").toLowerCase() === "db";
}

function fetchNpcChangesFromApi(): NpcChangesResponse {
    const raw = execFileSync(
        "curl",
        ["-fsSL", `${config.apiBaseUrl}${DEFAULT_NPCS_API_PATH}`, "-H", `Authorization: ${config.tokenAuth}`],
        { encoding: "utf8" },
    );

    return JSON.parse(raw) as NpcChangesResponse;
}

export function loadNpcsDataFromApi(): NpcsById {
    const result = fetchNpcChangesFromApi();

    return normalizeNpcsData(
        Object.fromEntries(result.changes.map((change) => [String(change.id), change.data])) as NpcsById,
    );
}

export function loadNpcsDataFromDb(dbUrl: string): NpcsById {
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
                FROM game_npcs
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
        .map((line) => JSON.parse(line) as { id: number; data: DataNpc });

    return normalizeNpcsData(Object.fromEntries(rows.map((row) => [String(row.id), row.data])) as NpcsById);
}

export function loadDefaultNpcsData(): NpcsById {
    const dbUrl = getNpcsDbUrl();

    if (shouldPreferDbSource() && dbUrl) {
        return loadNpcsDataFromDb(dbUrl);
    }

    try {
        return loadNpcsDataFromApi();
    } catch (apiError) {
        if (dbUrl) {
            return loadNpcsDataFromDb(dbUrl);
        }

        throw apiError;
    }
}

export { DEFAULT_NPCS_API_PATH };
