import type { EntityId, Position, RuntimeCharacter, RuntimeClient } from "./types/runtime";
import type { GameApi } from "./game";
import type { HandleProtocolApi } from "./handleProtocol";
import { getCharacterById, getClientById } from "./runtimeRegistry";

export {};

const vars = require("./vars");
const funct = require("./functions");
const balance = require("./balance");
const handleProtocol = require("./handleProtocol") as HandleProtocolApi;
const skills = require("./skills");

// ---------------------------------------------------------------------------
// Skill Robar portado del servidor VB6 (ao-libre/ao-server).
//
// Fuentes:
// - Codigo/Trabajo.bas: DoRobar, RobarObjeto, ObjEsRobable.
// - Codigo/Protocol.bas: handler Work, Case eSkill.Robar (validaciones de zona,
//   distancia y target).
// - Codigo/Declares.bas: GUANTE_HURTO=873, vlLadron=25, eClass (Thief=5).
//
// Desviaciones respecto al VB6 (ver reporte del agente):
// - El VB6 dispara el robo con el boton de skill + click en el tile; en resu es
//   el comando /robar apuntando al tile de enfrente (como el ataque melee).
// - No existe EnConsulta, TriggerZonaPelea, comercio entre usuarios ni
//   reputacion (LadronesRep) en resu: esas ramas no aplican.
// - El VB6 solo permite robar a usuarios (no a NPCs).
// - IntervaloPermiteTrabajar no tiene equivalente en resu.
// - MAXORO del VB6 es 200000000; resu usa balance.clampGold.
// ---------------------------------------------------------------------------

// Declares.bas: Public Const GUANTE_HURTO As Integer = 873
const GUANTE_HURTO = 873;

// Declares.bas: eClass.Thief = 5 (clase Ladron, no existe en resu).
const CLASE_LADRON = 5;

// Trabajo.bas DoRobar: If .Stats.MinSta < 15 ... / Call QuitarSta(LadrOnIndex, 15)
const COSTO_STAMINA_ROBAR = 15;

// Protocol.bas Case eSkill.Robar: eTrigger.ZONASEGURA
const TRIGGER_ZONA_SEGURA = 6;

// Inventario de resu (game.putItemToInv usa maxSlots 21).
const MAX_INVENTORY_SLOTS = 21;
const MAX_STACK = 10000;

type RobbingUser = RuntimeCharacter & {
    id: EntityId;
    nameCharacter: string;
    map: number;
    pos: Position;
    heading?: number;
    dead?: number | boolean;
    level?: number;
    idClase?: number;
    idGenero?: number;
    privileges?: number;
    gold?: number;
    criminal?: number | boolean;
    faction?: string;
    seguroActivado?: boolean;
    stamina?: number;
    maxStamina?: number;
    inv: Record<string, { idItem: number; cant: number; equipped?: number | boolean }>;
    idItemRing?: number | string;
};

function getUser(idUser: EntityId) {
    return getCharacterById<RobbingUser>(idUser);
}

function withUserClient(idUser: EntityId | null | undefined, callback: (client: RuntimeClient) => void) {
    const client = getClientById(idUser);

    if (!client) {
        return;
    }

    callback(client);
}

function sendStaminaDelta(user: RobbingUser) {
    withUserClient(user.id, (userClient) => {
        handleProtocol.selfVitalsDelta(
            {
                hp: Number(user.hp ?? 0),
                maxHp: Number(user.maxHp ?? 0),
                mana: Number(user.mana ?? 0),
                maxMana: Number(user.maxMana ?? 0),
                stamina: Number(user.stamina ?? 0),
                maxStamina: Number(user.maxStamina ?? 100),
            },
            userClient,
        );
    });
}

function isCriminal(user: RobbingUser | undefined | null) {
    return Boolean(user?.criminal);
}

// Protocol.bas (Work, Case eSkill.Robar): el robo se hace sobre el tile
// clickeado. En resu se usa el tile de enfrente (igual que attackMele).
function getFrontTileUserId(user: RobbingUser): EntityId | 0 {
    const x = user.pos.x;
    const y = user.pos.y;

    let targetTile;

    switch (user.heading) {
        case 1:
            targetTile = vars.mapData[user.map]?.[y - 1]?.[x];
            break;
        case 2:
            targetTile = vars.mapData[user.map]?.[y + 1]?.[x];
            break;
        case 3:
            targetTile = vars.mapData[user.map]?.[y]?.[x + 1];
            break;
        case 4:
            targetTile = vars.mapData[user.map]?.[y]?.[x - 1];
            break;
    }

    return targetTile?.id ?? 0;
}

