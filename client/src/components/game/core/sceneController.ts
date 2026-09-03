import { useCallback, type RefObject } from "../vanilla";
import type { MapTile } from "../../../types/game";
import type { Engine } from "../engine/Engine";
import {
    applyPendingTileStates as applyPendingSceneTileStates,
    ensureMapTile as ensureSceneMapTile,
    flushPendingTileObjectVisualSyncs as flushPendingSceneTileObjectVisualSyncs,
    queueTileObjectVisualSync as queueSceneTileObjectVisualSync,
    removeObjectSprite as removeSceneObjectSprite,
    renderMap as renderSceneMap,
    renderRoofLayer as renderSceneRoofLayer,
    renderTileLayer as renderSceneTileLayer,
    scheduleTileObjectVisualSyncFlush as scheduleSceneTileObjectVisualSyncFlush,
    syncTileObjectVisual as syncSceneTileObjectVisual,
} from "../rendering/sceneRenderer";
import type { TileBounds } from "../assets/scenePreload";

type PendingTileState = {
    objInfo?: MapTile["objInfo"] | null;
    blocked?: MapTile["blocked"] | null;
};

type LoadingStage =
    | "Preparando cliente"
    | "Cargando escena inicial"
    | "Cargando personaje"
    | "Cargando hechizos"
    | "Renderizando mundo"
    | "Precargando alrededores";

type UseSceneControllerOptions = {
    pendingTileStatesRef: RefObject<Map<string, PendingTileState>>;
    isMapChangeTransitionRef: RefObject<boolean>;
    setIsSceneReady: (ready: boolean) => void;
    setIsLoading: (value: boolean) => void;
    updateLoadingProgress: (
        stage: LoadingStage,
        progress: number,
        detail: string,
    ) => void;
    onMapChange?: ((mapNumber: number) => void) | undefined;
    canUseEngineContainer: (engine: Engine, container: any) => boolean;
    preloadGraphicIds: (engine: Engine, graphicIds: string[]) => Promise<void>;
    loadTextures: (engine: Engine, graphicIds: string[]) => Promise<void>;
};

