// Vanilla orchestrator — port of frontend/components/game/core/MapRendererCore.tsx
// React refs become plain {current} objects, useState values become fields,
// useEffects become explicit wiring in start()/destroy().
import type { Text } from "pixi.js";
import {
    createDialogPacket,
    type BailOffer,
    type CharacterSnapshot,
    type ClanHudMember,
    type CraftingState,
    type MarketState,
    type PartyHudMember,
    type PlayerHudState,
    type RetosState,
    type SpellEntry,
    type TradeState,
    type TrainerState,
} from "../../../lib/aowProtocol";
import {
    VIEWPORT_PIXEL_HEIGHT,
    VIEWPORT_PIXEL_WIDTH,
} from "../../../lib/viewport";
import { DEFAULT_HOTKEY_SETTINGS } from "../../../lib/hotkeys";
import {
    DEFAULT_RUNTIME_TIMING,
    type RuntimeTimingConfig,
} from "../../../lib/runtime-config";
import { GameSoundManager } from "../../../lib/sound";
import {
    setTextIfChanged,
    setVisibilityIfChanged,
} from "../rendering/textStyles";
import {
    destroyDisplayObjectSafely,
    unregisterContainerCullEntries,
} from "../rendering/pixiUtils";
import { Engine } from "../engine/Engine";
import {
    destroySharedTextureCaches,
    type SharedTextureCaches,
} from "../rendering/textureCaches";
import { createOutgoingRequests } from "../session/outgoingRequests";
import { resolveIconGraphic } from "../../../lib/inventoryIcons";
import type { GraphicData } from "../../../types/game";
import {
    startGameSession,
    type GameConnectionConfig,
} from "../session/gameSession";
import { handleIncomingGamePacket } from "../session/handleIncomingGamePacket";
import { bootstrapRenderer } from "./rendererBootstrap";
import { useAssetPipeline } from "./assetPipeline";
import {
    useMovementSync,
    type LocalPendingMove,
} from "./movementSync";
import {
    useCombatController,
    type TargetingMode,
} from "./combatController";
import { attachKeyboardGameplay } from "./keyboardGameplay";
import { createNpcAdminTools } from "./npcAdminTools";
import { useHudStateController } from "./hudStateController";
import { useSceneController } from "./sceneController";
import { useRemoteEntityController } from "./remoteEntityController";
import { createEntityOverlays } from "../rendering/entityOverlays";
import {
    collectSpellGraphicIds,
    resolveNakedBodyIdFromHeadId,
} from "../assets/scenePreload";
import {
    getKeyboardKeyCandidatesFromCode,
    normalizeKeyboardEventKey,
    useClientInputDiagnostics,
} from "../diagnostics/clientInputDiagnostics";
import {
    CLAN_SEGURO_TEXT_OFFSET_Y,
    DEBUG_COMBAT_TEXT_OFFSET_Y,
    DEFAULT_ENTITY_FX_DURATION_MS,
    ENTITY_FX_ALPHA,
    FPS_TEXT_OFFSET_X,
    FPS_TEXT_OFFSET_Y,
    MIN_STEP_SOUND_INTERVAL_MS,
    PERSISTENT_ENTITY_FX_IDS,
    PING_TEXT_OFFSET_Y,
    PROJECTILE_BASE_ANGLE_RADIANS,
    PROJECTILE_MAX_DURATION_MS,
    PROJECTILE_MIN_DURATION_MS,
    PROJECTILE_PIXELS_PER_MS,
    SEGURO_TEXT_OFFSET_Y,
    canUseEngineContainer,
    createCastBar,
    createDebugPositionLabel,
    createDialogBubble,
    createFloatingCombatText,
    formatCharacterAnimationDebugLabel,
    getDialogMessageDuration,
    getGraphicImagePaths,
    isCharacterInmovilizado,
    isCharacterParalizado,
    isCombatDialogMessage,
    resolveEntitySoundPosition,
    resolveStepSoundId,
    shouldHideRemoteCharacterBody,
    type ActiveCastBar,
    type ActiveDialogMessage,
    type PendingTileState,
    type PerformanceSample,
    type ResourceChangeSample,
    type ResourceKind,
    type ResourceReactionSample,
} from "./rendererShared";

export type LoadingStage =
    | "Preparando cliente"
    | "Cargando escena inicial"
    | "Cargando personaje"
    | "Cargando hechizos"
    | "Renderizando mundo"
    | "Precargando alrededores";

export type RendererStatus = {
    connected: boolean;
    connecting: boolean;
    worldName?: string;
    error?: string;
    consoleLine?: string;
};

export type ConsoleMessage = {
    text: string;
    color?: string;
    source: "console" | "dialog" | "system";
    speakerType?: "npc" | "user";
    channel?: string;
    senderName?: string;
};

export type GameClientCallbacks = {
    onLoading: (stage: LoadingStage, progress: number, detail: string) => void;
    onLoadingDone: () => void;
    onError: (message: string) => void;
    onHud: (hud: PlayerHudState | null) => void;
    onChat: (text: string, color?: string) => void;
    onPing: (ms: number | null) => void;
    onFps: (fps: number | null) => void;
    onDisconnect: (reason?: string) => void;
    onNotImplemented?: (feature: string) => void;
    onTradeState?: (state: TradeState | null) => void;
    onMarketState?: (state: MarketState | null) => void;
    onRetosState?: (state: RetosState | null) => void;
    onBailState?: (state: BailOffer | null) => void;
    onCraftingState?: (state: CraftingState | null) => void;
    onTrainerState?: (state: TrainerState | null) => void;
    onNotice?: (notice: { text: string; durationMs: number }) => void;
};

export type GameClientOptions = {
    container: HTMLDivElement;
    connection: GameConnectionConfig;
    mapNumber: number;
    callbacks: GameClientCallbacks;
    debug?: boolean;
};

export class GameClient {
    private container: HTMLDivElement;
    private canvasHost: HTMLDivElement;
    private connection: GameConnectionConfig;
    private mapNumber: number;
    private callbacks: GameClientCallbacks;
    private debug: boolean;

    private destroyed = false;
    private disposeBootstrap: (() => void) | null = null;
    private disposeSession: (() => void) | null = null;
    private disposeKeyboard: (() => void) | null = null;