function isSafeMapTile(idMap: number, pos: Position) {
    return vars.mapa[idMap]?.[pos.y]?.[pos.x]?.trigger === TRIGGER_ZONA_SEGURA;
}

// Trabajo.bas ObjEsRobable: no llaves, no equipado, no barcos y no newbie.
// (ObjData.Real y ObjData.Caos no existen en los objetos de resu.)
function objEsRobable(victima: RobbingUser, slot: string) {
    const item = victima.inv[slot];

    if (!item || item.equipped) {
        return false;
    }

    const objData = vars.datObj[item.idItem];

    if (!objData) {
        return false;
    }

    return (
        objData.objType !== vars.objType.llaves &&
        objData.objType !== vars.objType.barcos &&
        !objData.newbie
    );
}

// Trabajo.bas TieneObjetosRobables (InvUsuario.bas): algun slot robable.
function tieneObjetosRobables(victima: RobbingUser) {
    return Object.keys(victima.inv ?? {}).some((slot) => objEsRobable(victima, slot));
}

// Agrega el item al inventario del ladron; si no entra, cae al piso
// (Trabajo.bas: If Not MeterItemEnInventario(...) Then TirarItemAlPiso).
function meterItemEnInventarioOPiso(ladron: RobbingUser, idItem: number, cant: number) {
    for (const [slot, item] of Object.entries(ladron.inv)) {
        if (item.idItem === idItem && item.cant + cant <= MAX_STACK) {
            item.cant += cant;
            withUserClient(ladron.id, (userClient) => {
                handleProtocol.agregarUserInvItem(ladron.id, slot, userClient);
            });
            return;
        }
    }

    for (let slot = 1; slot <= MAX_INVENTORY_SLOTS; slot++) {
        const key = String(slot);

        if (!ladron.inv[key]) {
            ladron.inv[key] = { idItem, cant, equipped: 0 };
            withUserClient(ladron.id, (userClient) => {
                handleProtocol.agregarUserInvItem(ladron.id, key, userClient);
            });
            return;
        }
    }

    const game = require("./game") as GameApi;
    game.placeDroppedFloorItem(ladron.map, ladron.pos, idItem, cant);
}

// Trabajo.bas RobarObjeto.
function robarObjeto(ladron: RobbingUser, victima: RobbingUser) {
    const slots = Object.keys(victima.inv ?? {})
        .map((slot) => Number(slot))
        .filter((slot) => Number.isInteger(slot) && slot > 0)
        .sort((a, b) => a - b);

    let slotRobado = 0;

    // VB6: RandomNumber(1, 12) < 6 -> se empieza por el principio o por el final.
    const slotsOrdenados = funct.randomIntFromInterval(1, 12) < 6 ? slots : slots.reverse();

    for (const slot of slotsOrdenados) {
        const item = victima.inv[String(slot)];

        if (!item || item.cant <= 0) {
            continue;
        }

        if (objEsRobable(victima, String(slot)) && funct.randomIntFromInterval(1, 10) < 4) {
            slotRobado = slot;
            break;
        }
    }

    if (slotRobado > 0) {
        const slot = String(slotRobado);
        const item = victima.inv[slot];

        // VB6: cantidad al azar entre el 5% y el 10% del total, con minimo 1.
        const cant = Math.max(
            1,
            funct.randomIntFromInterval(Math.floor(item.cant * 0.05), Math.floor(item.cant * 0.1)),
        );
        const idItem = item.idItem;

        item.cant -= cant;

        if (item.cant <= 0) {
            item.equipped = 0;
            delete victima.inv[slot];
        }

        withUserClient(victima.id, (victimaClient) => {
            handleProtocol.quitarUserInvItem(victima.id, slot, cant, victimaClient);
        });

        meterItemEnInventarioOPiso(ladron, idItem, cant);

        const nombreObj = vars.datObj[idItem]?.name ?? "";

        // VB6: los ladrones "roban", el resto "hurta".
        if (Number(ladron.idClase) === CLASE_LADRON) {
            withUserClient(ladron.id, (userClient) => {
                handleProtocol.console(`Has robado ${cant} ${nombreObj}`, "white", 0, 0, userClient);
            });
        } else {
            withUserClient(ladron.id, (userClient) => {
                handleProtocol.console(`Has hurtado ${cant} ${nombreObj}`, "white", 0, 0, userClient);
            });
        }
    } else {
        withUserClient(ladron.id, (userClient) => {
            handleProtocol.console("No has logrado robar ningun objeto.", "white", 0, 0, userClient);
        });
    }
}

