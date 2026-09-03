import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

export type MapNpcPlacement = {
    mapNum: number;
    x: number;
    y: number;
    npcIndex: number;
    movement?: number;
};

const MAP_DIR_PATTERN = /^mapa_(\d+)$/i;

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function normalizePlacement(
    value: unknown,
    fallbackMapNum?: number,
): MapNpcPlacement | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const mapNum = toFiniteNumber(candidate.mapNum) ?? fallbackMapNum ?? null;
    const x = toFiniteNumber(candidate.x);
    const y = toFiniteNumber(candidate.y);
    const npcIndex = toFiniteNumber(candidate.npcIndex);
    const movement = toFiniteNumber(candidate.movement);

    if (
        mapNum === null ||
        !Number.isInteger(mapNum) ||
        mapNum <= 0 ||
        x === null ||
        !Number.isInteger(x) ||
        x <= 0 ||
        y === null ||
        !Number.isInteger(y) ||
        y <= 0 ||
        npcIndex === null ||
        !Number.isInteger(npcIndex) ||
        npcIndex <= 0
    ) {
        return null;
    }

    return movement !== null && Number.isInteger(movement)
        ? { mapNum, x, y, npcIndex, movement }
        : { mapNum, x, y, npcIndex };
}

function sortPlacements(placements: MapNpcPlacement[]): MapNpcPlacement[] {
    return [...placements].sort(
        (left, right) =>
            left.mapNum - right.mapNum ||
            left.y - right.y ||
            left.x - right.x ||
            left.npcIndex - right.npcIndex,
    );
}

export async function listAvailableMapIds(
    sourceDir: string,
): Promise<number[]> {
    if (!existsSync(sourceDir)) {
        return [];
    }

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name.match(MAP_DIR_PATTERN))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map((match) => Number.parseInt(match[1], 10))
        .filter((mapId) => Number.isInteger(mapId) && mapId > 0)
        .sort((left, right) => left - right);
}

export async function loadMapNpcPlacements(
    mapsSourceDir: string,
    mapNum: number,
): Promise<MapNpcPlacement[]> {
    const filePath = path.join(mapsSourceDir, `mapa_${mapNum}`, "npcs.json");

    if (!existsSync(filePath)) {
        return [];
    }

    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
        return [];
    }

    return sortPlacements(
        parsed
            .map((entry) => normalizePlacement(entry, mapNum))
            .filter((entry): entry is MapNpcPlacement => Boolean(entry)),
    );
}

export async function loadAllMapNpcPlacements(
    mapsSourceDir: string,
): Promise<MapNpcPlacement[]> {
    const mapIds = await listAvailableMapIds(mapsSourceDir);
    const placements = await Promise.all(
        mapIds.map((mapId) => loadMapNpcPlacements(mapsSourceDir, mapId)),
    );

    return sortPlacements(placements.flat());
}
