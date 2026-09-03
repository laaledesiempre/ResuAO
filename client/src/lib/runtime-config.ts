export type RuntimeTimingConfig = {
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
    visualEffects: {
        invisibilityFadeOutMs: number;
        invisibilityFadeInMs: number;
        invisibilityMinAlpha: number;
        invisibilityMaxAlpha: number;
    };
};

export type ClientRuntimeTimingConfig = {
    walkStepMs: number;
    actionCooldowns: RuntimeTimingConfig["actionCooldowns"];
    visualEffects: RuntimeTimingConfig["visualEffects"];
};

export type RuntimeConfigResponse = {
    timing: RuntimeTimingConfig;
};

export type ClientRuntimeConfigResponse = {
    timing: ClientRuntimeTimingConfig;
};

const IS_TEST_DEPLOYMENT = process.env.RESU_TEST_MODE === "true";
const TEST_WALK_STEP_MS = 200;

export function applyRuntimeTimingEnvironmentOverrides(
    timing: RuntimeTimingConfig,
): RuntimeTimingConfig {
    if (!IS_TEST_DEPLOYMENT) {
        return timing;
    }

    return {
        ...timing,
        walkStepMs: TEST_WALK_STEP_MS,
    };
}

export const DEFAULT_RUNTIME_TIMING: RuntimeTimingConfig =
    applyRuntimeTimingEnvironmentOverrides({
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
            spellMs: 1000,
            meleeToSpellMs: 800,
            spellToMeleeMs: 800,
            useItemMs: 250,
            meleeToUseItemMs: 800,
            dropItemMs: 150,
            equipToggleMs: 125,
        },
        visualEffects: {
            invisibilityFadeOutMs: 350,
            invisibilityFadeInMs: 1800,
            invisibilityMinAlpha: 0,
            invisibilityMaxAlpha: 0.8,
        },
    });

export function mergeClientRuntimeTiming(
    timing: ClientRuntimeTimingConfig,
): RuntimeTimingConfig {
    return applyRuntimeTimingEnvironmentOverrides({
        ...DEFAULT_RUNTIME_TIMING,
        walkStepMs: timing.walkStepMs,
        actionCooldowns: {
            ...DEFAULT_RUNTIME_TIMING.actionCooldowns,
            ...timing.actionCooldowns,
        },
        visualEffects: {
            ...DEFAULT_RUNTIME_TIMING.visualEffects,
            ...timing.visualEffects,
        },
    });
}