    // ------- state (was useState) -------
    private isSceneReady = false;
    private isLoading = false;
    private isDebugMode = false;
    private clientReadySessionKey: string | null = null;
    private hasCompletedInitialLoad = false;
    private error: string | null = null;

    // ------- refs (was useRef) -------
    private engineRef = { current: null as Engine | null };
    private outgoingRequestsRef = {
        current: null as ReturnType<typeof createOutgoingRequests> | null,
    };
    private websocketRef = { current: null as WebSocket | null };
    private canvasRef: { current: HTMLDivElement | null };
    private rendererRootRef: { current: HTMLDivElement | null };
    private pingIntervalRef = { current: null as number | null };
    private pendingPingRef = {
        current: null as { token: number; sentAt: number } | null,
    };
    private recentPingSamplesRef = { current: [] as number[] };
    private nextPingTokenRef = { current: 1 };
    private pingTextRef = { current: null as Text | null };
    private pingDisplayTextRef = { current: "Ping: -- ms" };
    private seguroTextRef = { current: null as Text | null };
    private clanSeguroTextRef = { current: null as Text | null };
    private debugCombatTextRef = { current: null as Text | null };
    private debugCombatOverlayTextRef = { current: "" };
    private fpsDisplayTextRef = { current: "FPS: 0" };
    private pendingChatMessageRef = { current: null as string | null };
    private lastSentChatTokenRef = { current: null as number | null };
    private pendingUserSnapshotRef = {
        current: null as CharacterSnapshot | null,
    };
    private lastServerConfirmedSelfPositionRef = {
        current: null as { map: number; x: number; y: number } | null,
    };
    private pendingRemoteSnapshotsRef = {
        current: new Map<number, CharacterSnapshot>(),
    };
    private tthoneyCleanupTimeoutsRef = { current: new Map<number, number>() };
    private pendingTileStatesRef = {
        current: new Map<string, PendingTileState>(),
    };
    private incomingPacketQueueRef = {
        current: [] as Array<Blob | ArrayBuffer | ArrayBufferView>,
    };
    private isProcessingIncomingPacketsRef = { current: false };
    private activeSessionKeyRef = { current: null as string | null };
    private currentMapRef: { current: number };
    private sharedTextureCachesRef: { current: SharedTextureCaches } = {
        current: {
            baseTextureCache: new Map(),
            pendingAssetLoads: new Map(),
            textureCache: new Map(),
            animatedTextureCache: new Map(),
        },
    };
    private localPendingMovesRef = { current: [] as LocalPendingMove[] };
    private nextMoveIdRef = { current: 1 };
    private latestServerStateVersionRef = { current: 0 };
    private movementInputLockedUntilRef = { current: 0 };
    private movementInputResumeTimeoutRef = {
        current: null as number | null,
    };
    private isMapChangeTransitionRef = { current: false };
    private hotkeySettingsRef = { current: DEFAULT_HOTKEY_SETTINGS };
    private macroKeyCodesRef = { current: new Set<string>() };
    private blockedKeyboardCodesRef = { current: new Map<string, number>() };
    private blockedKeyboardKeysRef = { current: new Map<string, number>() };
    private movementKeyMapRef = { current: new Map<string, number>() };
    private movementPressCountsRef = { current: new Map<number, number>() };
    private movementKeyPriorityRef = { current: [] as number[] };
    private soundManagerRef = { current: null as GameSoundManager | null };
    private stepVariantRef = { current: new Map<number, 0 | 1>() };
    private lastStepSoundAtRef = { current: new Map<number, number>() };
    private runtimeTimingRef: { current: RuntimeTimingConfig } = {
        current: DEFAULT_RUNTIME_TIMING,
    };
    private panelSnapshotChunkBufferRef = { current: "" };
    private panelSnapshotChunkExpectedIndexRef = { current: 0 };
    private panelSnapshotChunkTotalRef = { current: 0 };
    private characterStatsChunkBufferRef = { current: "" };
    private characterStatsChunkExpectedIndexRef = { current: 0 };
    private characterStatsChunkTotalRef = { current: 0 };
    private activeSocketInstanceRef = { current: 0 };
    private npcContextMenuOpenedAtRef = { current: 0 };
    private performanceSampleRef: { current: PerformanceSample } = {
        current: { fps: null, pingMs: null },
    };
    private partyMemberIdsRef = { current: new Set<string>() };
    private pendingPartyMembersRef = { current: [] as PartyHudMember[] };
    private pendingClanMembersRef = { current: [] as ClanHudMember[] };
    private targetingModeRef = { current: null as TargetingMode | null };
    private nextMapClickAtRef = { current: 0 };
    private nextUseItemAtRef = { current: 0 };
    private nextDropItemAtRef = { current: 0 };
    private nextEquipToggleAtRef = { current: 0 };
    private combatCooldownsRef = {
        current: {
            nextMeleeAt: 0,
            nextRangeAt: 0,
            nextSpellAt: 0,
            nextSpellAfterMeleeAt: 0,
            nextMeleeAfterSpellAt: 0,
            nextUseItemAfterMeleeAt: 0,
        },
    };
    private lastResourceDropRef = {
        current: { hp: null, mana: null } as Record<
            ResourceKind,
            ResourceChangeSample | null
        >,
    };
    private resourceReactionSamplesRef = {
        current: { hp: [], mana: [] } as Record<
            ResourceKind,
            ResourceReactionSample[]
        >,
    };
    private lastWorldPointerTileRef = {
        current: null as {
            at: number;
            x: number;
            y: number;
            button: number;
            trusted: boolean;
        } | null,
    };
    private lastSpellAttemptAtRef = { current: null as number | null };
    private lastSpellAttemptIntervalMsRef = {
        current: null as number | null,
    };
    private activeDialogMessagesRef = {
        current: new Map<number, ActiveDialogMessage>(),
    };
    private activeCastBarsRef = {
        current: new Map<number, ActiveCastBar>(),
    };
    private hasAnnouncedConnectionRef = { current: false };
    private latestStatusRef: { current: RendererStatus } = {
        current: { connected: false, connecting: false },
    };
    private playerHudRef = { current: null as PlayerHudState | null };
    private screenSize = {
        width: VIEWPORT_PIXEL_WIDTH,
        height: VIEWPORT_PIXEL_HEIGHT,
    };

