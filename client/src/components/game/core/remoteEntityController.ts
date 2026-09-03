/* eslint-disable react-hooks/immutability */
import { useCallback } from "../vanilla";
import type { RefObject } from "../vanilla";
import type { CharacterSnapshot } from "../../../lib/aowProtocol";
import {
    renderLocalPlayer,
    renderRemoteCharacter,
} from "../rendering/characterRenderer";
import type { TileBounds } from "../assets/scenePreload";
import {
    collectCharacterGraphicIds,
    collectSpellGraphicIds,
    isCharacterWithinBounds,
} from "../assets/scenePreload";
import type { Engine, Character } from "../engine/Engine";

type UseRemoteEntityControllerOptions = {
    engineRef: RefObject<Engine | null>;
    playerHudRef: RefObject<any>;
    partyMemberIdsRef: RefObject<Set<string>>;
    pendingUserSnapshotRef: RefObject<CharacterSnapshot | null>;
    pendingRemoteSnapshotsRef: RefObject<Map<number, CharacterSnapshot>>;
    lastServerConfirmedSelfPositionRef: RefObject<any>;
    latestServerStateVersionRef: RefObject<number>;
    isMapChangeTransitionRef: RefObject<boolean>;
    tthoneyCleanupTimeoutsRef: RefObject<Map<number, number>>;
    activeCastBarsRef: RefObject<Map<number, any>>;
    canUseEngineContainer: (engine: Engine, container: any) => boolean;
    loadCharacterTextures: (
        engine: Engine,
        graphicId: number,
        graphicData: any,
    ) => Promise<any>;
    loadSingleTexture: (
        engine: Engine,
        graphicId: number,
        graphicData: any,
    ) => Promise<any>;
    resolveNakedBodyIdFromHeadId: (headId: number) => number | null;
    preloadGraphicIds: (engine: Engine, graphicIds: string[]) => Promise<void>;
    syncEntityFX: (engine: Engine, entityId: number) => Promise<void>;
    syncDialogBubble: (engine: Engine, entityId: number) => void;
    removeDialogBubbleFromContainer: (container: any) => void;
    removeDialogBubbleFromOverlay: (engine: Engine, entityId: number) => void;
    removeCastBarFromOverlay: (engine: Engine, entityId: number) => void;
    unregisterContainerCullEntries: (engine: Engine, container: any) => void;
    destroyDisplayObjectSafely: (
        displayObject: any,
        options?: { children?: boolean },
    ) => void;
    createDebugPositionLabel: (text: string) => any;
    formatCharacterAnimationDebugLabel: (character: Character) => string;
    shouldHideRemoteCharacterBody: (
        entity: Character,
        localCharacterId: number | undefined,
        partyMemberIds: Set<string>,
    ) => boolean;
    syncMovementState: (engine: Engine) => void;
    setWorldVisibility: (engine: Engine, visible: boolean) => void;
    setIsSceneReady: (ready: boolean) => void;
    mergeHud: (patch: any) => void;
    clearEntityFX: (
        engine: Engine,
        entityId: number,
        options?: { clearStoredGraphic?: boolean },
    ) => void;
};

