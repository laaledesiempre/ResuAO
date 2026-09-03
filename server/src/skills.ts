import type { EntityId, RuntimeCharacter, RuntimeClient } from "./types/runtime";
import type { GameApi } from "./game";
import type { HandleProtocolApi } from "./handleProtocol";
import { getCharacterById, getClientById } from "./runtimeRegistry";

export {};

const handleProtocol = require("./handleProtocol") as HandleProtocolApi;

// ---------------------------------------------------------------------------
// Sistema de skills progresivos portado del servidor VB6 (ao-libre/ao-server).
//
// Fuentes:
// - Codigo/Declares.bas: NUMSKILLS=20, MAXSKILLPOINTS=100, enum eSkill,
//   EXP_ACIERTO_SKILL=50, EXP_FALLO_SKILL=20, ELU_SKILL_INICIAL=200.
// - Codigo/General.bas: SkillsNames y tabla LevelSkill(1..50).
// - Codigo/Modulo_UsUaRiOs.bas: Sub SubirSkill y CheckEluSkill.
// ---------------------------------------------------------------------------

export const NUMSKILLS = 20;
export const MAXSKILLPOINTS = 100;

// Declares.bas
const EXP_ACIERTO_SKILL = 50;
const EXP_FALLO_SKILL = 20;
const ELU_SKILL_INICIAL = 200;

// Declares.bas: Public Enum eSkill (1-based, igual que el VB6).
export const Skill = {
    Magia: 1,
    Robar: 2,
    Tacticas: 3,
    Armas: 4,
    Meditar: 5,
    Apunalar: 6,
    Ocultarse: 7,
    Supervivencia: 8,
    Talar: 9,
    Comerciar: 10,
    Defensa: 11,
    Pesca: 12,
    Mineria: 13,
    Carpinteria: 14,
    Herreria: 15,
    Liderazgo: 16,
    Domar: 17,
    Proyectiles: 18,
    Wrestling: 19,
    Navegacion: 20,
} as const;

export type SkillId = (typeof Skill)[keyof typeof Skill];

// General.bas: SkillsNames(eSkill.*), indice 0 sin usar (skills 1-based).
export const SKILL_NAMES: string[] = [
    "",
    "Magia",
    "Robar",
    "Evasion en combate",
    "Combate con armas",
    "Meditar",
    "Apunalar",
    "Ocultarse",
    "Supervivencia",
    "Talar",
    "Comercio",
    "Defensa con escudos",
    "Pesca",
    "Mineria",
    "Carpinteria",
    "Herreria",
    "Liderazgo",
    "Domar animales",
    "Combate a distancia",
    "Combate sin armas",
    "Navegacion",
];

// General.bas: tabla LevelSkill(1..50).LevelValue. Indice 0 sin usar.
// A partir de nivel 40 el tope de skill es 100.
const LEVEL_SKILL: number[] = [
    0, 3, 5, 7, 10, 13, 15, 17, 20, 23, 25, 27, 30, 33, 35, 37, 40, 43, 45, 47,
    50, 53, 55, 57, 60, 63, 65, 67, 70, 73, 75, 77, 80, 83, 85, 87, 90, 93, 95,
    97, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
];

function clampSkillValue(value: unknown) {
    return Math.min(MAXSKILLPOINTS, Math.max(0, Math.floor(Number(value) || 0)));
}

export function createDefaultSkills(): number[] {
    return new Array(NUMSKILLS).fill(0);
}

export function createDefaultSkillExp(): number[] {
    return new Array(NUMSKILLS).fill(0);
}

export function normalizeSkills(value: unknown): number[] {
    const input = Array.isArray(value) ? value : [];
    const skills = createDefaultSkills();

    for (let index = 0; index < NUMSKILLS; index++) {
        skills[index] = clampSkillValue(input[index]);
    }

    return skills;
}

export function normalizeSkillExp(value: unknown): number[] {
    const input = Array.isArray(value) ? value : [];
    const skillExp = createDefaultSkillExp();

    for (let index = 0; index < NUMSKILLS; index++) {
        skillExp[index] = Math.max(0, Math.floor(Number(input[index]) || 0));
    }

    return skillExp;
}

export function getSkillValue(user: RuntimeCharacter, skill: SkillId): number {
    return clampSkillValue(user.skills?.[skill - 1]);
}

// Modulo_UsUaRiOs.bas CheckEluSkill: ELU_SKILL_INICIAL * 1.05 ^ UserSkills(Skill)
// (la asignacion a Long trunca).
function getEluSkill(skillValue: number): number {
    return Math.floor(ELU_SKILL_INICIAL * Math.pow(1.05, skillValue));
}