    constructor(options: GameClientOptions) {
        this.container = options.container;
        this.connection = options.connection;
        this.mapNumber = options.mapNumber;
        this.callbacks = options.callbacks;
        this.debug = options.debug ?? false;
        this.currentMapRef = { current: options.mapNumber };

        this.canvasHost = document.createElement("div");
        this.canvasHost.style.width = "100%";
        this.canvasHost.style.height = "100%";
        this.container.append(this.canvasHost);
        this.canvasRef = { current: this.canvasHost };
        this.rendererRootRef = { current: this.container };

        this.container.addEventListener("contextmenu", (event) => {
            event.preventDefault();
        });

        this.soundManagerRef.current = new GameSoundManager();
    }

    // ---------------------------------------------------------------

    private emitPerformanceSample(patch: Partial<PerformanceSample>) {
        const nextSample: PerformanceSample = {
            fps:
                "fps" in patch
                    ? (patch.fps ?? null)
                    : this.performanceSampleRef.current.fps,
            pingMs:
                "pingMs" in patch
                    ? (patch.pingMs ?? null)
                    : this.performanceSampleRef.current.pingMs,
        };

        this.performanceSampleRef.current = nextSample;
        if ("fps" in patch) {
            this.callbacks.onFps(nextSample.fps);
        }
        if ("pingMs" in patch) {
            this.callbacks.onPing(nextSample.pingMs);
        }
    }

    private emitStatus = (status: RendererStatus) => {
        this.latestStatusRef.current = status;
        if (status.error && !status.connected && !status.connecting) {
            this.callbacks.onDisconnect(status.error);
        }
    };

    private setIsSceneReady = (value: boolean) => {
        this.isSceneReady = value;
    };

    private setIsLoading = (value: boolean) => {
        const wasLoading = this.isLoading;
        this.isLoading = value;
        if (wasLoading && !value) {
            this.callbacks.onLoadingDone();
        }
    };

    private setError = (value: string | null) => {
        this.error = value;
        if (value) {
            this.callbacks.onError(value);
        }
    };

    private setHasCompletedInitialLoad = (value: boolean) => {
        this.hasCompletedInitialLoad = value;
    };

    private setClientReadySessionKey = (value: string | null) => {
        this.clientReadySessionKey = value;
        if (
            value &&
            value === this.connection.sessionKey &&
            !this.disposeSession
        ) {
            this.startSession();
        }
    };

    private setIsDebugMode = (updater: (previous: boolean) => boolean) => {
        this.isDebugMode = updater(this.isDebugMode);
        if (this.engineRef.current) {
            this.engineRef.current.isDebugMode = this.isDebugMode;
        }
    };

    private setIsDeadWorldActive = (
        action: boolean | ((previous: boolean) => boolean),
    ) => {
        const active =
            typeof action === "function"
                ? action(this.canvasHost.style.filter === "grayscale(1)")
                : action;
        this.canvasHost.style.filter = active ? "grayscale(1)" : "";
    };

    private setDebugCombatOverlayText = (_text: string) => undefined;

    private updateLoadingProgress = (
        stage: LoadingStage,
        progress: number,
        detail: string,
    ) => {
        this.callbacks.onLoading(
            stage,
            Math.max(0, Math.min(100, Math.round(progress))),
            detail,
        );
    };

    private clearLoadingProgress = () => undefined;

    private onConsoleMessage = (message: ConsoleMessage) => {
        this.callbacks.onChat(message.text, message.color);
    };

    private onGlobalNotice = (notice: { text: string; durationMs: number }) => {
        if (this.callbacks.onNotice) {
            this.callbacks.onNotice(notice);
        } else {
            this.callbacks.onChat(notice.text, "#fcd34d");
        }
    };

    private recordSpellTargetSnap = (_sample: unknown) => undefined;

    private flushPendingChatRequest = () => {
        const message = this.pendingChatMessageRef.current;
        if (!message) {
            return;
        }

        const socket = this.websocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        socket.send(createDialogPacket(message));
        this.pendingChatMessageRef.current = null;
    };

    private playStepSound = (engine: Engine, entityId: number) => {
        const character = engine.personajes[entityId];

        if (!character || character.dead || character.invisibleAdmin) {
            return;
        }

        const now = performance.now();
        const lastStepSoundAt =
            this.lastStepSoundAtRef.current.get(entityId) ?? -Infinity;

        if (now - lastStepSoundAt < MIN_STEP_SOUND_INTERVAL_MS) {
            return;
        }

        this.lastStepSoundAtRef.current.set(entityId, now);

        const currentVariant = this.stepVariantRef.current.get(entityId) ?? 1;
        const nextVariant = (currentVariant === 0 ? 1 : 0) as 0 | 1;
        this.stepVariantRef.current.set(entityId, nextVariant);

        this.soundManagerRef.current?.play({
            soundId: resolveStepSoundId(engine, character, nextVariant),
            listener: resolveEntitySoundPosition(engine, engine.user?.id),
            source: resolveEntitySoundPosition(engine, entityId),
            fadeInMs: 8,
            fadeOutMs: 10,
        });
    };

    private resolveBlockedGameplayKeyboardReason = (
        event: KeyboardEvent,
    ): "document_not_focused" | "untrusted_event" | null => {
        const settings = this.hotkeySettingsRef.current;
        const normalizedEventKey = normalizeKeyboardEventKey(event.key);
        const matchesHotkey = Object.values(settings).some((codes) =>
            codes.some(
                (code) =>
                    code === event.code ||
                    getKeyboardKeyCandidatesFromCode(code).includes(
                        normalizedEventKey,
                    ),
            ),
        );
        const matchesMacro = Array.from(this.macroKeyCodesRef.current).some(
            (code) =>
                code === event.code ||
                getKeyboardKeyCandidatesFromCode(code).includes(
                    normalizedEventKey,
                ),
        );
        const matchesInternalHotkey =
            event.code === "KeyL" || normalizedEventKey === "l";

        if (!matchesHotkey && !matchesMacro && !matchesInternalHotkey) {
            return null;
        }

        if (!document.hasFocus()) {
            return "document_not_focused";
        }

        if (!event.isTrusted) {
            return "untrusted_event";
        }

        return null;
    };

