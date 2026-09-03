// Entry point used by the play view: builds the connection config and
// starts a GameClient (the vanilla port of the MapRenderer React tree).
import {
    GameClient,
    type LoadingStage,
} from "../components/game/core/gameClient";
import type {
    BailOffer,
    CraftingState,
    MarketState,
    PlayerHudState,
    RetosState,
    SpellEntry,
    TradeState,
    TrainerState,
    CorreoState,
} from "../lib/aowProtocol";
import type { GraphicData } from "../types/game";

export type StartGameOptions = {
    container: HTMLDivElement;
    wsUrl: string;
    ticket: string;
    mapNumber: number;
    onLoading: (stage: LoadingStage, progress: number, detail: string) => void;
    onLoadingDone: () => void;
    onError: (message: string) => void;
    onHud: (hud: PlayerHudState | null) => void;
    onChat: (text: string, color?: string) => void;
    onPing: (ms: number | null) => void;
    onFps: (fps: number | null) => void;
    onDisconnect: (reason?: string) => void;
    onTradeState?: (state: TradeState | null) => void;
    onMarketState?: (state: MarketState | null) => void;
    onRetosState?: (state: RetosState | null) => void;
    onBailState?: (state: BailOffer | null) => void;
    onCraftingState?: (state: CraftingState | null) => void;
    onTrainerState?: (state: TrainerState | null) => void;
    onCorreoState?: (state: CorreoState | null) => void;
    onCorreoPicOn?: () => void;
    onNotice?: (notice: { text: string; durationMs: number }) => void;
    debug?: boolean;
};

export type GameHandle = {
    sendChat: (message: string) => boolean;
    setMasterVolume: (volume: number) => void;
    castSpell: (spell: SpellEntry) => void;
    assignAttributePoint: (attrId: number) => void;
    useItem: (slot: number) => void;
    equipItem: (slot: number) => void;
    dropItem: (slot: number, amount: number) => void;
    buyItem: (slot: number, amount: number) => void;
    sellItem: (slot: number, amount: number) => void;
    closeTrade: () => void;
    changeBankTab: (tab: "character" | "account" | "clan") => void;
    depositBankGold: (amount: number) => void;
    withdrawBankGold: (amount: number) => void;
    reorderBankItem: (sourceSlot: number, targetSlot: number) => void;
    marketAction: (
        action: "refresh" | "create" | "buy" | "cancel" | "claim",
        payload?: Record<string, unknown>,
    ) => void;
    retosAction: (
        action: "refresh" | "create" | "join" | "cancel",
        payload?: Record<string, unknown>,
    ) => void;
    craftItem: (
        profession: "carpentry" | "blacksmith" | "tailoring",
        itemId: number,
        amount: number,
    ) => void;
    trainerAction: (
        action: "list" | "invoke",
        payload?: Record<string, unknown>,
    ) => void;
    correoAction: (
        action: "list" | "send" | "delete",
        payload?: Record<string, unknown>,
    ) => void;
    resolveIconGraphic: (grhIndex: number) => GraphicData | null;
    destroy: () => void;
};

let sessionCounter = 0;

export function startGame(options: StartGameOptions): GameHandle {
    sessionCounter += 1;

    const client = new GameClient({
        container: options.container,
        connection: {
            wsUrl: options.wsUrl,
            ticket: options.ticket,
            typeGame: 1,
            idChar: 0,
            sessionKey: `${Date.now()}-${sessionCounter}`,
        },
        mapNumber: options.mapNumber,
        debug: options.debug,
        callbacks: {
            onLoading: options.onLoading,
            onLoadingDone: options.onLoadingDone,
            onError: options.onError,
            onHud: options.onHud,
            onChat: options.onChat,
            onPing: options.onPing,
            onFps: options.onFps,
            onDisconnect: options.onDisconnect,
            onTradeState: options.onTradeState,
            onMarketState: options.onMarketState,
            onRetosState: options.onRetosState,
            onBailState: options.onBailState,
            onCraftingState: options.onCraftingState,
            onTrainerState: options.onTrainerState,
            onCorreoState: options.onCorreoState,
            onCorreoPicOn: options.onCorreoPicOn,
            onNotice: options.onNotice,
        },
    });

    client.start();

    return {
        sendChat: (message) => client.sendChat(message),
        setMasterVolume: (volume) => client.setMasterVolume(volume),
        castSpell: (spell) => client.castSpell(spell),
        assignAttributePoint: (attrId) => client.assignAttributePoint(attrId),
        useItem: (slot) => client.useInventoryItem(slot),
        equipItem: (slot) => client.equipInventoryItem(slot),
        dropItem: (slot, amount) => client.dropInventoryItem(slot, amount),
        buyItem: (slot, amount) => client.buyTradeItem(slot, amount),
        sellItem: (slot, amount) => client.sellTradeItem(slot, amount),
        closeTrade: () => client.closeTradeWindow(),
        changeBankTab: (tab) => client.changeBankTab(tab),
        depositBankGold: (amount) => client.depositBankGold(amount),
        withdrawBankGold: (amount) => client.withdrawBankGold(amount),
        reorderBankItem: (sourceSlot, targetSlot) =>
            client.reorderBankItem(sourceSlot, targetSlot),
        marketAction: (action, payload) => client.marketAction(action, payload),
        retosAction: (action, payload) => client.retosAction(action, payload),
        craftItem: (profession, itemId, amount) =>
            client.craftItem(profession, itemId, amount),
        trainerAction: (action, payload) =>
            client.trainerAction(action, payload),
        correoAction: (action, payload) =>
            client.correoAction(action, payload),
        resolveIconGraphic: (grhIndex) => client.resolveIconGraphic(grhIndex),
        destroy: () => client.destroy(),
    };
}
