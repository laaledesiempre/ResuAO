import pool from "../db";
import type { RuntimeTimingConfig } from "../types";

const TIMING_SETTINGS_KEY = "timing";

export const DEFAULT_RUNTIME_TIMING: RuntimeTimingConfig = {
    gameplayTickMs: 50,
    walkStepMs: 200,
    playerStatusTickMs: 500,
    fishingTickMs: 4000,
    npcThinkMs: 650,
    idleCharacterTimeoutMs: 900000,
    idleCharacterSweepMs: 10000,
    cleanupClosedCharactersMs: 60000,
    onlineStatsSnapshotMs: 60000,
    worldSaveMs: 1800000,
    statusDurations: {
        crowdControlUserMs: 8000,
        crowdControlNpcMs: 50000,
        fuerzaAgilidadBuffMs: 90000,
        invisibilitySpellMs: 20000,
        npcAttackMs: 2000,
    },
    actionCooldowns: {
        dialogMs: 500,
        clickMs: 150,
        doorToggleMs: 250,
        meleeMs: 950,
        rangeMs: 950,
        spellMs: 850,
        meleeToSpellMs: 550,
        spellToMeleeMs: 550,
        useItemMs: 250,
        meleeToUseItemMs: 550,
        dropItemMs: 500,
        equipToggleMs: 125,
    },
    visualEffects: {
        invisibilityFadeOutMs: 1250,
        invisibilityFadeInMs: 3000,
        invisibilityMinAlpha: 0,
        invisibilityMaxAlpha: 0.85,
    },
};

const ALLOWED_TIMING_PATHS = new Set([
    "gameplayTickMs",
    "walkStepMs",
    "playerStatusTickMs",
    "fishingTickMs",
    "npcThinkMs",
    "idleCharacterTimeoutMs",
    "idleCharacterSweepMs",
    "cleanupClosedCharactersMs",
    "onlineStatsSnapshotMs",
    "worldSaveMs",
    "statusDurations.crowdControlUserMs",
    "statusDurations.crowdControlNpcMs",
    "statusDurations.fuerzaAgilidadBuffMs",
    "statusDurations.invisibilitySpellMs",
    "statusDurations.npcAttackMs",
    "actionCooldowns.dialogMs",
    "actionCooldowns.clickMs",
    "actionCooldowns.doorToggleMs",
    "actionCooldowns.meleeMs",
    "actionCooldowns.rangeMs",
    "actionCooldowns.spellMs",
    "actionCooldowns.meleeToSpellMs",
    "actionCooldowns.spellToMeleeMs",
    "actionCooldowns.useItemMs",
    "actionCooldowns.meleeToUseItemMs",
    "actionCooldowns.dropItemMs",
    "actionCooldowns.equipToggleMs",
    "visualEffects.invisibilityFadeOutMs",
    "visualEffects.invisibilityFadeInMs",
    "visualEffects.invisibilityMinAlpha",
    "visualEffects.invisibilityMaxAlpha",
]);

type RuntimeSettingRecord = {
    key: string;
    value: RuntimeTimingConfig | null;
};

function cloneDefaultTiming(): RuntimeTimingConfig {
    return JSON.parse(
        JSON.stringify(DEFAULT_RUNTIME_TIMING),
    ) as RuntimeTimingConfig;
}

function normalizeLegacyUseItemTiming(value: unknown): unknown {
    if (!isPlainObject(value)) {
        return value;
    }

    const next = { ...value };
    const actionCooldowns = isPlainObject(next.actionCooldowns)
        ? { ...next.actionCooldowns }
        : null;

    if (!actionCooldowns) {
        return next;
    }

    if (actionCooldowns.useItemMs == null) {
        const clickMs = Number(actionCooldowns.useItemClickMs);
        const uMs = Number(actionCooldowns.useItemUMs);

        if (
            Number.isFinite(clickMs) &&
            clickMs > 0 &&
            Number.isFinite(uMs) &&
            uMs > 0
        ) {
            actionCooldowns.useItemMs = Math.round(
                1000 / (1000 / clickMs + 1000 / uMs),
            );
        } else if (Number.isFinite(clickMs) && clickMs > 0) {
            actionCooldowns.useItemMs = Math.round(clickMs);
        } else if (Number.isFinite(uMs) && uMs > 0) {
            actionCooldowns.useItemMs = Math.round(uMs);
        }
    }

    if (actionCooldowns.meleeToUseItemMs == null) {
        const meleeToUseItemUMs = Number(actionCooldowns.meleeToUseItemUMs);

        if (Number.isFinite(meleeToUseItemUMs) && meleeToUseItemUMs > 0) {
            actionCooldowns.meleeToUseItemMs = Math.round(meleeToUseItemUMs);
        }
    }

    delete actionCooldowns.useItemClickMs;
    delete actionCooldowns.useItemUMs;
    delete actionCooldowns.meleeToUseItemUMs;
    next.actionCooldowns = actionCooldowns;

    return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeTiming(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
): Record<string, unknown> {
    const next = { ...base };

    for (const [key, value] of Object.entries(patch)) {
        const current = next[key];

        if (isPlainObject(current) && isPlainObject(value)) {
            next[key] = mergeTiming(current, value);
            continue;
        }

        next[key] = value;
    }

    return next;
}

function isAlphaTimingPath(path: string): boolean {
    return (
        path === "visualEffects.invisibilityMinAlpha" ||
        path === "visualEffects.invisibilityMaxAlpha"
    );
}

function sanitizeTimingValue(value: unknown, path: string): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        throw new Error(`El valor para ${path} debe ser un numero valido`);
    }

    if (isAlphaTimingPath(path)) {
        if (numericValue < 0 || numericValue > 1) {
            throw new Error(`El valor para ${path} debe estar entre 0 y 1`);
        }

        return Math.round(numericValue * 1000) / 1000;
    }

    if (numericValue <= 0) {
        throw new Error(
            `El valor para ${path} debe ser un numero positivo en milisegundos`,
        );
    }

    return Math.round(numericValue);
}