    private getBlockedKeyboardSequenceUntil = (event: KeyboardEvent): number => {
        const codeBlockedUntil = event.code
            ? (this.blockedKeyboardCodesRef.current.get(event.code) ?? 0)
            : 0;
        const normalizedKey = normalizeKeyboardEventKey(event.key);
        const keyBlockedUntil = normalizedKey
            ? (this.blockedKeyboardKeysRef.current.get(normalizedKey) ?? 0)
            : 0;
        return Math.max(codeBlockedUntil, keyBlockedUntil);
    };

    private getEntityContainer = (engine: Engine, entityId: number): any => {
        if (engine.user?.id === entityId) {
            return engine.playerContainer;
        }

        return engine.remoteEntities.get(entityId) ?? null;
    };

    // ---------------------------------------------------------------

    start(): void {
        if (this.destroyed) {
            return;
        }

        const {
            setDeadCharacterContextMenu,
            setInspectedNpc,
            setNpcContextMenu,
        } = createNpcAdminTools({
            websocketRef: this.websocketRef,
            engineRef: this.engineRef,
            playerHudRef: this.playerHudRef,
            npcContextMenuOpenedAtRef: this.npcContextMenuOpenedAtRef,
        });

        const {
            lastTrustedInputAtRef,
            lastUntrustedInputAtRef,
            recordClientGameAction,
        } = useClientInputDiagnostics({
            connectionSessionKey: this.connection.sessionKey,
            getBlockedKeyboardSequenceUntil:
                this.getBlockedKeyboardSequenceUntil,
            resolveBlockedGameplayKeyboardReason:
                this.resolveBlockedGameplayKeyboardReason,
            macroKeyCodesRef: this.macroKeyCodesRef,
            blockedKeyboardCodesRef: this.blockedKeyboardCodesRef,
            blockedKeyboardKeysRef: this.blockedKeyboardKeysRef,
        });

        const {
            loadTextures,
            loadCharacterTextures,
            loadSingleTexture,
            preloadGraphicIds,
            preloadCurrentSceneAssets,
            preloadInitialVisibleMapAssets,
            prefetchNearbyMaps,
            warmCommonCharacterAssets,
        } = useAssetPipeline({
            getGraphicImagePaths,
            updateLoadingProgress: this.updateLoadingProgress,
        });

        const {
            applyPendingTileStates,
            ensureMapTile,
            queueTileObjectVisualSync,
            removeObjectSprite,
            renderMap,
            setWorldVisibility,
            startMapChangeTransition,
            updatePendingTileState,
        } = useSceneController({
            pendingTileStatesRef: this.pendingTileStatesRef,
            isMapChangeTransitionRef: this.isMapChangeTransitionRef,
            setIsSceneReady: this.setIsSceneReady,
            setIsLoading: this.setIsLoading,
            updateLoadingProgress: this.updateLoadingProgress,
            onMapChange: (targetMap: number) => this.rebootstrap(targetMap),
            canUseEngineContainer,
            preloadGraphicIds,
            loadTextures,
        });

        const {
            clearEquippedInventory,
            emitHud,
            mergeHud,
            removeInventoryItem,
            reorderInventoryItems,
            reorderSpells,
            updateEquippedInventoryByType,
            updateSeguroIndicators,
            upsertInventoryItem,
            upsertSpell,
        } = useHudStateController({
            playerHudRef: this.playerHudRef,
            partyMemberIdsRef: this.partyMemberIdsRef,
            engineRef: this.engineRef,
            seguroTextRef: this.seguroTextRef,
            clanSeguroTextRef: this.clanSeguroTextRef,
            setIsDeadWorldActive: this.setIsDeadWorldActive,
            onHudChange: (hud) => this.callbacks.onHud(hud),
            onTradeStateChange: (state) =>
                this.callbacks.onTradeState?.(state),
            onMarketStateChange: (state) =>
                this.callbacks.onMarketState?.(state),
            onRetosStateChange: (state) =>
                this.callbacks.onRetosState?.(state),
            onBailStateChange: (state) => this.callbacks.onBailState?.(state),
            onCraftingStateChange: (state) =>
                this.callbacks.onCraftingState?.(state),
            preloadGraphicIds,
            collectSpellGraphicIds,
        });

        const {
            canStartLocalCombatAction,
            clearExpiredCombatCooldowns,
            clearTargetingMode,
            getEquippedWeaponItem,
            hasEquippedMeleeWeapon,
            hasEquippedRangedWeapon,
            isFishingRodItem,
            isMiningToolItem,
            isSmeltingMineralItem,
            isWoodcuttingToolItem,
            pushSystemMessage,
            recordResourceUseItem,
            recordResourceValue,
            registerDebugSpellAttempt,
            registerLocalCombatAction,
            resolveCombatReleaseTarget,
            resolveSpellReleaseTarget,
            setTargetingMode,
            updateCanvasCursor,
            updateDebugCombatText,
        } = useCombatController({
            engineRef: this.engineRef,
            websocketRef: this.websocketRef,
            connectionSessionKey: this.connection.sessionKey,
            playerHudRef: this.playerHudRef,
            runtimeTimingRef: this.runtimeTimingRef,
            targetingModeRef: this.targetingModeRef,
            lastServerConfirmedSelfPositionRef:
                this.lastServerConfirmedSelfPositionRef,
            lastWorldPointerTileRef: this.lastWorldPointerTileRef,
            lastTrustedInputAtRef,
            lastUntrustedInputAtRef,
            nextMapClickAtRef: this.nextMapClickAtRef,
            nextUseItemAtRef: this.nextUseItemAtRef,
            combatCooldownsRef: this.combatCooldownsRef,
            lastResourceDropRef: this.lastResourceDropRef,
            resourceReactionSamplesRef: this.resourceReactionSamplesRef,
            lastSpellAttemptAtRef: this.lastSpellAttemptAtRef,
            lastSpellAttemptIntervalMsRef: this.lastSpellAttemptIntervalMsRef,
            debugCombatTextRef: this.debugCombatTextRef,
            debugCombatOverlayTextRef: this.debugCombatOverlayTextRef,
            getEntityContainer: this.getEntityContainer,
            setDebugCombatOverlayText: this.setDebugCombatOverlayText,
            isDebugMode: this.isDebugMode,
            onConsoleMessage: this.onConsoleMessage,
            recordClientGameAction,
            setTextIfChanged,
            setVisibilityIfChanged,
            recordSpellTargetSnap: this.recordSpellTargetSnap,
        });

        const {
            canProcessMovementInput,
            clearMovementInputState,
            clearPendingLocalMoves,
            consumeAcknowledgedLocalMoves,
            lockMovementInput,
            reconcileOwnPositionWithServer,
            resetMovementSyncState,
            retainPendingRemoteSnapshotsForMap,
            syncMovementState,
        } = useMovementSync({
            engineRef: this.engineRef,
            localPendingMovesRef: this.localPendingMovesRef,
            nextMoveIdRef: this.nextMoveIdRef,
            latestServerStateVersionRef: this.latestServerStateVersionRef,
            movementInputLockedUntilRef: this.movementInputLockedUntilRef,
            movementInputResumeTimeoutRef: this.movementInputResumeTimeoutRef,
            isMapChangeTransitionRef: this.isMapChangeTransitionRef,
            movementKeyMapRef: this.movementKeyMapRef,
            movementPressCountsRef: this.movementPressCountsRef,
            movementKeyPriorityRef: this.movementKeyPriorityRef,
            pendingRemoteSnapshotsRef: this.pendingRemoteSnapshotsRef,
            pendingUserSnapshotRef: this.pendingUserSnapshotRef,
            lastServerConfirmedSelfPositionRef:
                this.lastServerConfirmedSelfPositionRef,
            runtimeTimingRef: this.runtimeTimingRef,
            startMapChangeTransition,
            mergeHud,
        });

        this.disposeKeyboard = attachKeyboardGameplay({
            engineRef: this.engineRef,
            websocketRef: this.websocketRef,
            hotkeySettingsRef: this.hotkeySettingsRef,
            playerHudRef: this.playerHudRef,
            movementKeyMapRef: this.movementKeyMapRef,
            movementPressCountsRef: this.movementPressCountsRef,
            movementKeyPriorityRef: this.movementKeyPriorityRef,
            canProcessMovementInput,
            clearMovementInputState,
            clearTargetingMode,
            hasEquippedMeleeWeapon,
            hasEquippedRangedWeapon,
            recordClientGameAction,
            resolveBlockedGameplayKeyboardReason:
                this.resolveBlockedGameplayKeyboardReason,
            setTargetingMode: (mode: TargetingMode) => setTargetingMode(mode),
            syncMovementState,
            setIsDebugMode: this.setIsDebugMode,
        });

        const outgoingRequests = createOutgoingRequests({
            websocketRef: this.websocketRef,
            engineRef: this.engineRef,
            playerHudRef: this.playerHudRef,
            runtimeTimingRef: this.runtimeTimingRef,
            combatCooldownsRef: this.combatCooldownsRef,
            nextUseItemAtRef: this.nextUseItemAtRef,
            nextDropItemAtRef: this.nextDropItemAtRef,
            nextEquipToggleAtRef: this.nextEquipToggleAtRef,
            setTargetingMode,
            clearTargetingMode,
            getEquippedWeaponItem,
            pushSystemMessage,
            isFishingRodItem,
            isWoodcuttingToolItem,
            isMiningToolItem,
            isSmeltingMineralItem,
            reorderInventoryItems,
            reorderSpells,
            clearExpiredCombatCooldowns,
            recordResourceUseItem,
            recordClientGameAction,
        });
        this.outgoingRequestsRef.current = outgoingRequests;
        const { clearUseItemQueues } = outgoingRequests;

        const entityOverlays = createEntityOverlays({
            getActiveDialogMessages: () => this.activeDialogMessagesRef.current,
            getActiveCastBars: () => this.activeCastBarsRef.current,
            getEngine: () => this.engineRef.current,
            destroyDisplayObjectSafely,
            canUseEngineContainer,
            loadTextures,
            createCastBar,
            createDialogBubble,
            createFloatingCombatText,
            isCombatDialogMessage,
            getDialogMessageDuration,
            getEntityContainer: this.getEntityContainer,
            getPersistentEntityFxIds: () => PERSISTENT_ENTITY_FX_IDS,
            defaultEntityFxDurationMs: DEFAULT_ENTITY_FX_DURATION_MS,
            entityFxAlpha: ENTITY_FX_ALPHA,
            projectileBaseAngleRadians: PROJECTILE_BASE_ANGLE_RADIANS,
            projectileMinDurationMs: PROJECTILE_MIN_DURATION_MS,
            projectileMaxDurationMs: PROJECTILE_MAX_DURATION_MS,
            projectilePixelsPerMs: PROJECTILE_PIXELS_PER_MS,
        });

        const clearAllDialogMessages = () =>
            entityOverlays.clearAllDialogMessages();
        const clearAllCastBars = () => entityOverlays.clearAllCastBars();

        const removeDialogBubbleFromContainer = (container: any) =>
            entityOverlays.removeDialogBubbleFromContainer(container);
        const removeDialogBubbleFromOverlay = (
            engine: Engine,
            entityId: number,
        ) => entityOverlays.removeDialogBubbleFromOverlay(engine, entityId);
        const removeCastBarFromOverlay = (engine: Engine, entityId: number) =>
            entityOverlays.removeCastBarFromOverlay(engine, entityId);
        const clearEntityFX = (
            engine: Engine,
            entityId: number,
            options?: { clearStoredGraphic?: boolean },
        ) => entityOverlays.clearEntityFX(engine, entityId, options);
        const renderEntityFX = (
            engine: Engine,
            entityId: number,
            graphicId: number,
        ) => entityOverlays.renderEntityFX(engine, entityId, graphicId);
        const syncEntityFX = (engine: Engine, entityId: number) =>
            entityOverlays.syncEntityFX(engine, entityId);
        const renderProjectileVisual = (
            engine: Engine,
            startPos: { x: number; y: number },
            endPos: { x: number; y: number },
            graphicId: number,
        ) =>
            entityOverlays.renderProjectileVisual(
                engine,
                startPos,
                endPos,
                graphicId,
            );
        const renderSpellProjectileVisual = (
            engine: Engine,
            startPos: { x: number; y: number },
            endPos: { x: number; y: number },
            spellData: any,
        ) =>
            entityOverlays.renderSpellProjectileVisual(
                engine,
                startPos,
                endPos,
                spellData,
            );
        const syncCastBar = (engine: Engine, entityId: number) =>
            entityOverlays.syncCastBar(engine, entityId);
        const syncDialogBubble = (engine: Engine, entityId: number) =>
            entityOverlays.syncDialogBubble(engine, entityId);
        const showDialogBubble = (
            entityId: number,
            text: string,
            color?: string,
        ) => entityOverlays.showDialogBubble(entityId, text, color);
        const updateActiveDialogBubblePositions = (engine: Engine) =>
            entityOverlays.updateActiveDialogBubblePositions(engine);
        const updateActiveCastBarPositions = (engine: Engine) =>
            entityOverlays.updateActiveCastBarPositions(engine);
        const updateEntityFXPositions = (engine: Engine) =>
            entityOverlays.updateEntityFXPositions(engine);

        const {
            applyCharacterAppearanceChange,
            applyCharacterColorChange,
            applyEquipmentVisualChange,
            applyOwnCharacterSnapshot,
            canRenderRemoteEntities,
            clearTtEntities,
            flushBufferedRemoteEntities,
            removeRemoteEntity,
            renderPlayer,
            renderRemoteEntity,
            syncRemoteEntity,
            syncRemoteEntitiesBatch,
            syncTtEntity,
        } = useRemoteEntityController({
            engineRef: this.engineRef,
            playerHudRef: this.playerHudRef,
            partyMemberIdsRef: this.partyMemberIdsRef,
            pendingUserSnapshotRef: this.pendingUserSnapshotRef,
            pendingRemoteSnapshotsRef: this.pendingRemoteSnapshotsRef,
            lastServerConfirmedSelfPositionRef:
                this.lastServerConfirmedSelfPositionRef,
            latestServerStateVersionRef: this.latestServerStateVersionRef,
            isMapChangeTransitionRef: this.isMapChangeTransitionRef,
            tthoneyCleanupTimeoutsRef: this.tthoneyCleanupTimeoutsRef,
            activeCastBarsRef: this.activeCastBarsRef,
            canUseEngineContainer,
            loadCharacterTextures,
            loadSingleTexture,
            resolveNakedBodyIdFromHeadId,
            preloadGraphicIds,
            syncEntityFX,
            syncDialogBubble,
            removeDialogBubbleFromContainer,
            removeDialogBubbleFromOverlay,
            removeCastBarFromOverlay,
            unregisterContainerCullEntries,
            destroyDisplayObjectSafely,
            createDebugPositionLabel,
            formatCharacterAnimationDebugLabel,
            shouldHideRemoteCharacterBody,
            syncMovementState,
            setWorldVisibility,
            setIsSceneReady: this.setIsSceneReady,
            mergeHud,
            clearEntityFX,
        });

        this.runBootstrap({
            preloadInitialVisibleMapAssets,
            preloadCurrentSceneAssets,
            applyPendingTileStates,
            renderMap,
            flushBufferedRemoteEntities,
            renderPlayer,
            setWorldVisibility,
            updateSeguroIndicators,
            updateDebugCombatText,
            warmCommonCharacterAssets,
            prefetchNearbyMaps,
            applyOwnCharacterSnapshot,
            syncMovementState,
            mergeHud,
            renderRemoteEntity,
            canProcessMovementInput,
            recordClientGameAction,
            canStartLocalCombatAction,
            registerLocalCombatAction,
            updateCanvasCursor,
            clearTargetingMode,
            getEquippedWeaponItem,
            pushSystemMessage,
            resolveCombatReleaseTarget,
            resolveSpellReleaseTarget,
            registerDebugSpellAttempt,
            clearUseItemQueues,
            resetMovementSyncState,
            updateActiveDialogBubblePositions,
            updateActiveCastBarPositions,
            updateEntityFXPositions,
            setNpcContextMenu,
            setDeadCharacterContextMenu,
            setInspectedNpc,
        });

        // Session-persistent reset (was the [connection.sessionKey] effect).
        this.hasAnnouncedConnectionRef.current = false;
        this.pendingPartyMembersRef.current = [];
        this.pendingClanMembersRef.current = [];

        this.packetContext = {
            pendingUserSnapshotRef: this.pendingUserSnapshotRef,
            lastServerConfirmedSelfPositionRef:
                this.lastServerConfirmedSelfPositionRef,
            latestServerStateVersionRef: this.latestServerStateVersionRef,
            pendingPartyMembersRef: this.pendingPartyMembersRef,
            pendingClanMembersRef: this.pendingClanMembersRef,
            hasAnnouncedConnectionRef: this.hasAnnouncedConnectionRef,
            pendingRemoteSnapshotsRef: this.pendingRemoteSnapshotsRef,
            activeCastBarsRef: this.activeCastBarsRef,
            panelSnapshotChunkBufferRef: this.panelSnapshotChunkBufferRef,
            panelSnapshotChunkExpectedIndexRef:
                this.panelSnapshotChunkExpectedIndexRef,
            panelSnapshotChunkTotalRef: this.panelSnapshotChunkTotalRef,
            characterStatsChunkBufferRef: this.characterStatsChunkBufferRef,
            characterStatsChunkExpectedIndexRef:
                this.characterStatsChunkExpectedIndexRef,
            characterStatsChunkTotalRef: this.characterStatsChunkTotalRef,
            runtimeTimingRef: this.runtimeTimingRef,
            emitHud,
            retainPendingRemoteSnapshotsForMap,
            startMapChangeTransition,
            applyOwnCharacterSnapshot,
            emitStatus: this.emitStatus,
            onConsoleMessage: this.onConsoleMessage,
            applyEquipmentVisualChange,
            updateEquippedInventoryByType,
            mergeHud,
            clearEquippedInventory,
            applyCharacterAppearanceChange,
            syncCastBar,
            removeCastBarFromOverlay,
            syncTtEntity,
            canRenderRemoteEntities,
            syncRemoteEntity,
            syncRemoteEntitiesBatch,
            flushBufferedRemoteEntities,
            playStepSound: this.playStepSound,
            reconcileOwnPositionWithServer,
            consumeAcknowledgedLocalMoves,
            clearPendingLocalMoves,
            lockMovementInput,
            isCharacterInmovilizado,
            isCharacterParalizado,
            recordResourceValue,
            applyCharacterColorChange,
            removeInventoryItem,
            upsertInventoryItem,
            updatePendingTileState,
            ensureMapTile,
            queueTileObjectVisualSync,
            removeObjectSprite,
            emitTradeState: (state: any) => this.callbacks.onTradeState?.(state),
            emitMarketState: (state: any) =>
                this.callbacks.onMarketState?.(state),
            emitRetosState: (state: any) => this.callbacks.onRetosState?.(state),
            emitBailState: (state: any) => this.callbacks.onBailState?.(state),
            emitCraftingState: (state: any) =>
                this.callbacks.onCraftingState?.(state),
            emitTrainerState: (state: any) =>
                this.callbacks.onTrainerState?.(state),
            onAdminIntervalsOpen: () => this.notifyStubbed("Admin", true),
            onAdminOverviewSnapshot: () => undefined,
            onCharacterStatsSnapshot: () =>
                this.notifyStubbed("Estadisticas", true),
            upsertSpell,
            clearTargetingMode,
            showDialogBubble,
            onGlobalNotice: this.onGlobalNotice,
            renderEntityFX,
            renderSpellProjectileVisual,
            renderProjectileVisual,
            soundManagerRef: this.soundManagerRef,
            resolveEntitySoundPosition,
            setIsSceneReady: this.setIsSceneReady,
            disconnectSocket: () => this.disconnectSocket(),
            removeRemoteEntity,
        };

        this.sessionDeps = {
            clearUseItemQueues,
            clearTargetingMode,
            resetMovementSyncState,
            clearMovementInputState,
            clearTtEntities,
            emitHud,
            clearAllDialogMessages,
            clearAllCastBars,
        };
    }

