// Vanilla port of frontend/components/game/session/useOutgoingRequests.ts
// The 21 React effects (one per request prop) become explicit methods the
// UI calls directly. The use-item queueing logic is unchanged.
import {
    createBuyItemPacket,
    createChangeBankTabPacket,
    createCloseTradePacket,
    createCraftItemPacket,
    createDepositBankGoldPacket,
    createDropItemPacket,
    createEquipItemPacket,
    createMarketActionPacket,
    createModifySkillsPacket,
    createReorderBankItemPacket,
    createReorderInventoryItemPacket,
    createReorderSpellPacket,
    createRetosActionPacket,
    createSellItemPacket,
    createTrainerActionPacket,
    createCorreoActionPacket,
    createUseItemClickPacket,
    createUseItemUPacket,
    createWithdrawBankGoldPacket,
    type InventoryItem,
    type SpellEntry,
} from "../../../lib/aowProtocol";
import type { RuntimeTimingConfig } from "../../../lib/runtime-config";
import type { RefObject } from "../vanilla";
import type { Engine } from "../engine/Engine";

const MAX_BUFFERED_USE_ITEMS = 6;

type TargetingMode =
    | { type: "range" }
    | { type: "spell"; slot: number; manaRequired: number; name: string }
    | { type: "fishing"; name: string }
    | { type: "woodcutting"; name: string }
    | { type: "mining"; name: string }
    | { type: "smelting"; name: string }
    | { type: "blacksmith"; name: string };

type CombatCooldowns = {
    nextMeleeAt: number;
    nextRangeAt: number;
    nextSpellAt: number;
    nextSpellAfterMeleeAt: number;
    nextMeleeAfterSpellAt: number;
    nextUseItemAfterMeleeAt: number;
};

export type OutgoingRequestsOptions = {
    websocketRef: RefObject<WebSocket | null>;
    engineRef: RefObject<Engine | null>;
    playerHudRef: RefObject<{ inventory: InventoryItem[] } | null>;
    runtimeTimingRef: RefObject<RuntimeTimingConfig>;
    combatCooldownsRef: RefObject<CombatCooldowns>;
    nextUseItemAtRef: RefObject<number>;
    nextDropItemAtRef: RefObject<number>;
    nextEquipToggleAtRef: RefObject<number>;
    setTargetingMode: (mode: TargetingMode) => void;
    clearTargetingMode: () => void;
    getEquippedWeaponItem: () => InventoryItem | null;
    pushSystemMessage: (text: string, color?: string) => void;
    isFishingRodItem: (item: InventoryItem | null) => boolean;
    isWoodcuttingToolItem: (item: InventoryItem | null) => boolean;
    isMiningToolItem: (item: InventoryItem | null) => boolean;
    isSmeltingMineralItem: (item: InventoryItem | null) => boolean;
    reorderInventoryItems: (sourceSlot: number, targetSlot: number) => void;
    reorderSpells: (sourceSlot: number, targetSlot: number) => void;
    clearExpiredCombatCooldowns: () => void;
    recordResourceUseItem: (
        slot: number,
        item: InventoryItem | null,
        sentAt: number,
    ) => void;
    recordClientGameAction: (
        action: string,
        details?: Record<string, unknown>,
    ) => void;
};

function getSocket(
    websocketRef: RefObject<WebSocket | null>,
): WebSocket | null {
    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return null;
    }

    return socket;
}