export function useSceneController({
    pendingTileStatesRef,
    isMapChangeTransitionRef,
    setIsSceneReady,
    setIsLoading,
    updateLoadingProgress,
    onMapChange,
    canUseEngineContainer,
    preloadGraphicIds,
    loadTextures,
}: UseSceneControllerOptions) {
    const getPendingTileStateKey = useCallback(
        (targetMap: number, x: number, y: number) => `${targetMap}:${x},${y}`,
        [],
    );

    const updatePendingTileState = useCallback(
        (
            targetMap: number,
            x: number,
            y: number,
            updater: (current: PendingTileState) => PendingTileState,
        ) => {
            const key = getPendingTileStateKey(targetMap, x, y);
            const current = pendingTileStatesRef.current.get(key) ?? {};
            pendingTileStatesRef.current.set(key, updater(current));
        },
        [getPendingTileStateKey, pendingTileStatesRef],
    );

    const clearPendingTileStatesForMap = useCallback(
        (targetMap: number) => {
            const mapPrefix = `${targetMap}:`;

            for (const key of pendingTileStatesRef.current.keys()) {
                if (key.startsWith(mapPrefix)) {
                    pendingTileStatesRef.current.delete(key);
                }
            }
        },
        [pendingTileStatesRef],
    );

    const setWorldVisibility = useCallback(
        (engine: Engine, visible: boolean) => {
            if (engine.mapContainer) {
                engine.mapContainer.visible = visible;
            }
            if (engine.roofContainer) {
                engine.roofContainer.visible = visible;
            }
            if (engine.playerContainer) {
                engine.playerContainer.visible = visible;
            }
            if (engine.entityFXOverlayContainer) {
                engine.entityFXOverlayContainer.visible = visible;
            }
            if (engine.dialogOverlayContainer) {
                engine.dialogOverlayContainer.visible = visible;
            }
            if (engine.debugGrid) {
                engine.debugGrid.visible = visible && engine.isDebugMode;
            }
        },
        [],
    );

    const startMapChangeTransition = useCallback(
        (targetMap: number, engine: Engine | null, detail: string) => {
            isMapChangeTransitionRef.current = true;
            setIsSceneReady(false);
            setIsLoading(true);
            updateLoadingProgress("Cargando escena inicial", 6, detail);
            clearPendingTileStatesForMap(targetMap);

            if (engine?.app) {
                engine.app.canvas.style.opacity = "0";
            }

            if (engine) {
                engine.keydown = {};
                engine.movementKeyPriority = [];

                if (engine.user) {
                    engine.resetMovement(engine.user);
                }

                setWorldVisibility(engine, false);
            }

            onMapChange?.(targetMap);
        },
        [
            clearPendingTileStatesForMap,
            isMapChangeTransitionRef,
            onMapChange,
            setIsLoading,
            setIsSceneReady,
            setWorldVisibility,
            updateLoadingProgress,
        ],
    );

    const renderMap = useCallback(
        (
            engine: Engine,
            options?: {
                includeLayers?: Array<"1" | "2" | "3" | "4">;
                includeObjects?: boolean;
                bounds?: TileBounds;
                excludeBounds?: TileBounds;
            },
        ) =>
            renderSceneMap(
                engine,
                {
                    canUseEngineContainer,
                    preloadGraphicIds,
                    syncTileObjectVisual: syncSceneTileObjectVisual,
                    renderTileLayer: renderSceneTileLayer,
                    renderRoofLayer: renderSceneRoofLayer,
                },
                options,
            ),
        [canUseEngineContainer, preloadGraphicIds],
    );

    const ensureMapTile = useCallback(
        (engine: Engine, mapNumber: number, x: number, y: number) =>
            ensureSceneMapTile(engine, mapNumber, x, y),
        [],
    );

    const applyPendingTileStates = useCallback(
        (engine: Engine) =>
            applyPendingSceneTileStates(engine, pendingTileStatesRef.current),
        [pendingTileStatesRef],
    );

    const removeObjectSprite = useCallback(
        (engine: Engine, tileKey: string) =>
            removeSceneObjectSprite(engine, tileKey),
        [],
    );

    const scheduleTileObjectVisualSyncFlush = useCallback(
        (engine: Engine) => {
            const flushTileObjectVisualSyncs = (targetEngine: Engine) =>
                flushPendingSceneTileObjectVisualSyncs(targetEngine, {
                    syncTileObjectVisual: syncSceneTileObjectVisual,
                    canUseEngineContainer,
                    loadTextures,
                    renderTileLayer: renderSceneTileLayer,
                    scheduleTileObjectVisualSyncFlush: (nextEngine) =>
                        scheduleSceneTileObjectVisualSyncFlush(
                            nextEngine,
                            flushTileObjectVisualSyncs,
                        ),
                });

            scheduleSceneTileObjectVisualSyncFlush(
                engine,
                flushTileObjectVisualSyncs,
            );
        },
        [canUseEngineContainer, loadTextures],
    );

    const queueTileObjectVisualSync = useCallback(
        (engine: Engine, mapNumber: number, x: number, y: number) =>
            queueSceneTileObjectVisualSync(
                engine,
                mapNumber,
                x,
                y,
                scheduleTileObjectVisualSyncFlush,
            ),
        [scheduleTileObjectVisualSyncFlush],
    );

    return {
        applyPendingTileStates,
        clearPendingTileStatesForMap,
        ensureMapTile,
        queueTileObjectVisualSync,
        removeObjectSprite,
        renderMap,
        scheduleTileObjectVisualSyncFlush,
        setWorldVisibility,
        startMapChangeTransition,
        updatePendingTileState,
    };
}
