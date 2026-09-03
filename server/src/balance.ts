export {};

const vars = require("./vars");

const MAX_LEVEL = 50;
const MAX_EXP_LEVEL = 50;
const LAST_LEGACY_EXP_LEVEL = 46;
const MAX_GOLD = 2147483647;

const DEFAULT_CLASS_PROGRESS: Record<
    number,
    { vida: number; manaInicial: number; multMana: number; hitPre36: number; hitPost36: number }
> = {
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
};

const clampLevel = (level: number): number => Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
const clampGold = (gold: number): number => Math.max(0, Math.min(MAX_GOLD, Math.floor(Number(gold) || 0)));

const getClassProgress = () =>
    vars.classProgress && Object.keys(vars.classProgress).length > 0 ? vars.classProgress : DEFAULT_CLASS_PROGRESS;

const getHpAveragePerLevel = (classId: number, constitucion: number): number => {
    const classProgress = getClassProgress()[classId] ?? DEFAULT_CLASS_PROGRESS[1];
    return classProgress.vida - (21 - constitucion) * 0.5;
};

const getMaxHpForLevel = (classId: number, constitucion: number, level: number): number => {
    const safeLevel = clampLevel(level);
    const total = constitucion + getHpAveragePerLevel(classId, constitucion) * (safeLevel - 1);
    return Math.round(total);
};

const getMaxManaForLevel = (classId: number, inteligencia: number, level: number): number => {
    const safeLevel = clampLevel(level);
    const classProgress = getClassProgress()[classId] ?? DEFAULT_CLASS_PROGRESS[1];
    const total = inteligencia * classProgress.manaInicial + classProgress.multMana * inteligencia * (safeLevel - 1);
    return Math.max(0, Math.round(total));
};

const getHitModifierForLevel = (classId: number, level: number): number => {
    const safeLevel = clampLevel(level);
    const classProgress = getClassProgress()[classId] ?? DEFAULT_CLASS_PROGRESS[1];

    if (safeLevel <= 1) {
        return 0;
    }

    if (safeLevel <= 36) {
        return (safeLevel - 1) * classProgress.hitPre36;
    }

    return 35 * classProgress.hitPre36 + (safeLevel - 36) * classProgress.hitPost36;
};

const getMinHitForLevel = (classId: number, level: number): number => 1 + getHitModifierForLevel(classId, level);
const getMaxHitForLevel = (classId: number, level: number): number => 2 + getHitModifierForLevel(classId, level);

const getLegacyExpNextLevelForLevel = (level: number): number => {
    const safeLevel = Math.max(1, Math.min(MAX_EXP_LEVEL, Math.floor(level)));
    const expCurveLevel = Math.min(safeLevel, LAST_LEGACY_EXP_LEVEL);
    let expNextLevel = 300;

    for (let currentLevel = 2; currentLevel <= expCurveLevel; currentLevel += 1) {
        if (currentLevel < 15) {
            expNextLevel = Math.floor(expNextLevel * 1.4);
        } else if (currentLevel < 21) {
            expNextLevel = Math.floor(expNextLevel * 1.35);
        } else if (currentLevel < 33) {
            expNextLevel = Math.floor(expNextLevel * 1.3);
        } else if (currentLevel < 41) {
            expNextLevel = Math.floor(expNextLevel * 1.225);
        } else {
            expNextLevel = Math.floor(expNextLevel * 1.25);
        }
    }

    return expNextLevel;
};

module.exports = {
    MAX_LEVEL,
    MAX_EXP_LEVEL,
    clampLevel,
    clampGold,
    getMaxHpForLevel,
    getMaxManaForLevel,
    getMinHitForLevel,
    getMaxHitForLevel,
    getLegacyExpNextLevelForLevel,
};