// Trabajo.bas DoRobar. Devuelve true si el robo se intento (consumio stamina).
function doRobar(idLadron: EntityId, idVictima: EntityId): boolean {
    const ladron = getUser(idLadron);
    const victima = getUser(idVictima);

    if (!ladron || !victima) {
        return false;
    }

    // VB6: If Not MapInfo(...).Pk Then Exit Sub — en resu mapData.pk marca la
    // zona segura (ver safeZone.ts).
    if (vars.mapData[ladron.map]?.pk) {
        return false;
    }

    if (ladron.seguroActivado) {
        if (!isCriminal(victima)) {
            withUserClient(idLadron, (userClient) => {
                handleProtocol.console(
                    "Debes quitarte el seguro para robarle a un ciudadano.",
                    "red",
                    1,
                    0,
                    userClient,
                );
            });
            return false;
        }
    } else if (ladron.faction === "armada") {
        if (!isCriminal(victima)) {
            withUserClient(idLadron, (userClient) => {
                handleProtocol.console(
                    "Los miembros del ejercito real no tienen permitido robarle a ciudadanos.",
                    "red",
                    1,
                    0,
                    userClient,
                );
            });
            return false;
        }
    }

    if (victima.faction === "caos" && ladron.faction === "caos") {
        withUserClient(idLadron, (userClient) => {
            handleProtocol.console(
                "No puedes robar a otros miembros de la legion oscura.",
                "red",
                1,
                0,
                userClient,
            );
        });
        return false;
    }

    // VB6: If .Stats.MinSta < 15 Then ... / Call QuitarSta(LadrOnIndex, 15)
    if (Number(ladron.stamina ?? 0) < COSTO_STAMINA_ROBAR) {
        withUserClient(idLadron, (userClient) => {
            if (Number(ladron.idGenero) === Number(vars.genero.hombre)) {
                handleProtocol.console("Estas muy cansado para robar.", "white", 0, 0, userClient);
            } else {
                handleProtocol.console("Estas muy cansada para robar.", "white", 0, 0, userClient);
            }
        });
        return false;
    }

    ladron.stamina = Number(ladron.stamina ?? 0) - COSTO_STAMINA_ROBAR;
    sendStaminaDelta(ladron);

    const guantesHurto = Number(ladron.inv?.[String(ladron.idItemRing ?? 0)]?.idItem ?? 0) === GUANTE_HURTO;

    const robarSkill = skills.getSkillValue(ladron, skills.Skill.Robar);

    // VB6 DoRobar: tabla de suerte segun el skill Robar.
    let suerte: number;

    if (robarSkill <= 10) {
        suerte = 35;
    } else if (robarSkill <= 20) {
        suerte = 30;
    } else if (robarSkill <= 30) {
        suerte = 28;
    } else if (robarSkill <= 40) {
        suerte = 24;
    } else if (robarSkill <= 50) {
        suerte = 22;
    } else if (robarSkill <= 60) {
        suerte = 20;
    } else if (robarSkill <= 70) {
        suerte = 18;
    } else if (robarSkill <= 80) {
        suerte = 15;
    } else if (robarSkill <= 90) {
        suerte = 10;
    } else if (robarSkill < 100) {
        suerte = 7;
    } else {
        suerte = 5;
    }

    if (funct.randomIntFromInterval(1, suerte) < 3) {
        // Exito robo. VB6: solo el ladron (con guantes) roba objetos; el resto oro.
        if (funct.randomIntFromInterval(1, 50) < 25 && Number(ladron.idClase) === CLASE_LADRON) {
            if (tieneObjetosRobables(victima)) {
                robarObjeto(ladron, victima);
            } else {
                withUserClient(idLadron, (userClient) => {
                    handleProtocol.console(`${victima.nameCharacter} no tiene objetos.`, "white", 0, 0, userClient);
                });
            }
        } else if (Number(victima.gold ?? 0) > 0) {
            let cant: number;

            if (Number(ladron.idClase) === CLASE_LADRON) {
                // VB6: sin guantes de hurto el ladron roba un 50% menos.
                if (guantesHurto) {
                    cant = funct.randomIntFromInterval(Number(ladron.level ?? 1) * 50, Number(ladron.level ?? 1) * 100);
                } else {
                    cant = funct.randomIntFromInterval(Number(ladron.level ?? 1) * 25, Number(ladron.level ?? 1) * 50);
                }
            } else {
                cant = funct.randomIntFromInterval(1, 100);
            }

            cant = Math.min(cant, Number(victima.gold ?? 0));

            victima.gold = balance.clampGold(Number(victima.gold ?? 0) - cant);
            ladron.gold = balance.clampGold(Number(ladron.gold ?? 0) + cant);

            withUserClient(idLadron, (userClient) => {
                handleProtocol.console(
                    `Le has robado ${cant} monedas de oro a ${victima.nameCharacter}`,
                    "white",
                    0,
                    0,
                    userClient,
                );
                handleProtocol.actGold(Number(ladron.gold ?? 0), userClient);
            });
            withUserClient(idVictima, (victimaClient) => {
                handleProtocol.actGold(Number(victima.gold ?? 0), victimaClient);
            });
        } else {
            withUserClient(idLadron, (userClient) => {
                handleProtocol.console(`${victima.nameCharacter} no tiene oro.`, "white", 0, 0, userClient);
            });
        }

        skills.subirSkill(idLadron, skills.Skill.Robar, true);
    } else {
        withUserClient(idLadron, (userClient) => {
            handleProtocol.console("No has logrado robar nada!", "white", 0, 0, userClient);
        });
        withUserClient(idVictima, (victimaClient) => {
            handleProtocol.console(`${ladron.nameCharacter} ha intentado robarte!`, "white", 0, 0, victimaClient);
        });

        skills.subirSkill(idLadron, skills.Skill.Robar, false);
    }

    // VB6: robar a un ciudadano te vuelve criminal.
    if (!isCriminal(ladron) && !isCriminal(victima)) {
        const game = require("./game") as GameApi;
        game.hacerCriminal(idLadron);
    }

    return true;
}