    private notifyStubbed(feature: string, state: any) {
        if (!state) {
            return;
        }
        console.log(`[stub] ${feature}:`, state);
        this.callbacks.onNotImplemented?.(feature);
        this.callbacks.onChat(`${feature}: no implementado en este cliente.`, "#94a3b8");
    }

    private sessionDeps: {
        clearUseItemQueues: () => void;
        clearTargetingMode: () => void;
        resetMovementSyncState: () => void;
        clearMovementInputState: (engine?: any) => void;
        clearTtEntities: (engine?: any) => void;
        emitHud: (value: any) => void;
        clearAllDialogMessages: () => void;
        clearAllCastBars: () => void;
    } | null = null;

    private packetContext: any = null;

    private lastBootstrapDeps: any = null;

    private runBootstrap(deps: any): void {
        this.lastBootstrapDeps = deps;
        this.disposeBootstrap?.();
        this.disposeBootstrap = bootstrapRenderer({
            ...deps,
            isMounted: true,
            canvasRef: this.canvasRef,
            rendererRootRef: this.rendererRootRef,
            connection: this.connection,
            mapNumber: this.mapNumber,
            screenSize: this.screenSize,
            sharedTextureCachesRef: this.sharedTextureCachesRef,
            runtimeTimingRef: this.runtimeTimingRef,
            partyMemberIdsRef: this.partyMemberIdsRef,
            engineRef: this.engineRef,
            pendingUserSnapshotRef: this.pendingUserSnapshotRef,
            websocketRef: this.websocketRef,
            nextMoveIdRef: this.nextMoveIdRef,
            localPendingMovesRef: this.localPendingMovesRef,
            playerHudRef: this.playerHudRef,
            pingTextRef: this.pingTextRef,
            seguroTextRef: this.seguroTextRef,
            clanSeguroTextRef: this.clanSeguroTextRef,
            debugCombatTextRef: this.debugCombatTextRef,
            fpsDisplayTextRef: this.fpsDisplayTextRef,
            pingDisplayTextRef: this.pingDisplayTextRef,
            showDebugOverlay: this.debug,
            activeDialogMessagesRef: this.activeDialogMessagesRef,
            activeCastBarsRef: this.activeCastBarsRef,
            latestStatusRef: this.latestStatusRef,
            currentMapRef: this.currentMapRef,
            lastWorldPointerTileRef: this.lastWorldPointerTileRef,
            targetingModeRef: this.targetingModeRef,
            isMapChangeTransitionRef: this.isMapChangeTransitionRef,
            movementInputLockedUntilRef: this.movementInputLockedUntilRef,
            movementInputResumeTimeoutRef: this.movementInputResumeTimeoutRef,
            npcContextMenuOpenedAtRef: this.npcContextMenuOpenedAtRef,
            setIsSceneReady: this.setIsSceneReady,
            setError: this.setError,
            setIsLoading: this.setIsLoading,
            setHasCompletedInitialLoad: this.setHasCompletedInitialLoad,
            setClientReadySessionKey: this.setClientReadySessionKey,
            updateLoadingProgress: this.updateLoadingProgress,
            clearLoadingProgress: this.clearLoadingProgress,
            playStepSound: this.playStepSound,
            recordSpellTargetSnap: this.recordSpellTargetSnap,
            debugCombatOverlayTextRef: this.debugCombatOverlayTextRef,
            onFpsSample: (fps: number | null) =>
                this.emitPerformanceSample({ fps }),
        });
    }

