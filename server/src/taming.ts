import type { EntityId, Position, RuntimeCharacter, RuntimeClient, RuntimeNpc } from "./types/runtime";
import type { HandleProtocolApi } from "./handleProtocol";
import type { NpcsApi } from "./npcs";
import { getCharacterById } from "./runtimeRegistry";

export {};

const vars = require("./vars");
const handleProtocol = require("./handleProtocol") as HandleProtocolApi;

// ---------------------------------------------------------------------------
// Doma de mascotas portada del servidor VB6 (ao-libre/ao-server).
//
// En el VB6 no existe un comando /DOMAR: el jugador usa el skill Domar
// (eSkill.Domar) con la tecla de trabajo y clickea la criatura (Protocol.bas
// HandleWork caso eSkill.Domar, distancia <= 2). En Resu el equivalente mas
// cercano es el comando /DOMAR, que deja el targeteo pendiente y resuelve la
// criatura al clickear el mapa (patron fishing/harvesting pendingTarget).
// La logica de la doma vive en npcs.doDomar (Trabajo.bas DoDomar).
// ---------------------------------------------------------------------------

type TamingUser = RuntimeCharacter & {
    id: EntityId;
    map: number;
    pos: Position;
    taming?: {
        pendingTarget?: boolean;
    };
};

function getUser(idUser: EntityId) {
    return getCharacterById<TamingUser>(idUser);
}

function getNpcsApi() {
    return require("./npcs") as NpcsApi;
}

const taming = {
    startTaming(ws: RuntimeClient) {
        const user = getUser(ws.id!);

        if (!user) {
            return;
        }

        if (user.dead) {
            handleProtocol.console("Los muertos no pueden domar.", "white", 0, 0, ws);
            return;
        }

        user.taming = { pendingTarget: true };
        handleProtocol.console("Selecciona la criatura que quieres domar.", "#fcd34d", 0, 0, ws);
    },

    cancelTaming(idUser: EntityId) {
        const user = getUser(idUser);

        if (user?.taming) {
            user.taming = undefined;
        }
    },

    handleMapClick(ws: RuntimeClient, x: number, y: number) {
        const user = getUser(ws.id!);

        if (!user || !user.taming?.pendingTarget) {
            return false;
        }

        user.taming = undefined;

        const tileId = vars.mapData[user.map]?.[y]?.[x]?.id;
        const npc = tileId ? (vars.npcs[tileId] as RuntimeNpc | undefined) : undefined;

        if (!npc) {
            // VB6 Protocol.bas HandleWork eSkill.Domar.
            handleProtocol.console("No hay ninguna criatura alli!", "white", 0, 0, ws);
            return true;
        }

        getNpcsApi().doDomar(user.id, npc.id);
        return true;
    },
};

module.exports = taming;
