import type { EntityId, RuntimeCharacter, RuntimeClient } from "./types/runtime";

export {};

const vars = require("./vars");

export function getCharacterById<TCharacter extends RuntimeCharacter = RuntimeCharacter>(
    idUser: EntityId | null | undefined,
): TCharacter | undefined {
    if (typeof idUser === "undefined" || idUser === null) {
        return;
    }

    return vars.personajes[String(idUser)] as TCharacter | undefined;
}

export function getClientById<TClient extends RuntimeClient = RuntimeClient>(
    idUser: EntityId | null | undefined,
): TClient | undefined {
    if (typeof idUser === "undefined" || idUser === null) {
        return;
    }

    return vars.clients[String(idUser)] as TClient | undefined;
}

export function hasOpenClientById(idUser: EntityId | null | undefined): boolean {
    const client = getClientById(idUser);
    return Boolean(client && client.readyState === client.OPEN);
}

export function isCharacterOnlineById(idUser: EntityId | null | undefined): boolean {
    const user = getCharacterById(idUser);
    return Boolean(user && user.connected && !user.cerrado && hasOpenClientById(idUser));
}

export function getOnlineSessionById<
    TCharacter extends RuntimeCharacter = RuntimeCharacter,
    TClient extends RuntimeClient = RuntimeClient,
>(idUser: EntityId | null | undefined): { user: TCharacter; client: TClient } | undefined {
    const user = getCharacterById<TCharacter>(idUser);
    const client = getClientById<TClient>(idUser);

    if (!user || !client || user.cerrado || !user.connected || client.readyState !== client.OPEN) {
        return;
    }

    return { user, client };
}
