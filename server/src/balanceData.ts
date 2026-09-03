export type RaceBalance = {
    fuerza: number;
    agilidad: number;
    inteligencia: number;
    constitucion: number;
    carisma?: number;
};

export type ClassProgress = {
    vida: number;
    manaInicial: number;
    multMana: number;
    hitPre36: number;
    hitPost36: number;
};

export type RuntimeBalanceData = {
    balanceRazas: Record<number, RaceBalance>;
    classProgress: Record<number, ClassProgress>;
    modEscudo: Record<number, number>;
    modDmgMagia: Record<number, number>;
    modResistenciaMagica: Record<number, number>;
    modDmgWrestling: Record<number, number>;
    modDmgProyectiles: Record<number, number>;
    modDmgArmas: Record<number, number>;
    modAtaqueWrestling: Record<number, number>;
    modAtaqueProyectiles: Record<number, number>;
    modAtaqueArmas: Record<number, number>;
    modEvasion: Record<number, number>;
};

const DEFAULT_BALANCE_DATA: RuntimeBalanceData = {
    balanceRazas: {
        1: { fuerza: 1, agilidad: 1, inteligencia: 0, constitucion: 2, carisma: 0 },
        2: { fuerza: 0, agilidad: 2, inteligencia: 2, constitucion: 1, carisma: 1 },
        3: { fuerza: 2, agilidad: 1, inteligencia: 1, constitucion: 1, carisma: -1 },
        4: { fuerza: 3, agilidad: 0, inteligencia: -3, constitucion: 3, carisma: -1 },
        5: { fuerza: -2, agilidad: 3, inteligencia: 4, constitucion: 0, carisma: 2 },
    },
    classProgress: {
        1: { vida: 7.5, manaInicial: 8.33, multMana: 2.65, hitPre36: 1, hitPost36: 1 },
        2: { vida: 8.5, manaInicial: 2.5, multMana: 2, hitPre36: 2, hitPost36: 2 },
        3: { vida: 10.5, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
        4: { vida: 9, manaInicial: 2.5, multMana: 1, hitPre36: 3, hitPost36: 2 },
        5: { vida: 8, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
        6: { vida: 8.5, manaInicial: 2.5, multMana: 2, hitPre36: 2, hitPost36: 2 },
        7: { vida: 8.5, manaInicial: 2.5, multMana: 2, hitPre36: 2, hitPost36: 2 },
        8: { vida: 10, manaInicial: 2.5, multMana: 1, hitPre36: 3, hitPost36: 2 },
        9: { vida: 10, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
        10: { vida: 8.5, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
        11: { vida: 10, manaInicial: 0, multMana: 0, hitPre36: 3, hitPost36: 2 },
    },
    modEscudo: { 1: 0, 2: 0.8, 3: 1, 4: 0.8, 6: 0.65, 7: 0, 8: 0.9, 9: 0.75 },
    modDmgMagia: { 1: 1, 2: 0.88, 3: 0, 4: 0.76, 6: 0.93, 7: 0.92, 8: 0.78, 9: 0 },
    modResistenciaMagica: { 1: 0, 2: 4, 3: 12, 4: 5, 6: 2, 7: 3, 8: 5, 9: 6 },
    modDmgWrestling: { 1: 0.4, 2: 0.4, 3: 0.4, 4: 0.4, 6: 0.4, 7: 0.4, 8: 0.4, 9: 0.4 },
    modDmgProyectiles: { 1: 0.5, 2: 0.75, 3: 0.87, 4: 0.75, 6: 0.75, 7: 0.75, 8: 0.8, 9: 0.93 },
    modDmgArmas: { 1: 0.5, 2: 0.85, 3: 1.05, 4: 0.95, 6: 0.82, 7: 0.75, 8: 1, 9: 0.85 },
    modAtaqueWrestling: { 1: 0.5, 2: 0.93, 3: 1.1, 4: 1, 6: 0.8, 7: 0.75, 8: 1, 9: 0.8 },
    modAtaqueProyectiles: { 1: 0.5, 2: 0.8, 3: 0.85, 4: 0.7, 6: 0.7, 7: 0.6, 8: 0.78, 9: 0.95 },
    modAtaqueArmas: { 1: 0.5, 2: 0.98, 3: 1.1, 4: 1, 6: 0.88, 7: 0.8, 8: 1.03, 9: 0.8 },
    modEvasion: { 1: 0.2, 2: 0.8, 3: 1, 4: 0.9, 6: 1, 7: 0.9, 8: 0.85, 9: 0.9 },
};

function cloneNumericRecord<T>(record: Record<number, T>): Record<number, T> {
    return Object.fromEntries(
        Object.entries(record).map(([key, value]) => [Number(key), structuredClone(value)]),
    ) as Record<number, T>;
}

function cloneToSparseArray<T>(record: Record<number, T>): T[] {
    const target: T[] = [];

    for (const [rawKey, value] of Object.entries(record)) {
        target[Number(rawKey)] = structuredClone(value);
    }

    return target;
}

function cloneDefaults(): RuntimeBalanceData {
    return {
        balanceRazas: cloneNumericRecord(DEFAULT_BALANCE_DATA.balanceRazas),
        classProgress: cloneNumericRecord(DEFAULT_BALANCE_DATA.classProgress),
        modEscudo: cloneNumericRecord(DEFAULT_BALANCE_DATA.modEscudo),
        modDmgMagia: cloneNumericRecord(DEFAULT_BALANCE_DATA.modDmgMagia),
        modResistenciaMagica: cloneNumericRecord(DEFAULT_BALANCE_DATA.modResistenciaMagica),
        modDmgWrestling: cloneNumericRecord(DEFAULT_BALANCE_DATA.modDmgWrestling),
        modDmgProyectiles: cloneNumericRecord(DEFAULT_BALANCE_DATA.modDmgProyectiles),
        modDmgArmas: cloneNumericRecord(DEFAULT_BALANCE_DATA.modDmgArmas),
        modAtaqueWrestling: cloneNumericRecord(DEFAULT_BALANCE_DATA.modAtaqueWrestling),
        modAtaqueProyectiles: cloneNumericRecord(DEFAULT_BALANCE_DATA.modAtaqueProyectiles),
        modAtaqueArmas: cloneNumericRecord(DEFAULT_BALANCE_DATA.modAtaqueArmas),
        modEvasion: cloneNumericRecord(DEFAULT_BALANCE_DATA.modEvasion),
    };
}

function normalizeNumericRecord<T extends Record<string, unknown>>(
    input: unknown,
    defaults: Record<number, T>,
): Record<number, T> {
    const normalized = cloneNumericRecord(defaults);

    if (!input || typeof input !== "object") {
        return normalized;
    }

    for (const [rawKey, value] of Object.entries(input as Record<string, unknown>)) {
        const key = Number(rawKey);

        if (!Number.isInteger(key) || !value || typeof value !== "object") {
            continue;
        }

        normalized[key] = {
            ...(normalized[key] ?? {}),
            ...(value as T),
        };
    }

    return normalized;
}

function normalizeNumberMap(input: unknown, defaults: Record<number, number>): Record<number, number> {
    const normalized = cloneNumericRecord(defaults);

    if (!input || typeof input !== "object") {
        return normalized;
    }

    for (const [rawKey, value] of Object.entries(input as Record<string, unknown>)) {
        const key = Number(rawKey);
        const numberValue = Number(value);

        if (!Number.isInteger(key) || !Number.isFinite(numberValue)) {
            continue;
        }

        normalized[key] = numberValue;
    }

    return normalized;
}

export function createDefaultBalanceData(): RuntimeBalanceData {
    return cloneDefaults();
}

export function normalizeBalanceData(input: unknown): RuntimeBalanceData {
    return {
        balanceRazas: normalizeNumericRecord(
            input && (input as RuntimeBalanceData).balanceRazas,
            DEFAULT_BALANCE_DATA.balanceRazas,
        ),
        classProgress: normalizeNumericRecord(
            input && (input as RuntimeBalanceData).classProgress,
            DEFAULT_BALANCE_DATA.classProgress,
        ),
        modEscudo: normalizeNumberMap(input && (input as RuntimeBalanceData).modEscudo, DEFAULT_BALANCE_DATA.modEscudo),
        modDmgMagia: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modDmgMagia,
            DEFAULT_BALANCE_DATA.modDmgMagia,
        ),
        modResistenciaMagica: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modResistenciaMagica,
            DEFAULT_BALANCE_DATA.modResistenciaMagica,
        ),
        modDmgWrestling: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modDmgWrestling,
            DEFAULT_BALANCE_DATA.modDmgWrestling,
        ),
        modDmgProyectiles: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modDmgProyectiles,
            DEFAULT_BALANCE_DATA.modDmgProyectiles,
        ),
        modDmgArmas: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modDmgArmas,
            DEFAULT_BALANCE_DATA.modDmgArmas,
        ),
        modAtaqueWrestling: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modAtaqueWrestling,
            DEFAULT_BALANCE_DATA.modAtaqueWrestling,
        ),
        modAtaqueProyectiles: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modAtaqueProyectiles,
            DEFAULT_BALANCE_DATA.modAtaqueProyectiles,
        ),
        modAtaqueArmas: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modAtaqueArmas,
            DEFAULT_BALANCE_DATA.modAtaqueArmas,
        ),
        modEvasion: normalizeNumberMap(
            input && (input as RuntimeBalanceData).modEvasion,
            DEFAULT_BALANCE_DATA.modEvasion,
        ),
    };
}