    private rebootstrap(targetMap: number): void {
        // The React version re-ran the bootstrap effect when mapNumber
        // changed; here we dispose and re-run it with the new map.
        if (this.destroyed) {
            return;
        }

        this.mapNumber = targetMap;
        this.currentMapRef.current = targetMap;
        this.activeDialogMessagesRef.current.clear();
        this.activeCastBarsRef.current.clear();

        if (this.lastBootstrapDeps) {
            this.runBootstrap(this.lastBootstrapDeps);
        }
    }

    private startSession(): void {
        if (this.destroyed || !this.sessionDeps || !this.packetContext) {
            return;
        }

        const deps = this.sessionDeps;

        this.disposeSession = startGameSession({
            connection: this.connection,
            isClientReadyForConnection: () =>
                this.clientReadySessionKey === this.connection.sessionKey,
            activeSocketInstanceRef: this.activeSocketInstanceRef,
            websocketRef: this.websocketRef,
            activeSessionKeyRef: this.activeSessionKeyRef,
            pingIntervalRef: this.pingIntervalRef,
            pendingPingRef: this.pendingPingRef,
            recentPingSamplesRef: this.recentPingSamplesRef,
            nextPingTokenRef: this.nextPingTokenRef,
            pingTextRef: this.pingTextRef,
            pingDisplayTextRef: this.pingDisplayTextRef,
            fpsDisplayTextRef: this.fpsDisplayTextRef,
            onPingSample: (pingMs) => this.emitPerformanceSample({ pingMs }),
            clearUseItemQueues: deps.clearUseItemQueues,
            clearTargetingMode: deps.clearTargetingMode,
            resetMovementSyncState: deps.resetMovementSyncState,
            lastServerConfirmedSelfPositionRef:
                this.lastServerConfirmedSelfPositionRef,
            clearMovementInputState: deps.clearMovementInputState,
            clearTtEntities: deps.clearTtEntities,
            incomingPacketQueueRef: this.incomingPacketQueueRef,
            isProcessingIncomingPacketsRef: this.isProcessingIncomingPacketsRef,
            lastSentChatTokenRef: this.lastSentChatTokenRef,
            pendingUserSnapshotRef: this.pendingUserSnapshotRef,
            pendingRemoteSnapshotsRef: this.pendingRemoteSnapshotsRef,
            setIsSceneReady: this.setIsSceneReady,
            emitHud: deps.emitHud,
            emitStatus: this.emitStatus,
            flushPendingChatRequest: this.flushPendingChatRequest,
            currentMapRef: this.currentMapRef,
            engineRef: this.engineRef,
            latestStatusRef: this.latestStatusRef,
            clearAllDialogMessages: deps.clearAllDialogMessages,
            clearAllCastBars: deps.clearAllCastBars,
            panelSnapshotChunkBufferRef: this.panelSnapshotChunkBufferRef,
            panelSnapshotChunkExpectedIndexRef:
                this.panelSnapshotChunkExpectedIndexRef,
            panelSnapshotChunkTotalRef: this.panelSnapshotChunkTotalRef,
            characterStatsChunkBufferRef: this.characterStatsChunkBufferRef,
            characterStatsChunkExpectedIndexRef:
                this.characterStatsChunkExpectedIndexRef,
            characterStatsChunkTotalRef: this.characterStatsChunkTotalRef,
            onPacket: async ({ packet, engine, renderedMapNumber, disconnectSocket }) => {
                await handleIncomingGamePacket(
                    packet,
                    engine,
                    renderedMapNumber,
                    { ...this.packetContext, disconnectSocket },
                );
            },
        });
    }

