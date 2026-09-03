import { useCallback, type RefObject } from "../vanilla";
import type { Engine } from "../engine/Engine";

export type LocalPendingMove = {
    moveId: number;
    heading: number;
};

type UseMovementSyncOptions = {
    engineRef: RefObject<Engine | null>;
    localPendingMovesRef: RefObject<LocalPendingMove[]>;
    nextMoveIdRef: RefObject<number>;
    latestServerStateVersionRef: RefObject<number>;
    movementInputLockedUntilRef: RefObject<number>;
    movementInputResumeTimeoutRef: RefObject<number | null>;
    isMapChangeTransitionRef: RefObject<boolean>;
    movementKeyMapRef: RefObject<Map<string, number>>;
    movementPressCountsRef: RefObject<Map<number, number>>;
    movementKeyPriorityRef: RefObject<number[]>;
    pendingRemoteSnapshotsRef: RefObject<Map<number, any>>;
    pendingUserSnapshotRef: RefObject<any>;
    lastServerConfirmedSelfPositionRef: RefObject<any>;
    runtimeTimingRef: RefObject<any>;
    startMapChangeTransition: (
        targetMap: number,
        engine: Engine | null,
        detail: string,
    ) => void;
    mergeHud: (patch: any) => void;
};

export function useMovementSync({
    engineRef,
    localPendingMovesRef,
    nextMoveIdRef,
    latestServerStateVersionRef,
    movementInputLockedUntilRef,
    movementInputResumeTimeoutRef,
    isMapChangeTransitionRef,
    movementKeyMapRef,
    movementPressCountsRef,
    movementKeyPriorityRef,
    pendingRemoteSnapshotsRef,
    pendingUserSnapshotRef,
    lastServerConfirmedSelfPositionRef,
    runtimeTimingRef,
    startMapChangeTransition,
    mergeHud,
}: UseMovementSyncOptions) {
    const syncMovementState = useCallback(
        (engine: Engine) => {
            if (isMapChangeTransitionRef.current) {
                engine.keydown = {};
                engine.movementKeyPriority = [];
                engine.clearScheduledMovementCheck();
                return;
            }

            engine.keydown = {};

            for (const [keyCode, count] of movementPressCountsRef.current) {
                if (count > 0) {
                    engine.keydown[keyCode] = true;
                }
            }

            engine.movementKeyPriority = movementKeyPriorityRef.current.filter(
                (keyCode) => engine.keydown[keyCode],
            );

            if (engine.movementKeyPriority.length === 0) {
                engine.clearScheduledMovementCheck();
                return;
            }

            engine.check();
        },
        [
            isMapChangeTransitionRef,
            movementKeyPriorityRef,
            movementPressCountsRef,
        ],
    );

    const clearMovementInputState = useCallback(
        (engine?: Engine | null) => {
            movementKeyMapRef.current.clear();
            movementPressCountsRef.current.clear();
            movementKeyPriorityRef.current = [];

            if (movementInputResumeTimeoutRef.current !== null) {
                window.clearTimeout(movementInputResumeTimeoutRef.current);
                movementInputResumeTimeoutRef.current = null;
            }

            if (!engine) {
                return;
            }

            engine.keydown = {};
            engine.movementKeyPriority = [];
            engine.clearScheduledMovementCheck();

            if (engine.user) {
                engine.resetMovement(engine.user);
            }
        },
        [
            movementInputResumeTimeoutRef,
            movementKeyMapRef,
            movementKeyPriorityRef,
            movementPressCountsRef,
        ],
    );

    const clearEngineMovementState = useCallback((engine?: Engine | null) => {
        if (!engine) {
            return;
        }

        engine.keydown = {};
        engine.movementKeyPriority = [];
        engine.clearScheduledMovementCheck();

        if (engine.user) {
            engine.resetMovement(engine.user);
        }
    }, []);

    const lockMovementInput = useCallback(
        (engine?: Engine | null, durationMs = 60) => {
            movementInputLockedUntilRef.current =
                performance.now() + Math.max(0, durationMs);
            clearEngineMovementState(engine);

            if (movementInputResumeTimeoutRef.current !== null) {
                window.clearTimeout(movementInputResumeTimeoutRef.current);
            }

            movementInputResumeTimeoutRef.current = window.setTimeout(
                () => {
                    movementInputResumeTimeoutRef.current = null;

                    const activeEngine = engineRef.current;

                    if (
                        !activeEngine ||
                        performance.now() < movementInputLockedUntilRef.current
                    ) {
                        return;
                    }

                    syncMovementState(activeEngine);
                },
                Math.max(0, durationMs),
            );
        },
        [
            clearEngineMovementState,
            engineRef,
            movementInputLockedUntilRef,
            movementInputResumeTimeoutRef,
            syncMovementState,
        ],
    );

    const canProcessMovementInput = useCallback(() => {
        return (
            !isMapChangeTransitionRef.current &&
            performance.now() >= movementInputLockedUntilRef.current
        );
    }, [isMapChangeTransitionRef, movementInputLockedUntilRef]);

    const clearPendingLocalMoves = useCallback(() => {
        localPendingMovesRef.current = [];
    }, [localPendingMovesRef]);

    const retainPendingRemoteSnapshotsForMap = useCallback(
        (targetMap: number) => {
            for (const [
                entityId,
                snapshot,
            ] of pendingRemoteSnapshotsRef.current) {
                if (snapshot.map !== targetMap) {
                    pendingRemoteSnapshotsRef.current.delete(entityId);
                }
            }
        },
        [pendingRemoteSnapshotsRef],
    );

    const resetMovementSyncState = useCallback(() => {
        localPendingMovesRef.current = [];
        nextMoveIdRef.current = 1;
        latestServerStateVersionRef.current = 0;
        movementInputLockedUntilRef.current = 0;
        isMapChangeTransitionRef.current = false;

        if (movementInputResumeTimeoutRef.current !== null) {
            window.clearTimeout(movementInputResumeTimeoutRef.current);
            movementInputResumeTimeoutRef.current = null;
        }
    }, [
        isMapChangeTransitionRef,
        latestServerStateVersionRef,
        localPendingMovesRef,
        movementInputLockedUntilRef,
        movementInputResumeTimeoutRef,
        nextMoveIdRef,
    ]);

    const consumeAcknowledgedLocalMoves = useCallback(
        (lastProcessedMoveId: number) => {
            if (lastProcessedMoveId <= 0) {
                return;
            }

            localPendingMovesRef.current = localPendingMovesRef.current.filter(
                (move) => move.moveId > lastProcessedMoveId,
            );
        },
        [localPendingMovesRef],
    );

    const computePredictedPositionFromPendingMoves = useCallback(
        (
            engine: Engine,
            map: number,
            origin: { x: number; y: number },
        ): { map: number; x: number; y: number } => {
            let currentX = origin.x;
            let currentY = origin.y;

            if (map !== engine.mapNumber) {
                return { map, x: currentX, y: currentY };
            }

            if (engine.user?.tInmo || engine.user?.tParalizado) {
                return { map, x: currentX, y: currentY };
            }

            for (const move of localPendingMovesRef.current) {
                let nextX = currentX;
                let nextY = currentY;

                if (move.heading === engine.DIRECTIONS.RIGHT) {
                    nextX += 1;
                } else if (move.heading === engine.DIRECTIONS.LEFT) {
                    nextX -= 1;
                } else if (move.heading === engine.DIRECTIONS.DOWN) {
                    nextY += 1;
                } else if (move.heading === engine.DIRECTIONS.UP) {
                    nextY -= 1;
                }

                if (engine.legalPos(nextX, nextY, move.heading)) {
                    currentX = nextX;
                    currentY = nextY;
                }
            }

            return { map, x: currentX, y: currentY };
        },
        [localPendingMovesRef],
    );

    const reconcileOwnPositionWithServer = useCallback(
        async (
            engine: Engine,
            payload: {
                map: number;
                x: number;
                y: number;
                heading: number;
                lastProcessedMoveId: number;
                stateVersion: number;
            },
        ) => {
            const currentUser = engine.user;

            if (!currentUser) {
                return;
            }

            if (payload.stateVersion < latestServerStateVersionRef.current) {
                return;
            }

            latestServerStateVersionRef.current = payload.stateVersion;
            consumeAcknowledgedLocalMoves(payload.lastProcessedMoveId);
            lastServerConfirmedSelfPositionRef.current = {
                map: payload.map,
                x: payload.x,
                y: payload.y,
            };

            const isMovementRestricted = Boolean(
                currentUser.tInmo || currentUser.tParalizado,
            );
            const predictedTarget = isMovementRestricted
                ? { map: payload.map, x: payload.x, y: payload.y }
                : computePredictedPositionFromPendingMoves(
                      engine,
                      payload.map,
                      {
                          x: payload.x,
                          y: payload.y,
                      },
                  );
            const targetHeading = isMovementRestricted
                ? payload.heading
                : (localPendingMovesRef.current.at(-1)?.heading ??
                  payload.heading);

            pendingUserSnapshotRef.current = pendingUserSnapshotRef.current
                ? {
                      ...pendingUserSnapshotRef.current,
                      map: predictedTarget.map,
                      pos: { x: predictedTarget.x, y: predictedTarget.y },
                      heading: targetHeading,
                      stateVersion: payload.stateVersion,
                  }
                : null;

            if (predictedTarget.map !== engine.mapNumber) {
                clearPendingLocalMoves();
                lockMovementInput(engine);
                mergeHud({
                    map: predictedTarget.map,
                    pos: { x: predictedTarget.x, y: predictedTarget.y },
                });
                startMapChangeTransition(
                    predictedTarget.map,
                    engine,
                    `Cambiando al mapa ${predictedTarget.map}...`,
                );
                return;
            }

            const currentMap = currentUser.map;
            const currentX = currentUser.pos.x;
            const currentY = currentUser.pos.y;
            const deltaX = predictedTarget.x - currentX;
            const deltaY = predictedTarget.y - currentY;
            const manhattanDistance = Math.abs(deltaX) + Math.abs(deltaY);

            currentUser.heading = targetHeading;
            currentUser.stateVersion = payload.stateVersion;

            if (
                currentMap === predictedTarget.map &&
                currentX === predictedTarget.x &&
                currentY === predictedTarget.y
            ) {
                mergeHud({
                    map: predictedTarget.map,
                    pos: { x: predictedTarget.x, y: predictedTarget.y },
                });
                return;
            }

            currentUser.map = predictedTarget.map;

            if (currentMap === predictedTarget.map && manhattanDistance === 1) {
                engine.resetMovement(currentUser, {
                    preserveAnimationFrame: true,
                });
                engine.offsetCounterX = 0;
                engine.offsetCounterY = 0;
                engine.moveCharByPos(
                    currentUser.id,
                    predictedTarget.x,
                    predictedTarget.y,
                    {
                        heading: targetHeading,
                        durationMs: runtimeTimingRef.current.walkStepMs,
                    },
                );
                currentUser.heading = targetHeading;
            } else {
                engine.snapCharacter(
                    currentUser.id,
                    predictedTarget.x,
                    predictedTarget.y,
                    targetHeading,
                );
            }

            mergeHud({
                map: predictedTarget.map,
                pos: { x: predictedTarget.x, y: predictedTarget.y },
            });
        },
        [
            clearPendingLocalMoves,
            computePredictedPositionFromPendingMoves,
            consumeAcknowledgedLocalMoves,
            lastServerConfirmedSelfPositionRef,
            latestServerStateVersionRef,
            localPendingMovesRef,
            lockMovementInput,
            mergeHud,
            pendingUserSnapshotRef,
            runtimeTimingRef,
            startMapChangeTransition,
        ],
    );

    return {
        canProcessMovementInput,
        clearEngineMovementState,
        clearMovementInputState,
        clearPendingLocalMoves,
        computePredictedPositionFromPendingMoves,
        consumeAcknowledgedLocalMoves,
        lockMovementInput,
        reconcileOwnPositionWithServer,
        resetMovementSyncState,
        retainPendingRemoteSnapshotsForMap,
        syncMovementState,
    };
}