function sanitizeTimingTree(
    value: unknown,
    defaults: Record<string, unknown>,
    prefix = "",
): Record<string, unknown> {
    const source = isPlainObject(value) ? value : {};
    const result: Record<string, unknown> = {};

    for (const [key, defaultValue] of Object.entries(defaults)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const rawValue = source[key];

        if (isPlainObject(defaultValue)) {
            result[key] = sanitizeTimingTree(rawValue, defaultValue, path);
            continue;
        }

        result[key] = sanitizeTimingValue(rawValue ?? defaultValue, path);
    }

    return result;
}

function setNestedValue(
    target: Record<string, unknown>,
    path: string,
    value: number,
): void {
    const segments = path.split(".");
    let current: Record<string, unknown> = target;

    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        const nextValue = current[segment];

        if (!isPlainObject(nextValue)) {
            current[segment] = {};
        }

        current = current[segment] as Record<string, unknown>;
    }

    current[segments[segments.length - 1] as string] = value;
}

async function saveTimingConfig(
    timing: RuntimeTimingConfig,
): Promise<RuntimeTimingConfig> {
    await pool.query(
        `
      INSERT INTO runtime_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value,
                    updated_at = NOW()
    `,
        [TIMING_SETTINGS_KEY, JSON.stringify(timing)],
    );

    return timing;
}

export async function getRuntimeTimingConfig(): Promise<RuntimeTimingConfig> {
    const defaultTiming = cloneDefaultTiming();

    const result = await pool.query<RuntimeSettingRecord>(
        `
      SELECT key, value
      FROM runtime_settings
      WHERE key = $1
      LIMIT 1
    `,
        [TIMING_SETTINGS_KEY],
    );

    if (!result.rowCount) {
        return saveTimingConfig(defaultTiming);
    }

    const mergedTiming = mergeTiming(
        defaultTiming as unknown as Record<string, unknown>,
        normalizeLegacyUseItemTiming(
            (result.rows[0]?.value ?? {}) as unknown as Record<string, unknown>,
        ) as Record<string, unknown>,
    );
    const sanitizedTiming = sanitizeTimingTree(
        mergedTiming,
        defaultTiming as unknown as Record<string, unknown>,
    ) as RuntimeTimingConfig;

    return saveTimingConfig(sanitizedTiming);
}

export async function updateRuntimeTimingValue(
    path: string,
    value: unknown,
): Promise<RuntimeTimingConfig> {
    const normalizedPath = path.trim();

    if (!ALLOWED_TIMING_PATHS.has(normalizedPath)) {
        throw new Error("Intervalo invalido");
    }

    const nextTiming = cloneDefaultTiming() as unknown as Record<
        string,
        unknown
    >;
    const currentTiming = await getRuntimeTimingConfig();
    const mergedTiming = mergeTiming(
        nextTiming,
        currentTiming as unknown as Record<string, unknown>,
    );
    const sanitizedValue = sanitizeTimingValue(value, normalizedPath);

    setNestedValue(mergedTiming, normalizedPath, sanitizedValue);

    const sanitizedTiming = sanitizeTimingTree(
        mergedTiming,
        DEFAULT_RUNTIME_TIMING as unknown as Record<string, unknown>,
    ) as RuntimeTimingConfig;

    return saveTimingConfig(sanitizedTiming);
}
