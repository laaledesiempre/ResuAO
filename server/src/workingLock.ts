import type { EntityId, RuntimeCharacter } from "./types/runtime";
import { getCharacterById, getClientById } from "./runtimeRegistry";

export {};

const socket = require("./socket");
const vars = require("./vars");

type WorkingCharacter = RuntimeCharacter & {
    id: EntityId;
    fishing?: { active?: boolean; startedAt?: number };
    harvesting?: { active?: boolean; nextTickAt?: number };
};

function getUserIp(idUser: EntityId) {
    const client = getClientById(idUser);

    if (!client) {
        return undefined;
    }

    return socket.getIp(client);
}

function getWorkStartedAt(user: WorkingCharacter | null | undefined) {
    if (user?.fishing?.active) {
        return user.fishing.startedAt ?? 0;
    }

    if (user?.harvesting?.active) {
        return user.harvesting.nextTickAt ?? 0;
    }

    return null;
}

function hasAnotherActiveWorkOnSameIp(idUser: EntityId) {
    const userIp = getUserIp(idUser);

    if (!userIp) {
        return false;
    }

    for (const otherId in vars.personajes) {
        if (String(otherId) === String(idUser)) {
            continue;
        }

        const otherUser = getCharacterById<WorkingCharacter>(otherId);

        if (getWorkStartedAt(otherUser) === null) {
            continue;
        }

        if (getUserIp(otherId) === userIp) {
            return true;
        }
    }

    return false;
}

function shouldCancelForSameIpConflict(idUser: EntityId) {
    const currentUser = getCharacterById<WorkingCharacter>(idUser);
    const currentStartedAt = getWorkStartedAt(currentUser);
    const userIp = getUserIp(idUser);

    if (currentStartedAt === null || !userIp) {
        return false;
    }

    for (const otherId in vars.personajes) {
        if (String(otherId) === String(idUser)) {
            continue;
        }

        const otherUser = getCharacterById<WorkingCharacter>(otherId);
        const otherStartedAt = getWorkStartedAt(otherUser);

        if (otherStartedAt === null || getUserIp(otherId) !== userIp) {
            continue;
        }

        if (otherStartedAt <= currentStartedAt) {
            return true;
        }
    }

    return false;
}

module.exports = {
    hasAnotherActiveWorkOnSameIp,
    shouldCancelForSameIpConflict,
};