    private disconnectSocket(): void {
        this.disposeSession?.();
        this.disposeSession = null;
    }

    useInventoryItem(slot: number): void {
        this.outgoingRequestsRef.current?.useItemClick(slot);
    }

    assignAttributePoint(attrId: number): void {
        this.outgoingRequestsRef.current?.assignAttributePoint(attrId);
    }

    castSpell(spell: SpellEntry): void {
        this.outgoingRequestsRef.current?.castSpell(spell);
    }

    setMasterVolume(volume: number): void {
        this.soundManagerRef.current?.setMasterVolume(volume);
    }

    equipInventoryItem(slot: number): void {
        this.outgoingRequestsRef.current?.equip(slot);
    }

    dropInventoryItem(slot: number, amount: number): void {
        this.outgoingRequestsRef.current?.drop(slot, amount);
    }

    buyTradeItem(slot: number, amount: number): void {
        this.outgoingRequestsRef.current?.buy(slot, amount);
    }

    sellTradeItem(slot: number, amount: number): void {
        this.outgoingRequestsRef.current?.sell(slot, amount);
    }

    closeTradeWindow(): void {
        this.outgoingRequestsRef.current?.closeTrade();
    }

    changeBankTab(tab: "character" | "account" | "clan"): void {
        this.outgoingRequestsRef.current?.changeBankTab(tab);
    }

