import type { GameApi } from "./game";
import type { HandleProtocolApi } from "./handleProtocol";
import type { EntityId, RuntimeCharacter, RuntimeClient, RuntimeCharacters, RuntimeClients } from "./types/runtime";

export {};

const vars = require("./vars");
const funct = require("./functions");
const game = require("./game") as GameApi;
const handleProtocol = require("./handleProtocol") as HandleProtocolApi;

// Correo entre jugadores del VB6 (Codigo/ModCorreo.bas, "Correo Ladder
// 22/11/2017" del codigo oficial de SourceForge; ao-libre no lo incluye).
// MAX_CORREOS_SLOTS (Declares.bas): tope de mensajes por personaje.
const MAX_CORREOS_SLOTS = 60;

type CorreoMessage = {
    id: string;
    remitente: string;
    mensaje: string;
    item: string;
    itemCount: number;
    leido: boolean;
    fecha: string;
};

function getCharacter(idUser: EntityId) {
    return (vars.personajes as RuntimeCharacters)[String(idUser)] as RuntimeCharacter & {
        id: EntityId;
        _id?: string;
        nameCharacter: string;
    };
}

function getClient(idUser: EntityId) {
    return (vars.clients as RuntimeClients)[String(idUser)] as RuntimeClient;
}

// VB6 NameIndex: busca un personaje conectado por nombre (sin distincion de
// mayusculas, como LOWER(TRIM(name)) en la API).
function findOnlineCharacterByName(name: string) {
    const normalized = name.trim().toLowerCase();

    for (const user of Object.values(vars.personajes) as Array<ReturnType<typeof getCharacter>>) {
        if (String(user?.nameCharacter ?? "").trim().toLowerCase() === normalized) {
            return user;
        }
    }

    return undefined;
}

// VB6 AddCorreo: Fecha = Date & " - " & Time (formato local es-AR).
function formatFechaCorreo(now: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");

    return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} - ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function fetchCorreoList(characterId: string): Promise<CorreoMessage[]> {
    const result = (await funct.fetchUrl(`/internal/correo/${encodeURIComponent(characterId)}`, {
        headers: {
            Authorization: vars.tokenAuth,
        },
    })) as { mensajes?: CorreoMessage[] };

    return result.mensajes ?? [];
}

// VB6 WriteListaCorreo: envia la lista completa; al listar se apaga el aviso
// de mensajes nuevos (PrepareMessageListaCorreo pone Correo.NoLeidos = 0).
async function sendCorreoState(ws: RuntimeClient, markRead: boolean): Promise<void> {
    const user = getCharacter(ws.id!);

    if (!user?._id) {
        return;
    }

    const mensajes = await fetchCorreoList(user._id);

    if (markRead) {
        await funct.fetchUrl(`/internal/correo/${encodeURIComponent(user._id)}/read`, {
            method: "POST",
            headers: {
                Authorization: vars.tokenAuth,
            },
        });
    }

    handleProtocol.openCorreo(
        {
            mensajes: mensajes.map((mensaje, position) => ({
                index: position + 1,
                id: mensaje.id,
                remitente: mensaje.remitente,
                mensaje: mensaje.mensaje,
                item: mensaje.item,
                itemCount: mensaje.itemCount,
                leido: mensaje.leido,
                fecha: mensaje.fecha,
            })),
        },
        ws,
    );
}

const correo = {
    // VB6 HandleCorreo (packet Correo): pide la lista del correo.
    async list(ws: RuntimeClient): Promise<void> {
        if (!game.existPjOrClose(ws)) {
            return;
        }

        try {
            await sendCorreoState(ws, true);
        } catch (err) {
            funct.dumpError(err);
        }
    },

    // VB6 HandleSendCorreo + AddCorreo (solo texto; el envio de items del
    // VB6 queda fuera, ver reporte). Textos exactos del VB6.
    async send(ws: RuntimeClient, destinatario: string, mensaje: string): Promise<void> {
        if (!game.existPjOrClose(ws)) {
            return;
        }

        const user = getCharacter(ws.id!);

        if (!user) {
            return;
        }

        const nick = destinatario.trim();
        const texto = mensaje.trim();

        if (!nick || !texto) {
            return;
        }

        try {
            const receptorOnline = findOnlineCharacterByName(nick);
            const result = (await funct.fetchUrl("/internal/correo", {
                method: "POST",
                body: JSON.stringify({
                    recipientName: nick,
                    remitente: user.nameCharacter,
                    mensaje: texto,
                    item: "",
                    itemCount: 0,
                    fecha: formatFechaCorreo(new Date()),
                }),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: vars.tokenAuth,
                },
            })) as { status?: string };

            if (result.status === "not_found") {
                // VB6 AddCorreo: "El personaje no existe."
                handleProtocol.console("El personaje no existe.", "white", 0, 0, ws);
                return;
            }

            if (result.status === "full") {
                // VB6 AddCorreo: receptor online -> "No hay mas espacio para
                // correos."; receptor offline (charfile CantCorreo = 60) ->
                // "El correo del personaje esta lleno."
                handleProtocol.console(
                    receptorOnline ? "No hay mas espacio para correos." : "El correo del personaje esta lleno.",
                    "white",
                    0,
                    0,
                    ws,
                );
                return;
            }

            // VB6 AddCorreo: "Mensaje enviado."
            handleProtocol.console("Mensaje enviado.", "white", 0, 0, ws);

            if (receptorOnline) {
                // VB6 AddCorreo: aviso al receptor y CorreoPicOn.
                const receptorClient = getClient(receptorOnline.id);

                if (receptorClient) {
                    handleProtocol.console(
                        `Has recibido un nuevo mensaje de ${user.nameCharacter} ve a un correo local para leerlo.`,
                        "white",
                        0,
                        0,
                        receptorClient,
                    );
                    handleProtocol.correoPicOn(receptorClient);
                }
            }
        } catch (err) {
            funct.dumpError(err);
        }
    },

    // VB6 HandleBorrarCorreo + BorrarCorreoMail + SortCorreos: borra el
    // mensaje (1-based, como llega en la lista) y reenvia la lista
    // actualizada (WriteListaCorreo con actualizar = True).
    async remove(ws: RuntimeClient, index: number): Promise<void> {
        if (!game.existPjOrClose(ws)) {
            return;
        }

        const user = getCharacter(ws.id!);

        if (!user?._id) {
            return;
        }

        try {
            const mensajes = await fetchCorreoList(user._id);
            const target = mensajes[index - 1];

            if (!target) {
                return;
            }

            await funct.fetchUrl(
                `/internal/correo/${encodeURIComponent(user._id)}/${encodeURIComponent(target.id)}`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: vars.tokenAuth,
                    },
                },
            );

            await sendCorreoState(ws, false);
        } catch (err) {
            funct.dumpError(err);
        }
    },

    // VB6 TCP.bas (login): If .Correo.NoLeidos > 0 Then WriteCorreoPicOn.
    checkUnreadOnLogin(ws: RuntimeClient): void {
        const user = getCharacter(ws.id!);

        if (!user?._id) {
            return;
        }

        void funct
            .fetchUrl(`/internal/correo/${encodeURIComponent(user._id)}/unread`, {
                headers: {
                    Authorization: vars.tokenAuth,
                },
            })
            .then((result: { unread?: number }) => {
                if (Number(result?.unread ?? 0) > 0) {
                    handleProtocol.correoPicOn(ws);
                }
            })
            .catch((error: unknown) => {
                funct.dumpError(error);
            });
    },
};

module.exports = correo;