function withUserClient(idUser: EntityId, callback: (client: RuntimeClient) => void) {
    const client = getClientById(idUser);

    if (!client) {
        return;
    }

    callback(client);
}

// Modulo_UsUaRiOs.bas Sub SubirSkill(Userindex, Skill, Acerto).
// Desviacion respecto al VB6 (ver reporte):
// - El VB6 exige Hambre=0 y Sed=0 (totalmente alimentado); en resu el hambre/sed
//   valen 100 cuando el personaje esta saciado.
export function subirSkill(idUser: EntityId, skill: SkillId, acerto: boolean): void {
    const user = getCharacterById(idUser);

    if (!user || user.dead) {
        return;
    }

    if (Number(user.hunger ?? 100) < 100 || Number(user.thirst ?? 100) < 100) {
        return;
    }

    // VB6 SubirSkill: hasta no asignar los 10 skillpoints iniciales
    // (Counters.AsignedSkills) no se puede entrenar ningun skill.
    if ((user.skillsAsignados ?? 0) < 10) {
        // VB6 flags.UltimoMensaje = 7: evita spamear el mensaje.
        if (user.ultimoMensaje !== 7) {
            withUserClient(idUser, (client) => {
                handleProtocol.console(
                    "Para poder entrenar un skill debes asignar los 10 skills iniciales.",
                    "white",
                    0,
                    0,
                    client,
                );
            });
            user.ultimoMensaje = 7;
        }

        return;
    }

    const skills = normalizeSkills(user.skills);
    const skillExp = normalizeSkillExp(user.skillExp);
    const index = skill - 1;

    if (skills[index] >= MAXSKILLPOINTS) {
        user.skills = skills;
        user.skillExp = skillExp;
        return;
    }

    // VB6: If Lvl > UBound(LevelSkill) Then Lvl = UBound(LevelSkill)  (50)
    const level = Math.min(Math.max(1, Math.floor(Number(user.level ?? 1))), 50);

    if (skills[index] >= LEVEL_SKILL[level]) {
        user.skills = skills;
        user.skillExp = skillExp;
        return;
    }

    skillExp[index] += acerto ? EXP_ACIERTO_SKILL : EXP_FALLO_SKILL;

    const elu = getEluSkill(skills[index]);

    if (skillExp[index] < elu) {
        user.skills = skills;
        user.skillExp = skillExp;
        return;
    }

    skills[index] += 1;
    // VB6 CheckEluSkill(Allocation=False): ExpSkills = ExpSkills - EluSkills.
    skillExp[index] -= elu;
    user.skills = skills;
    user.skillExp = skillExp;

    withUserClient(idUser, (client) => {
        handleProtocol.console(
            `Has mejorado tu skill ${SKILL_NAMES[skill]} en un punto! Ahora tienes ${skills[index]} pts.`,
            "white",
            0,
            0,
            client,
        );
    });

    // VB6: .Exp = .Exp + 50 (tope MAXEXP; aca el tope lo impone checkUserLevel
    // con MAX_EXP_LEVEL, que resetea exp al llegar al nivel maximo).
    user.exp = Number(user.exp ?? 0) + 50;

    withUserClient(idUser, (client) => {
        handleProtocol.console("Has ganado 50 puntos de experiencia!", "red", 1, 0, client);
        handleProtocol.selfVitalsDelta(
            {
                hp: Number(user.hp ?? 0),
                maxHp: Number(user.maxHp ?? 0),
                mana: Number(user.mana ?? 0),
                maxMana: Number(user.maxMana ?? 0),
                // El cliente lee hunger/thirst/envenenado antes que skills con
                // guards de bytes: hay que incluirlos para no desalinear el parseo.
                hunger: Number(user.hunger ?? 100),
                thirst: Number(user.thirst ?? 100),
                envenenado: user.envenenado ? 1 : 0,
                skills,
            },
            client,
        );
    });

    // Require perezoso para evitar el ciclo game -> fishing/harvesting -> skills.
    const game = require("./game") as GameApi;
    game.checkUserLevel(idUser);
}

const skillsApi = {
    Skill,
    SKILL_NAMES,
    NUMSKILLS,
    MAXSKILLPOINTS,
    createDefaultSkills,
    createDefaultSkillExp,
    normalizeSkills,
    normalizeSkillExp,
    getSkillValue,
    subirSkill,
};

module.exports = skillsApi;
