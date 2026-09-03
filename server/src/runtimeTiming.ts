export {};

type RuntimeTimingConfig = {
    gameplayTickMs: number;
    walkStepMs: number;
    playerStatusTickMs: number;
    fishingTickMs: number;
    npcThinkMs: number;
    idleCharacterTimeoutMs: number;
    idleCharacterSweepMs: number;
    cleanupClosedCharactersMs: number;
    onlineStatsSnapshotMs: number;
    worldSaveMs: number;
    statusDurations: {
        crowdControlUserMs: number;
        crowdControlNpcMs: number;
        fuerzaAgilidadBuffMs: number;
        invisibilitySpellMs: number;
        npcAttackMs: number;
    };
    actionCooldowns: {
        dialogMs: number;
        clickMs: number;
        doorToggleMs: number;
        meleeMs: number;
        rangeMs: number;
        spellMs: number;
        meleeToSpellMs: number;
        spellToMeleeMs: number;
        useItemMs: number;
        meleeToUseItemMs: number;
        dropItemMs: number;
        equipToggleMs: number;
    };
    rateLimitWindows: {
        positionWindowMs: number;
        attackWindowMs: number;
        rangeAttackWindowMs: number;
        attackSpellWindowMs: number;
        useItemWindowMs: number;
    };
    visualEffects: {
        invisibilityFadeOutMs: number;
        invisibilityFadeInMs: number;
        invisibilityMinAlpha: number;
        invisibilityMaxAlpha: number;
    };
};

type RuntimeConfigResponse = {
    timing: RuntimeTimingConfig;
};

type RuntimeTimingApi = {
    DEFAULT_RUNTIME_TIMING: RuntimeTimingConfig;
    applyRuntimeTimingConfig: (timing: RuntimeTimingConfig) => RuntimeTimingConfig;
    loadRuntimeTimingConfig: () => Promise<RuntimeTimingConfig>;
    updateRuntimeTimingValue: (path: string, value: number) => Promise<RuntimeTimingConfig>;
    listRuntimeTimingEntries: () => Array<{ path: string; value: number }>;
    onRuntimeTimingChange: (listener: (timing: RuntimeTimingConfig) => void) => void;
};

const vars = require("./vars");
const funct = require("./functions");
const config = require("./config");

const TEST_WALK_STEP_MS = 200;

const DEFAULT_RUNTIME_TIMING = JSON.parse(JSON.stringify(vars.timing)) as RuntimeTimingConfig;

const listeners: Array<(timing: RuntimeTimingConfig) => void> = [];

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeTiming(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
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
    return path === "visualEffects.invisibilityMinAlpha" || path === "visualEffects.invisibilityMaxAlpha";
}

function sanitizeTimingValue(value: unknown, fallback: number, path: string): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    if (isAlphaTimingPath(path)) {
        if (numericValue < 0 || numericValue > 1) {
            return fallback;
        }

        return Math.round(numericValue * 1000) / 1000;
    }

    if (numericValue <= 0) {
        return fallback;
    }

    return Math.round(numericValue);
}

function sanitizeTimingTree(value: unknown, defaults: Record<string, unknown>, prefix = ""): Record<string, unknown> {
    const source = isPlainObject(value) ? value : {};
    const result: Record<string, unknown> = {};

    for (const [key, defaultValue] of Object.entries(defaults)) {
        const rawValue = source[key];
        const path = prefix ? `${prefix}.${key}` : key;

        if (isPlainObject(defaultValue)) {
            result[key] = sanitizeTimingTree(rawValue, defaultValue, path);
            continue;
        }

        result[key] = sanitizeTimingValue(rawValue, defaultValue as number, path);
    }

    return result;
}

function flattenTimingEntries(value: Record<string, unknown>, prefix = ""): Array<{ path: string; value: number }> {
    const entries: Array<{ path: string; value: number }> = [];

    for (const [key, nextValue] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;

        if (isPlainObject(nextValue)) {
            entries.push(...flattenTimingEntries(nextValue, path));
            continue;
        }

        entries.push({ path, value: Number(nextValue) || 0 });
    }

    return entries;
}

function applyEnvironmentTimingOverrides(timing: RuntimeTimingConfig): RuntimeTimingConfig {
    if (!config.isTestDeployment) {
        return timing;
    }

    return {
        ...timing,
        walkStepMs: TEST_WALK_STEP_MS,
    };
}

function notifyTimingListeners(timing: RuntimeTimingConfig): void {
    for (const listener of listeners) {
        listener(timing);
    }
}

const runtimeTiming: RuntimeTimingApi = {
    DEFAULT_RUNTIME_TIMING,

    applyRuntimeTimingConfig(timing) {
        const mergedTiming = mergeTiming(
            JSON.parse(JSON.stringify(DEFAULT_RUNTIME_TIMING)) as Record<string, unknown>,
            timing as unknown as Record<string, unknown>,
        );
        const sanitizedTiming = sanitizeTimingTree(
            mergedTiming,
            DEFAULT_RUNTIME_TIMING as unknown as Record<string, unknown>,
        ) as RuntimeTimingConfig;

        const finalTiming = applyEnvironmentTimingOverrides(sanitizedTiming);

        vars.timing = finalTiming;
        notifyTimingListeners(finalTiming);

        return finalTiming;
    },

    async loadRuntimeTimingConfig() {
        try {
            const result = (await funct.fetchUrl("/internal/runtime-config", {
                cache: "no-store",
                headers: {
                    Authorization: vars.tokenAuth,
                },
            })) as RuntimeConfigResponse;

            return runtimeTiming.applyRuntimeTimingConfig(result.timing);
        } catch (err) {
            funct.dumpError(err);
            return runtimeTiming.applyRuntimeTimingConfig(vars.timing as RuntimeTimingConfig);
        }
    },

    async updateRuntimeTimingValue(path, value) {
        const result = (await funct.fetchUrl("/internal/runtime-config/timing", {
            method: "PUT",
            body: JSON.stringify({ path, value }),
            headers: {
                "Content-Type": "application/json",
                Authorization: vars.tokenAuth,
            },
        })) as RuntimeConfigResponse;

        return runtimeTiming.applyRuntimeTimingConfig(result.timing);
    },

    listRuntimeTimingEntries() {
        return flattenTimingEntries(vars.timing as Record<string, unknown>);
    },

    onRuntimeTimingChange(listener) {
        listeners.push(listener);
    },
};

module.exports = runtimeTiming;