// Protocol.bas (Work, Case eSkill.Robar): validaciones previas al DoRobar.
function handleRobar(idUser: EntityId): void {
    const user = getUser(idUser);

    if (!user || user.dead) {
        return;
    }

    // VB6: If MapInfo(.Pos.Map).Pk ... Else "No puedes robar en zonas seguras!"
    if (vars.mapData[user.map]?.pk) {
        withUserClient(idUser, (userClient) => {
            handleProtocol.console("No puedes robar en zonas seguras!", "white", 0, 0, userClient);
        });
        return;
    }

    const idVictima = getFrontTileUserId(user);
    const victima = idVictima ? getUser(idVictima) : null;

    if (!victima || String(victima.id) === String(idUser) || victima.dead) {
        withUserClient(idUser, (userClient) => {
            handleProtocol.console("No hay a quien robarle!", "white", 0, 0, userClient);
        });
        return;
    }

    // VB6: "Can't steal administrative players" (silencioso). En resu los staff
    // tienen privileges 1/2.
    if (Number(victima.privileges ?? 0) === 1 || Number(victima.privileges ?? 0) === 2) {
        return;
    }

    // VB6: no se puede robar estando ni el ladron ni la victima en ZONASEGURA.
    if (isSafeMapTile(victima.map, victima.pos) || isSafeMapTile(user.map, user.pos)) {
        withUserClient(idUser, (userClient) => {
            handleProtocol.console("No puedes robar aqui.", "white", 0, 0, userClient);
        });
        return;
    }

    doRobar(idUser, idVictima);
}

const robbingApi = {
    handleRobar,
    doRobar,
};

export type RobbingApi = typeof robbingApi;

module.exports = robbingApi;