    depositBankGold(amount: number): void {
        this.outgoingRequestsRef.current?.depositBankGold(amount);
    }

    withdrawBankGold(amount: number): void {
        this.outgoingRequestsRef.current?.withdrawBankGold(amount);
    }

    reorderBankItem(sourceSlot: number, targetSlot: number): void {
        this.outgoingRequestsRef.current?.reorderBank(sourceSlot, targetSlot);
    }

    marketAction(
        action: "refresh" | "create" | "buy" | "cancel" | "claim",
        payload?: Record<string, unknown>,
    ): void {
        this.outgoingRequestsRef.current?.marketAction(action, payload);
    }

    retosAction(
        action: "refresh" | "create" | "join" | "cancel",
        payload?: Record<string, unknown>,
    ): void {
        this.outgoingRequestsRef.current?.retosAction(action, payload);
    }

    craftItem(
        profession: "carpentry" | "blacksmith" | "tailoring",
        itemId: number,
        amount: number,
    ): void {
        this.outgoingRequestsRef.current?.craft(profession, itemId, amount);
    }

    trainerAction(
        action: "list" | "invoke",
        payload?: Record<string, unknown>,
    ): void {
        this.outgoingRequestsRef.current?.trainerAction(action, payload);
    }

    // Sprite-sheet graphic for a grhIndex, used by the DOM HUD to build
    // item icons with the same /graphics/<numFile>.png assets as pixi.
    resolveIconGraphic(grhIndex: number): GraphicData | null {
        return resolveIconGraphic(this.engineRef.current?.graphicsDB, grhIndex);
    }

    sendChat(message: string): boolean {
        if (this.destroyed) {
            return false;
        }

        const socket = this.websocketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(createDialogPacket(message));
            return true;
        }

        // buffer until the socket opens
        this.pendingChatMessageRef.current = message;
        return true;
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.outgoingRequestsRef.current = null;

        this.disposeKeyboard?.();
        this.disposeKeyboard = null;
        this.disposeSession?.();
        this.disposeSession = null;
        this.disposeBootstrap?.();
        this.disposeBootstrap = null;

        if (this.movementInputResumeTimeoutRef.current !== null) {
            window.clearTimeout(this.movementInputResumeTimeoutRef.current);
            this.movementInputResumeTimeoutRef.current = null;
        }

        this.soundManagerRef.current?.destroy();
        this.soundManagerRef.current = null;
        this.stepVariantRef.current.clear();
        this.lastStepSoundAtRef.current.clear();

        destroySharedTextureCaches(this.sharedTextureCachesRef.current);

        this.canvasHost.remove();
    }
}
