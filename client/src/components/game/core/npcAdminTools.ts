// Vanilla port of frontend/components/game/core/useNpcAdminTools.ts
// The context-menu / inspector UI is not implemented in the vanilla client
// (admin tooling), so menu state setters are no-ops; the admin actions are
// kept functional in case an admin HUD is added later.
import { createDialogPacket } from "../../../lib/aowProtocol";
import {
    isAdminInspector,
    type InspectableNpc,
    type RevivableCharacter,
} from "../admin/npcInspector";
import type { RefObject } from "../vanilla";
import type { Engine } from "../engine/Engine";

export type NpcAdminToolsOptions = {
    websocketRef: RefObject<WebSocket | null>;
    engineRef: RefObject<Engine | null>;
    playerHudRef: RefObject<any>;
    npcContextMenuOpenedAtRef: RefObject<number>;
};

export function createNpcAdminTools({
    websocketRef,
    engineRef,
    playerHudRef,
}: NpcAdminToolsOptions) {
    const setNpcContextMenu = (_value: any) => undefined;
    const setDeadCharacterContextMenu = (_value: any) => undefined;
    const setInspectedNpc = (_value: any) => undefined;

    const reviveCharacter = (character: RevivableCharacter) => {
        const socket = websocketRef.current;
        const engine = engineRef.current;

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN ||
            !isAdminInspector(engine, playerHudRef.current)
        ) {
            return false;
        }

        socket.send(createDialogPacket(`/revivir ${character.name}`));
        return true;
    };

    const removeNpcFromMap = (npc: InspectableNpc) => {
        const socket = websocketRef.current;
        const engine = engineRef.current;

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN ||
            !isAdminInspector(engine, playerHudRef.current)
        ) {
            return false;
        }

        socket.send(createDialogPacket(`/quitarnpc ${npc.entityId}`));
        return true;
    };

    const removeNpcFromMapPermanently = (npc: InspectableNpc) => {
        const socket = websocketRef.current;
        const engine = engineRef.current;

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN ||
            !isAdminInspector(engine, playerHudRef.current)
        ) {
            return false;
        }

        socket.send(createDialogPacket(`/quitarnpcpermanente ${npc.entityId}`));
        return true;
    };

    return {
        removeNpcFromMap,
        removeNpcFromMapPermanently,
        reviveCharacter,
        setDeadCharacterContextMenu,
        setInspectedNpc,
        setNpcContextMenu,
    };
}