export function useRemoteEntityController(
    options: UseRemoteEntityControllerOptions,
) {
    const renderRemoteEntity = useCallback(
        async (engine: Engine, entity: Character | null | undefined) =>
            renderRemoteCharacter(engine, entity, {
                canUseEngineContainer: options.canUseEngineContainer,
                loadCharacterTextures: options.loadCharacterTextures,
                loadSingleTexture: options.loadSingleTexture,
                resolveNakedBodyIdFromHeadId:
                    options.resolveNakedBodyIdFromHeadId,
                preloadGraphicIds: options.preloadGraphicIds,
                collectCharacterGraphicIds,
                syncEntityFX: options.syncEntityFX,
                syncDialogBubble: options.syncDialogBubble,
                removeDialogBubbleFromContainer:
                    options.removeDialogBubbleFromContainer,
                removeDialogBubbleFromOverlay:
                    options.removeDialogBubbleFromOverlay,
                unregisterContainerCullEntries:
                    options.unregisterContainerCullEntries,
                destroyDisplayObjectSafely: options.destroyDisplayObjectSafely,
                createDebugPositionLabel: options.createDebugPositionLabel,
                formatCharacterAnimationDebugLabel:
                    options.formatCharacterAnimationDebugLabel,
                shouldHideRemoteCharacterBody:
                    options.shouldHideRemoteCharacterBody,
                playerHudRef: options.playerHudRef,
                partyMemberIdsRef: options.partyMemberIdsRef,
            }),
        [options],
    );

    const renderPlayer = useCallback(
        async (engine: Engine) =>
            renderLocalPlayer(engine, {
                canUseEngineContainer: options.canUseEngineContainer,
                loadCharacterTextures: options.loadCharacterTextures,
                loadSingleTexture: options.loadSingleTexture,
                resolveNakedBodyIdFromHeadId:
                    options.resolveNakedBodyIdFromHeadId,
                preloadGraphicIds: options.preloadGraphicIds,
                syncEntityFX: options.syncEntityFX,
                syncDialogBubble: options.syncDialogBubble,
                removeDialogBubbleFromContainer:
                    options.removeDialogBubbleFromContainer,
                removeDialogBubbleFromOverlay:
                    options.removeDialogBubbleFromOverlay,
                unregisterContainerCullEntries:
                    options.unregisterContainerCullEntries,
                destroyDisplayObjectSafely: options.destroyDisplayObjectSafely,
                createDebugPositionLabel: options.createDebugPositionLabel,
                formatCharacterAnimationDebugLabel:
                    options.formatCharacterAnimationDebugLabel,
                shouldHideRemoteCharacterBody:
                    options.shouldHideRemoteCharacterBody,
                playerHudRef: options.playerHudRef,
                partyMemberIdsRef: options.partyMemberIdsRef,
            }),
        [options],
    );

    const syncRemoteEntity = useCallback(
        async (
            engine: Engine,
            snapshotOrEntity: CharacterSnapshot | Character,
        ): Promise<void> => {
            if (
                snapshotOrEntity.id === engine.user?.id ||
                snapshotOrEntity.map !== engine.mapNumber
            ) {
                return;
            }

            const existing = engine.personajes[snapshotOrEntity.id];
            const isRuntimeEntity = existing === snapshotOrEntity;

            if (existing) {
                if (!isRuntimeEntity) {
                    engine.applySnapshotToCharacter(
                        existing,
                        snapshotOrEntity as CharacterSnapshot,
                        {
                            preservePosition:
                                existing.map === snapshotOrEntity.map,
                        },
                    );
                }
            } else {
                engine.personajes[snapshotOrEntity.id] =
                    engine.createCharacterFromSnapshot(
                        snapshotOrEntity as CharacterSnapshot,
                    );
            }

            const graphicSource = isRuntimeEntity
                ? ({
                      ...snapshotOrEntity,
                      tt: snapshotOrEntity.tthoney ? 1 : 0,
                  } as unknown as CharacterSnapshot)
                : (snapshotOrEntity as CharacterSnapshot);

            await options.preloadGraphicIds(
                engine,
                collectCharacterGraphicIds(engine, graphicSource, {
                    includeBody: false,
                }),
            );

            const syncedEntity = engine.personajes[snapshotOrEntity.id];
            if (!syncedEntity) {
                return;
            }

            await renderRemoteEntity(engine, syncedEntity);
        },
        [options, renderRemoteEntity],
    );

    const canRenderRemoteEntities = useCallback(
        (engine: Engine | null): engine is Engine =>
            Boolean(
                engine?.mapContainer &&
                engine?.graphicsDB &&
                engine?.bodiesDB &&
                engine?.headsDB,
            ),
        [],
    );

    const syncRemoteEntitiesBatch = useCallback(
        async (
            engine: Engine,
            snapshots: CharacterSnapshot[],
            batchOptions?: { preloadBodies?: boolean },
        ): Promise<void> => {
            const renderableSnapshots = snapshots.filter(
                (snapshot) =>
                    snapshot.id !== engine.user?.id &&
                    snapshot.map === engine.mapNumber,
            );

            if (renderableSnapshots.length === 0) {
                return;
            }

            for (const snapshot of renderableSnapshots) {
                const existing = engine.personajes[snapshot.id];
                if (existing) {
                    engine.applySnapshotToCharacter(existing, snapshot, {
                        preservePosition: existing.map === snapshot.map,
                    });
                } else {
                    engine.personajes[snapshot.id] =
                        engine.createCharacterFromSnapshot(snapshot);
                }
            }

            const graphicIds = new Set<string>();
            for (const snapshot of renderableSnapshots) {
                for (const graphicId of collectCharacterGraphicIds(
                    engine,
                    snapshot,
                    {
                        includeBody: batchOptions?.preloadBodies ?? false,
                    },
                )) {
                    graphicIds.add(graphicId);
                }
            }

            if (graphicIds.size > 0) {
                // Area snapshots are much cheaper when shared textures are loaded once.
                await options.preloadGraphicIds(engine, [...graphicIds]);
            }

            if (engine.isDestroyed) {
                return;
            }

            for (const snapshot of renderableSnapshots) {
                const syncedEntity = engine.personajes[snapshot.id];
                if (syncedEntity) {
                    await renderRemoteEntity(engine, syncedEntity);
                }
            }
        },
        [options, renderRemoteEntity],
    );

    const flushBufferedRemoteEntities = useCallback(
        async (engine: Engine, bounds?: TileBounds | null): Promise<void> => {
            if (!canRenderRemoteEntities(engine)) {
                return;
            }

            const bufferedSnapshots = Array.from(
                options.pendingRemoteSnapshotsRef.current.values(),
            )
                .filter(
                    (snapshot) =>
                        snapshot.map === engine.mapNumber &&
                        snapshot.id !== engine.user?.id &&
                        (!bounds || isCharacterWithinBounds(snapshot, bounds)),
                )
                .sort((left, right) => left.id - right.id);

            await syncRemoteEntitiesBatch(engine, bufferedSnapshots, {
                preloadBodies: Boolean(bounds),
            });

            for (const snapshot of bufferedSnapshots) {
                if (
                    options.pendingRemoteSnapshotsRef.current.get(
                        snapshot.id,
                    ) === snapshot
                ) {
                    options.pendingRemoteSnapshotsRef.current.delete(
                        snapshot.id,
                    );
                }
            }
        },
        [
            canRenderRemoteEntities,
            options.pendingRemoteSnapshotsRef,
            syncRemoteEntitiesBatch,
        ],
    );

    const removeRemoteEntity = useCallback(
        (engine: Engine, id: number): void => {
            const tthoneyTimeoutId =
                options.tthoneyCleanupTimeoutsRef.current.get(id);
            if (typeof tthoneyTimeoutId === "number") {
                window.clearTimeout(tthoneyTimeoutId);
                options.tthoneyCleanupTimeoutsRef.current.delete(id);
            }

            options.clearEntityFX(engine, id);
            engine.remoteEntityRenderRequestIds.delete(id);
            options.activeCastBarsRef.current.delete(id);
            options.removeCastBarFromOverlay(engine, id);

            const container = engine.remoteEntities.get(id);
            if (container) {
                options.removeDialogBubbleFromContainer(container);
                options.removeDialogBubbleFromOverlay(engine, id);
                options.unregisterContainerCullEntries(engine, container);
                container.parent?.removeChild(container);
                options.destroyDisplayObjectSafely(container, {
                    children: true,
                });
                engine.remoteEntities.delete(id);
            }

            if (engine.user?.id !== id) {
                delete engine.personajes[id];
            }
        },
        [options],
    );

    const clearTtEntities = useCallback(
        (engine: Engine | null): void => {
            for (const timeoutId of options.tthoneyCleanupTimeoutsRef.current.values()) {
                window.clearTimeout(timeoutId);
            }

            options.tthoneyCleanupTimeoutsRef.current.clear();

            if (!engine) {
                return;
            }

            for (const [id, character] of Object.entries(engine.personajes)) {
                if (character.tthoney) {
                    delete engine.personajes[Number(id)];
                }
            }
        },
        [options.tthoneyCleanupTimeoutsRef],
    );

    const syncTtEntity = useCallback(
        (engine: Engine, snapshot: CharacterSnapshot): void => {
            if (
                snapshot.id === engine.user?.id ||
                snapshot.map !== engine.mapNumber
            ) {
                return;
            }

            const existing = engine.personajes[snapshot.id];
            if (existing) {
                engine.applySnapshotToCharacter(existing, snapshot, {
                    preservePosition: existing.map === snapshot.map,
                });
            } else {
                engine.personajes[snapshot.id] =
                    engine.createCharacterFromSnapshot(snapshot);
            }

            const previousTimeoutId =
                options.tthoneyCleanupTimeoutsRef.current.get(snapshot.id);
            if (typeof previousTimeoutId === "number") {
                window.clearTimeout(previousTimeoutId);
            }

            const timeoutId = window.setTimeout(() => {
                options.tthoneyCleanupTimeoutsRef.current.delete(snapshot.id);
                if (engine.personajes[snapshot.id]?.tthoney) {
                    delete engine.personajes[snapshot.id];
                }
            }, 5000);

            options.tthoneyCleanupTimeoutsRef.current.set(
                snapshot.id,
                timeoutId,
            );
        },
        [options.tthoneyCleanupTimeoutsRef],
    );

    const applyCharacterAppearanceChange = useCallback(
        async (
            entityId: number,
            patch: Partial<
                Pick<
                    CharacterSnapshot,
                    "idBody" | "idHead" | "idHelmet" | "idWeapon" | "idShield"
                >
            >,
        ) => {
            const engine = options.engineRef.current;

            if (options.pendingUserSnapshotRef.current?.id === entityId) {
                options.pendingUserSnapshotRef.current = {
                    ...options.pendingUserSnapshotRef.current,
                    ...patch,
                };
            }

            const pendingRemoteSnapshot =
                options.pendingRemoteSnapshotsRef.current.get(entityId);
            if (pendingRemoteSnapshot) {
                options.pendingRemoteSnapshotsRef.current.set(entityId, {
                    ...pendingRemoteSnapshot,
                    ...patch,
                });
            }

            if (!engine) {
                return;
            }

            const entity = engine.personajes[entityId];
            if (!entity) {
                return;
            }

            Object.assign(entity, patch);

            if (engine.user?.id === entityId) {
                options.mergeHud({
                    idBody: patch.idBody,
                    idHead: patch.idHead,
                    idHelmet: patch.idHelmet,
                    idWeapon: patch.idWeapon,
                    idShield: patch.idShield,
                });
                await options.preloadGraphicIds(
                    engine,
                    collectCharacterGraphicIds(engine, {
                        ...(options.pendingUserSnapshotRef.current ?? {
                            id: entity.id,
                            nameCharacter: entity.nameCharacter || "Jugador",
                            idClase: 0,
                            map: entity.map,
                            pos: { ...entity.pos },
                            idHead: entity.idHead,
                            idHelmet: entity.idHelmet ?? 0,
                            idWeapon: entity.idWeapon ?? 0,
                            idShield: entity.idShield ?? 0,
                            idBody: entity.idBody,
                            heading: entity.heading,
                        }),
                        ...patch,
                    } as CharacterSnapshot),
                );
                await renderPlayer(engine);
                return;
            }

            await options.preloadGraphicIds(
                engine,
                collectCharacterGraphicIds(engine, {
                    id: entity.id,
                    nameCharacter: entity.nameCharacter || "Jugador",
                    idClase: 0,
                    map: entity.map,
                    pos: { ...entity.pos },
                    idHead: (patch.idHead ?? entity.idHead) || 0,
                    idHelmet: patch.idHelmet ?? entity.idHelmet ?? 0,
                    idWeapon: patch.idWeapon ?? entity.idWeapon ?? 0,
                    idShield: patch.idShield ?? entity.idShield ?? 0,
                    idBody: patch.idBody ?? entity.idBody,
                    heading: entity.heading,
                }),
            );
            await renderRemoteEntity(engine, entity);
        },
        [options, renderPlayer, renderRemoteEntity],
    );

    const applyCharacterColorChange = useCallback(
        async (entityId: number, color: string) => {
            const engine = options.engineRef.current;

            if (options.pendingUserSnapshotRef.current?.id === entityId) {
                options.pendingUserSnapshotRef.current = {
                    ...options.pendingUserSnapshotRef.current,
                    color,
                };
            }

            const pendingRemoteSnapshot =
                options.pendingRemoteSnapshotsRef.current.get(entityId);
            if (pendingRemoteSnapshot) {
                options.pendingRemoteSnapshotsRef.current.set(entityId, {
                    ...pendingRemoteSnapshot,
                    color,
                });
            }

            if (!engine) {
                return;
            }

            const entity = engine.personajes[entityId];
            if (!entity) {
                return;
            }

            entity.color = color;

            if (engine.user?.id === entityId) {
                engine.user.color = color;
                await renderPlayer(engine);
                return;
            }

            await renderRemoteEntity(engine, entity);
        },
        [options, renderPlayer, renderRemoteEntity],
    );

    const applyEquipmentVisualChange = useCallback(
        async (
            entityId: number,
            patch: Partial<
                Pick<
                    CharacterSnapshot,
                    "idBody" | "idHelmet" | "idWeapon" | "idShield"
                >
            >,
        ) => {
            await applyCharacterAppearanceChange(entityId, patch);
        },
        [applyCharacterAppearanceChange],
    );

    const applyOwnCharacterSnapshot = useCallback(
        async (engine: Engine, snapshot: CharacterSnapshot): Promise<void> => {
            options.pendingUserSnapshotRef.current = snapshot;
            options.lastServerConfirmedSelfPositionRef.current = {
                map: snapshot.map,
                x: snapshot.pos.x,
                y: snapshot.pos.y,
            };
            options.latestServerStateVersionRef.current = Math.max(
                options.latestServerStateVersionRef.current,
                snapshot.stateVersion ?? 0,
            );

            if (snapshot.map !== engine.mapNumber) {
                return;
            }

            const previousMap = engine.user?.map;

            if (!engine.user) {
                engine.user = engine.createCharacterFromSnapshot(snapshot);
                engine.personajes[engine.user.id] = engine.user;
            } else if (engine.user.id !== snapshot.id) {
                delete engine.personajes[engine.user.id];
                engine.user = engine.createCharacterFromSnapshot(snapshot);
                engine.personajes[engine.user.id] = engine.user;
            } else {
                engine.applySnapshotToCharacter(engine.user, snapshot, {
                    preservePosition: engine.user.map === snapshot.map,
                });
            }

            engine.mapNumber = snapshot.map;
            engine.worldName = engine.worldName || "";
            engine.personajes[engine.user.id] = engine.user;
            if (previousMap !== undefined && previousMap !== snapshot.map) {
                engine.resetMovement(engine.user);
            }
            await options.preloadGraphicIds(
                engine,
                collectCharacterGraphicIds(engine, snapshot, {
                    includeBody: false,
                }),
            );
            if (engine.isDestroyed) {
                return;
            }
            await options.preloadGraphicIds(
                engine,
                collectSpellGraphicIds(engine, snapshot.spells ?? []),
            );
            if (engine.isDestroyed) {
                return;
            }
            await renderPlayer(engine);
            if (engine.isDestroyed) {
                return;
            }
            engine.updateCamera();
            engine.updatePlayerSprite();
            engine.updateCulling();
            options.isMapChangeTransitionRef.current = false;
            options.syncMovementState(engine);
            options.setWorldVisibility(engine, true);
            options.setIsSceneReady(true);

            void flushBufferedRemoteEntities(engine).catch((error) => {
                console.warn(
                    "Failed to flush buffered remote entities:",
                    error,
                );
            });
        },
        [flushBufferedRemoteEntities, options, renderPlayer],
    );

    return {
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
    };
}