function maybeSetGatheringTargetingMode(
    item: InventoryItem | null,
    options: Pick<
        OutgoingRequestsOptions,
        | "isFishingRodItem"
        | "isWoodcuttingToolItem"
        | "isMiningToolItem"
        | "isSmeltingMineralItem"
        | "setTargetingMode"
    >,
) {
    if (options.isFishingRodItem(item)) {
        options.setTargetingMode({
            type: "fishing",
            name: item?.name ?? "Caña de pescar",
        });
        return;
    }

    if (options.isWoodcuttingToolItem(item)) {
        options.setTargetingMode({
            type: "woodcutting",
            name: item?.name ?? "Hacha de leñador",
        });
        return;
    }

    if (options.isMiningToolItem(item)) {
        options.setTargetingMode({
            type: "mining",
            name: item?.name ?? "Piquete de minero",
        });
        return;
    }

    if (/martillo de herrero/i.test(item?.name ?? "")) {
        options.setTargetingMode({
            type: "blacksmith",
            name: item?.name ?? "Martillo de herrero",
        });
        return;
    }

    if (options.isSmeltingMineralItem(item)) {
        options.setTargetingMode({
            type: "smelting",
            name: item?.name ?? "Mineral",
        });
    }
}

export function createOutgoingRequests(options: OutgoingRequestsOptions) {
    const {
        websocketRef,
        engineRef,
        playerHudRef,
        runtimeTimingRef,
        combatCooldownsRef,
        nextUseItemAtRef,
        nextDropItemAtRef,
        nextEquipToggleAtRef,
        setTargetingMode,
        clearTargetingMode,
        getEquippedWeaponItem,
        pushSystemMessage,
        reorderInventoryItems,
        reorderSpells,
        clearExpiredCombatCooldowns,
        recordResourceUseItem,
        recordClientGameAction,
    } = options;

    let useItemClickQueue: number[] = [];
    let useItemUQueue: number[] = [];
    let useItemClickFlushTimer: number | null = null;
    let useItemUFlushTimer: number | null = null;

    const scheduleFlush = (
        setTimer: (id: number | null) => void,
        getTimer: () => number | null,
        flush: () => void,
        delayMs: number,
    ) => {
        const current = getTimer();
        if (current !== null) {
            window.clearTimeout(current);
        }

        setTimer(
            window.setTimeout(() => {
                setTimer(null);
                flush();
            }, Math.max(1, delayMs)),
        );
    };

    const clearUseItemQueues = () => {
        useItemClickQueue = [];
        useItemUQueue = [];
        nextUseItemAtRef.current = 0;

        if (useItemClickFlushTimer !== null) {
            window.clearTimeout(useItemClickFlushTimer);
            useItemClickFlushTimer = null;
        }

        if (useItemUFlushTimer !== null) {
            window.clearTimeout(useItemUFlushTimer);
            useItemUFlushTimer = null;
        }
    };

    const flushUseItemClickQueue = () => {
        if (useItemClickFlushTimer !== null) {
            window.clearTimeout(useItemClickFlushTimer);
            useItemClickFlushTimer = null;
        }

        if (useItemClickQueue.length === 0) {
            return;
        }

        const socket = getSocket(websocketRef);
        if (!socket) {
            return;
        }

        clearExpiredCombatCooldowns();
        const now = Date.now();
        const nextUseItemAfterMeleeAt =
            combatCooldownsRef.current.nextUseItemAfterMeleeAt;
        const nextAvailableAt = Math.max(
            nextUseItemAfterMeleeAt,
            nextUseItemAtRef.current,
        );

        if (now < nextAvailableAt) {
            scheduleFlush(
                (id) => (useItemClickFlushTimer = id),
                () => useItemClickFlushTimer,
                flushUseItemClickQueue,
                nextAvailableAt - now,
            );
            return;
        }

        const slot = useItemClickQueue.shift();
        if (typeof slot !== "number") {
            return;
        }

        const inventoryItem =
            playerHudRef.current?.inventory.find(
                (item) => item.slot === slot,
            ) ?? null;
        recordResourceUseItem(slot, inventoryItem, now);
        socket.send(createUseItemClickPacket(slot));
        recordClientGameAction("use_item_click", {
            slot,
            itemId: inventoryItem?.idItem ?? null,
            itemName: inventoryItem?.name ?? null,
        });
        nextUseItemAtRef.current =
            now + runtimeTimingRef.current.actionCooldowns.useItemMs;

        if (useItemClickQueue.length > 0) {
            useItemClickQueue = [];
        }
    };

    const flushUseItemUQueue = () => {
        if (useItemUFlushTimer !== null) {
            window.clearTimeout(useItemUFlushTimer);
            useItemUFlushTimer = null;
        }

        if (useItemUQueue.length === 0) {
            return;
        }

        const socket = getSocket(websocketRef);
        if (!socket) {
            return;
        }

        clearExpiredCombatCooldowns();
        const now = Date.now();
        const nextUseItemAfterMeleeAt =
            combatCooldownsRef.current.nextUseItemAfterMeleeAt;
        const nextAvailableAt = Math.max(
            nextUseItemAfterMeleeAt,
            nextUseItemAtRef.current,
        );

        if (now < nextAvailableAt) {
            scheduleFlush(
                (id) => (useItemUFlushTimer = id),
                () => useItemUFlushTimer,
                flushUseItemUQueue,
                nextAvailableAt - now,
            );
            return;
        }

        const slot = useItemUQueue.shift();
        if (typeof slot !== "number") {
            return;
        }

        const inventoryItem =
            playerHudRef.current?.inventory.find(
                (item) => item.slot === slot,
            ) ?? null;
        recordResourceUseItem(slot, inventoryItem, now);
        socket.send(createUseItemUPacket(slot));
        recordClientGameAction("use_item_u", {
            slot,
            itemId: inventoryItem?.idItem ?? null,
            itemName: inventoryItem?.name ?? null,
        });
        nextUseItemAtRef.current =
            now + runtimeTimingRef.current.actionCooldowns.useItemMs;

        if (useItemUQueue.length > 0) {
            useItemUQueue = [];
        }
    };

    const queueUseItem = (queue: "click" | "u", slot: number) => {
        clearExpiredCombatCooldowns();

        const targetQueue = queue === "click" ? useItemClickQueue : useItemUQueue;
        if (targetQueue.length >= MAX_BUFFERED_USE_ITEMS) {
            return;
        }

        const inventoryItem =
            playerHudRef.current?.inventory.find(
                (item) => item.slot === slot,
            ) ?? null;

        maybeSetGatheringTargetingMode(inventoryItem, options);

        if (queue === "click") {
            useItemClickQueue.push(slot);
            flushUseItemClickQueue();
        } else {
            useItemUQueue.push(slot);
            flushUseItemUQueue();
        }
    };

    return {
        clearUseItemQueues,
        destroy: clearUseItemQueues,

        equip(slot: number) {
            const now = Date.now();
            if (now < nextEquipToggleAtRef.current) {
                return;
            }

            const socket = getSocket(websocketRef);
            if (!socket) {
                return;
            }

            socket.send(createEquipItemPacket(slot));
            recordClientGameAction("equip_item", { slot });
            nextEquipToggleAtRef.current =
                now + runtimeTimingRef.current.actionCooldowns.equipToggleMs;
        },

        useItemClick(slot: number) {
            queueUseItem("click", slot);
        },

        modifySkills(skillId: number) {
            const socket = getSocket(websocketRef);
            if (!socket) {
                return;
            }

            socket.send(createModifySkillsPacket(skillId));
            recordClientGameAction("modify_skills", { skillId });
        },

        useItemU(slot: number) {
            queueUseItem("u", slot);
        },

        rangeAttack() {
            const weapon = getEquippedWeaponItem();
            const objectsDB = engineRef.current?.objectsDB;

            if (!weapon || !objectsDB?.[weapon.idItem.toString()]?.proyectil) {
                pushSystemMessage(
                    "Debes tener un arco equipado para disparar.",
                    "#fca5a5",
                );
                clearTargetingMode();
                return;
            }

            setTargetingMode({ type: "range" });
        },

        castSpell(spell: SpellEntry) {
            const hud = playerHudRef.current as { mana?: number } | null;
            if (
                typeof hud?.mana === "number" &&
                hud.mana < spell.manaRequired
            ) {
                pushSystemMessage(
                    "No tienes mana suficiente para lanzar ese hechizo.",
                    "#fca5a5",
                );
                return;
            }

            setTargetingMode({
                type: "spell",
                slot: spell.slot,
                manaRequired: spell.manaRequired,
                name: spell.name,
            });
            pushSystemMessage(
                `${spell.name} listo. Haz click sobre el objetivo (Escape para cancelar).`,
            );
        },

        drop(slot: number, amount: number) {
            const now = Date.now();
            if (now < nextDropItemAtRef.current) {
                return;
            }

            const socket = getSocket(websocketRef);
            if (!socket) {
                return;
            }

            socket.send(createDropItemPacket(slot, amount));
            recordClientGameAction("drop_item", { slot, amount });
            nextDropItemAtRef.current =
                now + runtimeTimingRef.current.actionCooldowns.dropItemMs;
        },

        buy(slot: number, amount: number) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createBuyItemPacket(slot, amount));
            recordClientGameAction("buy_item", { slot, amount });
        },

        sell(slot: number, amount: number) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createSellItemPacket(slot, amount));
            recordClientGameAction("sell_item", { slot, amount });
        },

        changeBankTab(tab: "character" | "account" | "clan") {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createChangeBankTabPacket(tab));
            recordClientGameAction("change_bank_tab", { tab });
        },

        depositBankGold(amount: number) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createDepositBankGoldPacket(amount));
            recordClientGameAction("deposit_bank_gold", { amount });
        },

        withdrawBankGold(amount: number) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createWithdrawBankGoldPacket(amount));
            recordClientGameAction("withdraw_bank_gold", { amount });
        },

        closeTrade() {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createCloseTradePacket());
            recordClientGameAction("close_trade");
        },

        marketAction(
            action: "refresh" | "create" | "buy" | "cancel" | "claim",
            payload?: Record<string, unknown>,
        ) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createMarketActionPacket(action, payload ?? {}));
            recordClientGameAction("market_action", { action });
        },

        retosAction(
            action: "refresh" | "create" | "join" | "cancel",
            payload?: Record<string, unknown>,
        ) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createRetosActionPacket(action, payload ?? {}));
            recordClientGameAction("retos_action", { action });
        },

        trainerAction(
            action: "list" | "invoke",
            payload?: Record<string, unknown>,
        ) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createTrainerActionPacket(action, payload ?? {}));
            recordClientGameAction("trainer_action", { action });
        },

        correoAction(
            action: "list" | "send" | "delete",
            payload?: Record<string, unknown>,
        ) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createCorreoActionPacket(action, payload ?? {}));
            recordClientGameAction("correo_action", { action });
        },

        craft(
            profession: "carpentry" | "blacksmith" | "tailoring",
            itemId: number,
            amount: number,
        ) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createCraftItemPacket(profession, itemId, amount));
            recordClientGameAction("craft_item", {
                profession,
                itemId,
                amount,
            });
        },

        reorderInventory(sourceSlot: number, targetSlot: number) {
            reorderInventoryItems(sourceSlot, targetSlot);

            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(
                createReorderInventoryItemPacket(sourceSlot, targetSlot),
            );
            recordClientGameAction("reorder_inventory", {
                sourceSlot,
                targetSlot,
            });
        },

        reorderSpell(sourceSlot: number, targetSlot: number) {
            reorderSpells(sourceSlot, targetSlot);

            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createReorderSpellPacket(sourceSlot, targetSlot));
            recordClientGameAction("reorder_spell", {
                sourceSlot,
                targetSlot,
            });
        },

        reorderBank(sourceSlot: number, targetSlot: number) {
            const socket = getSocket(websocketRef);
            if (!socket) return;
            socket.send(createReorderBankItemPacket(sourceSlot, targetSlot));
            recordClientGameAction("reorder_bank", {
                sourceSlot,
                targetSlot,
            });
        },
    };
}