export function applyBalanceDataToVars(targetVars: Record<string, unknown>, input: unknown): RuntimeBalanceData {
    const balanceData = normalizeBalanceData(input);

    targetVars.balanceRazas = cloneToSparseArray(balanceData.balanceRazas);
    targetVars.classProgress = cloneToSparseArray(balanceData.classProgress);
    targetVars.modEscudo = cloneToSparseArray(balanceData.modEscudo);
    targetVars.modDmgMagia = cloneToSparseArray(balanceData.modDmgMagia);
    targetVars.modResistenciaMagica = cloneToSparseArray(balanceData.modResistenciaMagica);
    targetVars.modDmgWrestling = cloneToSparseArray(balanceData.modDmgWrestling);
    targetVars.modDmgProyectiles = cloneToSparseArray(balanceData.modDmgProyectiles);
    targetVars.modDmgArmas = cloneToSparseArray(balanceData.modDmgArmas);
    targetVars.modAtaqueWrestling = cloneToSparseArray(balanceData.modAtaqueWrestling);
    targetVars.modAtaqueProyectiles = cloneToSparseArray(balanceData.modAtaqueProyectiles);
    targetVars.modAtaqueArmas = cloneToSparseArray(balanceData.modAtaqueArmas);
    targetVars.modEvasion = cloneToSparseArray(balanceData.modEvasion);

    return balanceData;
}
