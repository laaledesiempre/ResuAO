import { OBJECT_TYPE, toPlayerHudState } from "../../../lib/aowProtocol";
import { syncCharacterCrowdControlState } from "../engine/Engine";
import type { IncomingPacketHandlerArgs } from "./incomingPacketTypes";

export async function handleIncomingCharacterPacket({
    packet,
    engine,
    renderedMapNumber,
    ctx,
}: IncomingPacketHandlerArgs): Promise<boolean> {
    const handleAreaRemoteSnapshots = async (
        snapshots: Array<any>,
    ): Promise<boolean> => {
        const renderableSnapshots: any[] = [];
        let shouldFlushBufferedRemotes = false;

        for (const snapshot of snapshots) {
            if (snapshot.tt === 1) {
                if (engine) {
                    ctx.syncTtEntity(engine, snapshot);
                }
                continue;
            }

            if (
                ctx.canRenderRemoteEntities(engine) &&
                snapshot.map === engine.mapNumber &&
                snapshot.id !== engine.user?.id
            ) {
                ctx.pendingRemoteSnapshotsRef.current.delete(snapshot.id);
                renderableSnapshots.push(snapshot);
                continue;
            }

            ctx.pendingRemoteSnapshotsRef.current.set(snapshot.id, snapshot);
            shouldFlushBufferedRemotes = true;
        }

        if (engine && renderableSnapshots.length > 0) {
            await ctx.syncRemoteEntitiesBatch(engine, renderableSnapshots, {
                preloadBodies: true,
            });
        }

        if (engine && shouldFlushBufferedRemotes) {
            await ctx.flushBufferedRemoteEntities(engine);
        }

        return true;
    };

    switch (packet.type) {
        case "getMyCharacter": {
            if (
                (packet.payload.stateVersion ?? 0) <
                ctx.latestServerStateVersionRef.current
            ) {
                return true;
            }

            ctx.pendingUserSnapshotRef.current = packet.payload;
            ctx.lastServerConfirmedSelfPositionRef.current = {
                map: packet.payload.map,
                x: packet.payload.pos.x,
                y: packet.payload.pos.y,
            };
            ctx.latestServerStateVersionRef.current = Math.max(
                ctx.latestServerStateVersionRef.current,
                packet.payload.stateVersion ?? 0,
            );
            ctx.emitHud({
                ...toPlayerHudState(packet.payload),
                partyMembers: ctx.pendingPartyMembersRef.current,
                clanMembers: ctx.pendingClanMembersRef.current,
            });

            if (packet.payload.map !== renderedMapNumber) {
                ctx.retainPendingRemoteSnapshotsForMap(packet.payload.map);
                ctx.startMapChangeTransition(
                    packet.payload.map,
                    engine,
                    `Cambiando al mapa ${packet.payload.map}...`,
                );
            }

            if (engine && packet.payload.map === engine.mapNumber) {
                await ctx.applyOwnCharacterSnapshot(engine, packet.payload);
            }

            const connectionAnnouncement = ctx.hasAnnouncedConnectionRef.current
                ? undefined
                : `Conectado como ${packet.payload.nameCharacter}`;
            ctx.hasAnnouncedConnectionRef.current = true;

            ctx.emitStatus({
                connected: true,
                connecting: false,
                worldName: engine?.worldName,
                consoleLine: connectionAnnouncement,
            });
            if (connectionAnnouncement) {
                ctx.onConsoleMessage?.({
                    text: connectionAnnouncement,
                    color: "#fcd34d",
                    source: "system",
                });
            }
            return true;
        }

        case "changeRopa":
            await ctx.applyEquipmentVisualChange(packet.payload.id, {
                idBody: packet.payload.body,
            });
            if (engine?.user?.id === packet.payload.id) {
                ctx.updateEquippedInventoryByType(
                    OBJECT_TYPE.armaduras,
                    packet.payload.slot > 0 ? packet.payload.slot : null,
                );
            }
            return true;

        case "putBodyAndHeadDead":
            if (ctx.pendingUserSnapshotRef.current?.id === packet.payload.id) {
                ctx.pendingUserSnapshotRef.current = {
                    ...ctx.pendingUserSnapshotRef.current,
                    dead: true,
                };
            }
            if (ctx.pendingRemoteSnapshotsRef.current.has(packet.payload.id)) {
                ctx.pendingRemoteSnapshotsRef.current.set(packet.payload.id, {
                    ...ctx.pendingRemoteSnapshotsRef.current.get(
                        packet.payload.id,
                    )!,
                    dead: true,
                });
            }
            if (engine?.personajes[packet.payload.id]) {
                engine.personajes[packet.payload.id].dead = true;
            }
            engine?.clearHealthBarEntity(packet.payload.id);
            await ctx.applyCharacterAppearanceChange(packet.payload.id, {
                idHead: packet.payload.head,
                idHelmet: packet.payload.helmet,
                idWeapon: packet.payload.weapon,
                idShield: packet.payload.shield,
                idBody: packet.payload.body,
            });
            if (engine?.user?.id === packet.payload.id) {
                ctx.mergeHud({
                    dead: true,
                    deadWorldActive: false,
                    invisibleSpell: false,
                    buffAgilidadSeconds: 0,
                    buffFuerzaSeconds: 0,
                    buffAgilidadUpdatedAt: Date.now(),
                    buffFuerzaUpdatedAt: Date.now(),
                });
                ctx.clearEquippedInventory();
            }
            return true;

        case "revivirUsuario":
            if (ctx.pendingUserSnapshotRef.current?.id === packet.payload.id) {
                ctx.pendingUserSnapshotRef.current = {
                    ...ctx.pendingUserSnapshotRef.current,
                    dead: false,
                };
            }
            if (ctx.pendingRemoteSnapshotsRef.current.has(packet.payload.id)) {
                ctx.pendingRemoteSnapshotsRef.current.set(packet.payload.id, {
                    ...ctx.pendingRemoteSnapshotsRef.current.get(
                        packet.payload.id,
                    )!,
                    dead: false,
                });
            }
            if (engine?.personajes[packet.payload.id]) {
                engine.personajes[packet.payload.id].dead = false;
            }
            await ctx.applyCharacterAppearanceChange(packet.payload.id, {
                idHead: packet.payload.head,
                idBody: packet.payload.body,
                idHelmet: 0,
                idWeapon: 0,
                idShield: 0,
            });
            if (engine?.user?.id === packet.payload.id) {
                ctx.mergeHud({ dead: false, deadWorldActive: false });
            }
            return true;

        case "startCastBar":
            ctx.activeCastBarsRef.current.set(packet.payload.id, {
                startedAt: performance.now(),
                durationMs: packet.payload.durationMs,
            });
            if (engine) {
                ctx.syncCastBar(engine, packet.payload.id);
            }
            return true;

        case "stopCastBar":
            ctx.activeCastBarsRef.current.delete(packet.payload.id);
            if (engine) {
                ctx.removeCastBarFromOverlay(engine, packet.payload.id);
            }
            return true;

        case "getCharacter":
        case "getNpc":
            if (packet.payload.tt === 1) {
                if (engine) {
                    ctx.syncTtEntity(engine, packet.payload);
                }
                return true;
            }
            if (
                ctx.canRenderRemoteEntities(engine) &&
                packet.payload.map === engine.mapNumber &&
                packet.payload.id !== engine.user?.id
            ) {
                ctx.pendingRemoteSnapshotsRef.current.delete(packet.payload.id);
                await ctx.syncRemoteEntity(engine, packet.payload);
            } else {
                ctx.pendingRemoteSnapshotsRef.current.set(
                    packet.payload.id,
                    packet.payload,
                );
                if (engine) {
                    await ctx.flushBufferedRemoteEntities(engine);
                }
            }
            return true;

        case "areaCharactersSnapshot":
            return handleAreaRemoteSnapshots(packet.payload);

        case "areaNpcsSnapshot":
            return handleAreaRemoteSnapshots(packet.payload);

        case "selfFlagsDelta":
            if (ctx.pendingUserSnapshotRef.current) {
                ctx.pendingUserSnapshotRef.current = {
                    ...ctx.pendingUserSnapshotRef.current,
                    zonaSegura: packet.payload.zonaSegura,
                    seguroActivado: packet.payload.seguroActivado,
                    seguroClanActivado: packet.payload.seguroClanActivado,
                };
            }

            if (engine?.user) {
                engine.user.zonaSegura = packet.payload.zonaSegura;
                engine.user.seguroActivado = packet.payload.seguroActivado;
                engine.user.seguroClanActivado =
                    packet.payload.seguroClanActivado;
            }

            ctx.mergeHud({
                zonaSegura: packet.payload.zonaSegura,
                seguroActivado: packet.payload.seguroActivado,
                seguroClanActivado: packet.payload.seguroClanActivado,
            });
            return true;

        case "selfVitalsDelta":
            if (ctx.pendingUserSnapshotRef.current) {
                ctx.pendingUserSnapshotRef.current = {
                    ...ctx.pendingUserSnapshotRef.current,
                    hp: packet.payload.hp,
                    tHp: packet.payload.hp,
                    maxHp: packet.payload.maxHp,
                    mana: packet.payload.mana,
                    tMana: packet.payload.mana,
                    maxMana: packet.payload.maxMana,
                };
            }

            if (engine?.user) {
                engine.user.hp = packet.payload.hp;
                engine.user.tHp = packet.payload.hp;
                engine.user.maxHp = packet.payload.maxHp;
                engine.user.mana = packet.payload.mana;
                engine.user.tMana = packet.payload.mana;
                engine.user.maxMana = packet.payload.maxMana;
            }

            ctx.recordResourceValue(
                "hp",
                packet.payload.hp,
                packet.payload.maxHp,
            );
            ctx.recordResourceValue(
                "mana",
                packet.payload.mana,
                packet.payload.maxMana,
            );
            ctx.mergeHud({
                hp: packet.payload.hp,
                maxHp: packet.payload.maxHp,
                mana: packet.payload.mana,
                maxMana: packet.payload.maxMana,
            });
            return true;

        case "entityVitalsDelta":
            if (engine) {
                const entity = engine.personajes[packet.payload.id];

                if (entity) {
                    entity.hp = packet.payload.hp;
                    entity.tHp = packet.payload.hp;
                    entity.maxHp = packet.payload.maxHp;
                    entity.mana = packet.payload.mana;
                    entity.tMana = packet.payload.mana;
                    entity.maxMana = packet.payload.maxMana;

                    if (
                        engine.healthBarEntityIds.has(packet.payload.id) ||
                        entity.adminSummonedBot
                    ) {
                        engine.requestCharacterRerender?.(packet.payload.id);
                    }
                } else {
                    const bufferedSnapshot =
                        ctx.pendingRemoteSnapshotsRef.current.get(
                            packet.payload.id,
                        );

                    if (bufferedSnapshot) {
                        ctx.pendingRemoteSnapshotsRef.current.set(
                            packet.payload.id,
                            {
                                ...bufferedSnapshot,
                                hp: packet.payload.hp,
                                tHp: packet.payload.hp,
                                maxHp: packet.payload.maxHp,
                                mana: packet.payload.mana,
                                tMana: packet.payload.mana,
                                maxMana: packet.payload.maxMana,
                            },
                        );
                    }
                }
            }
            return true;

        case "actPosition":
            if (engine) {
                const entity = engine.personajes[packet.payload.id];
                if (entity) {
                    if (packet.payload.id !== engine.user?.id) {
                        const previousHeading = entity.heading;
                        engine.moveCharByPos(
                            packet.payload.id,
                            packet.payload.x,
                            packet.payload.y,
                            {
                                heading: previousHeading,
                                durationMs:
                                    ctx.runtimeTimingRef.current.walkStepMs,
                            },
                        );
                        const remoteContainer = engine.remoteEntities.get(
                            packet.payload.id,
                        );

                        if (
                            !remoteContainer ||
                            entity.heading !== previousHeading
                        ) {
                            await ctx.syncRemoteEntity(engine, entity);
                        }

                        ctx.playStepSound(engine, packet.payload.id);
                    } else {
                        engine.snapCharacter(
                            packet.payload.id,
                            packet.payload.x,
                            packet.payload.y,
                            undefined,
                            {
                                preserveAnimationFrame:
                                    engine.hasQueuedMovementInput(),
                            },
                        );
                        ctx.mergeHud({
                            pos: { x: packet.payload.x, y: packet.payload.y },
                        });
                    }
                } else {
                    const bufferedSnapshot =
                        ctx.pendingRemoteSnapshotsRef.current.get(
                            packet.payload.id,
                        );

                    if (bufferedSnapshot) {
                        ctx.pendingRemoteSnapshotsRef.current.set(
                            packet.payload.id,
                            {
                                ...bufferedSnapshot,
                                pos: {
                                    x: packet.payload.x,
                                    y: packet.payload.y,
                                },
                            },
                        );
                        await ctx.flushBufferedRemoteEntities(engine);
                    }
                }
            }
            return true;

        case "moveEntity":
            if (engine) {
                const entity = engine.personajes[packet.payload.id];

                if (entity) {
                    if (packet.payload.id !== engine.user?.id) {
                        const previousHeading = entity.heading;
                        entity.pendingHeading = undefined;
                        entity.heading = packet.payload.heading;
                        engine.moveCharByPos(
                            packet.payload.id,
                            packet.payload.x,
                            packet.payload.y,
                            {
                                heading: packet.payload.heading,
                                durationMs:
                                    ctx.runtimeTimingRef.current.walkStepMs,
                            },
                        );

                        if (
                            !engine.remoteEntities.get(packet.payload.id) ||
                            previousHeading !== packet.payload.heading
                        ) {
                            await ctx.syncRemoteEntity(engine, entity);
                        }

                        ctx.playStepSound(engine, packet.payload.id);
                    } else {
                        engine.snapCharacter(
                            packet.payload.id,
                            packet.payload.x,
                            packet.payload.y,
                            packet.payload.heading,
                            {
                                preserveAnimationFrame:
                                    engine.hasQueuedMovementInput(),
                            },
                        );
                        ctx.mergeHud({
                            pos: { x: packet.payload.x, y: packet.payload.y },
                        });
                    }
                } else {
                    const bufferedSnapshot =
                        ctx.pendingRemoteSnapshotsRef.current.get(
                            packet.payload.id,
                        );

                    if (bufferedSnapshot) {
                        ctx.pendingRemoteSnapshotsRef.current.set(
                            packet.payload.id,
                            {
                                ...bufferedSnapshot,
                                heading: packet.payload.heading,
                                pos: {
                                    x: packet.payload.x,
                                    y: packet.payload.y,
                                },
                            },
                        );
                        await ctx.flushBufferedRemoteEntities(engine);
                    }
                }
            }
            return true;

        case "actPositionServer":
            if (engine?.user) {
                await ctx.reconcileOwnPositionWithServer(
                    engine,
                    packet.payload,
                );
            }
            return true;

        case "changeHeading":
            if (engine) {
                const entity = engine.personajes[packet.payload.id];
                if (entity) {
                    if (
                        packet.payload.id !== engine.user?.id &&
                        entity.moving
                    ) {
                        entity.pendingHeading = packet.payload.heading;
                        return true;
                    }

                    entity.pendingHeading = undefined;
                    entity.heading = packet.payload.heading;
                    if (packet.payload.id === engine.user?.id) {
                        await ctx.applyOwnCharacterSnapshot(engine, {
                            ...ctx.pendingUserSnapshotRef.current,
                            heading: packet.payload.heading,
                        });
                    } else {
                        await ctx.syncRemoteEntity(engine, entity);
                    }
                } else {
                    const bufferedSnapshot =
                        ctx.pendingRemoteSnapshotsRef.current.get(
                            packet.payload.id,
                        );

                    if (bufferedSnapshot) {
                        ctx.pendingRemoteSnapshotsRef.current.set(
                            packet.payload.id,
                            {
                                ...bufferedSnapshot,
                                heading: packet.payload.heading,
                            },
                        );
                    }
                }
            }
            return true;

        case "deleteCharacter":
            ctx.pendingRemoteSnapshotsRef.current.delete(packet.payload.id);
            if (engine) {
                engine.clearHealthBarEntity(packet.payload.id);
                ctx.removeRemoteEntity(engine, packet.payload.id);
            }
            return true;

        case "telepMe": {
            if (
                packet.payload.stateVersion <
                ctx.latestServerStateVersionRef.current
            ) {
                return true;
            }

            ctx.latestServerStateVersionRef.current = Math.max(
                ctx.latestServerStateVersionRef.current,
                packet.payload.stateVersion,
            );
            ctx.consumeAcknowledgedLocalMoves(
                packet.payload.lastProcessedMoveId,
            );
            ctx.clearPendingLocalMoves();
            ctx.retainPendingRemoteSnapshotsForMap(packet.payload.map);
            if (ctx.pendingUserSnapshotRef.current) {
                ctx.pendingUserSnapshotRef.current = {
                    ...ctx.pendingUserSnapshotRef.current,
                    map: packet.payload.map,
                    pos: { x: packet.payload.x, y: packet.payload.y },
                    heading: packet.payload.heading,
                    stateVersion: packet.payload.stateVersion,
                };
            }

            ctx.mergeHud({
                map: packet.payload.map,
                pos: { x: packet.payload.x, y: packet.payload.y },
            });

            const movementLockDurationMs = Math.max(
                60,
                Math.ceil(Math.max(0, packet.payload.movementLockMs)),
            );

            if (engine) {
                ctx.lockMovementInput(engine, movementLockDurationMs);
                if (engine.user) {
                    engine.user.stateVersion = packet.payload.stateVersion;
                }
                engine.removeAllRemoteEntities();
            }

            ctx.lastServerConfirmedSelfPositionRef.current = {
                map: packet.payload.map,
                x: packet.payload.x,
                y: packet.payload.y,
            };

            if (packet.payload.map !== renderedMapNumber) {
                ctx.startMapChangeTransition(
                    packet.payload.map,
                    engine,
                    `Cambiando al mapa ${packet.payload.map}...`,
                );
            } else if (engine?.user) {
                engine.snapCharacter(
                    engine.user.id,
                    packet.payload.x,
                    packet.payload.y,
                    packet.payload.heading,
                );
                await ctx.applyOwnCharacterSnapshot(engine, {
                    ...ctx.pendingUserSnapshotRef.current,
                    ...packet.payload,
                    pos: { x: packet.payload.x, y: packet.payload.y },
                });
            }
            return true;
        }

        case "inmo":
        case "tInmo": {
            const movementRestriction =
                packet.type === "inmo"
                    ? packet.payload.inmovilizado
                    : packet.payload.tInmo;
            const inmovilizado =
                ctx.isCharacterInmovilizado(movementRestriction);
            const paralizado = ctx.isCharacterParalizado(movementRestriction);
            const remainingMs = packet.payload.remainingMs;

            if (ctx.pendingUserSnapshotRef.current) {
                ctx.pendingUserSnapshotRef.current = {
                    ...ctx.pendingUserSnapshotRef.current,
                    inmovilizado: movementRestriction,
                    tInmo: movementRestriction,
                    crowdControlRemainingMs: remainingMs,
                    pos: { x: packet.payload.x, y: packet.payload.y },
                };
            }

            if (engine?.user) {
                ctx.clearPendingLocalMoves();
                engine.resetMovement(engine.user);
                engine.offsetCounterX = 0;
                engine.offsetCounterY = 0;
                syncCharacterCrowdControlState(
                    engine.user,
                    movementRestriction,
                    engine.runtimeTiming,
                    Date.now(),
                    remainingMs,
                );
                engine.requestCharacterRerender?.(engine.user.id);
                engine.snapCharacter(
                    engine.user.id,
                    packet.payload.x,
                    packet.payload.y,
                );

            }

            ctx.mergeHud({
                pos: { x: packet.payload.x, y: packet.payload.y },
                inmovilizado,
                paralizado,
            });
            return true;
        }

        case "updateHP":
            if (engine?.user) {
                engine.user.hp = packet.payload.hp;
            }
            return true;

        case "tUpdateHP":
            if (engine?.user) {
                engine.user.tHp = packet.payload.tHp;
            }
            ctx.recordResourceValue("hp", packet.payload.tHp);
            ctx.mergeHud({ hp: packet.payload.tHp });
            return true;

        case "updateMaxHP":
            if (engine?.user) {
                engine.user.hp = packet.payload.hp;
                engine.user.tHp = packet.payload.tHp;
                engine.user.maxHp = packet.payload.maxHp;
            }
            ctx.recordResourceValue(
                "hp",
                packet.payload.tHp,
                packet.payload.maxHp,
            );
            ctx.mergeHud({
                hp: packet.payload.tHp,
                maxHp: packet.payload.maxHp,
            });
            return true;

        case "updateMana":
            if (engine?.user) {
                engine.user.mana = packet.payload.mana;
            }
            return true;

        case "tUpdateMana":
            if (engine?.user) {
                engine.user.tMana = packet.payload.tMana;
            }
            ctx.recordResourceValue("mana", packet.payload.tMana);
            ctx.mergeHud({ mana: packet.payload.tMana });
            return true;

        case "actExp":
            ctx.mergeHud({ exp: packet.payload.exp });
            return true;

        case "actMyLevel":
            if (engine?.user) {
                engine.user.hp = packet.payload.hp;
                engine.user.tHp = packet.payload.tHp;
                engine.user.maxHp = packet.payload.maxHp;
                engine.user.mana = packet.payload.mana;
                engine.user.tMana = packet.payload.tMana;
            }
            ctx.recordResourceValue(
                "hp",
                packet.payload.tHp,
                packet.payload.maxHp,
            );
            ctx.recordResourceValue(
                "mana",
                packet.payload.tMana,
                packet.payload.maxMana,
            );
            ctx.mergeHud({
                exp: packet.payload.exp,
                expNextLevel: packet.payload.expNextLevel,
                level: packet.payload.level,
                hp: packet.payload.tHp,
                maxHp: packet.payload.maxHp,
                mana: packet.payload.tMana,
                maxMana: packet.payload.maxMana,
            });
            return true;

        case "actGold":
            ctx.mergeHud({ gold: packet.payload.gold });
            return true;

        case "actColorName":
            await ctx.applyCharacterColorChange(
                packet.payload.id,
                packet.payload.color,
            );
            return true;

        case "changeHelmet":
            await ctx.applyEquipmentVisualChange(packet.payload.id, {
                idHelmet: packet.payload.helmet,
            });
            if (engine?.user?.id === packet.payload.id) {
                ctx.updateEquippedInventoryByType(
                    OBJECT_TYPE.cascos,
                    packet.payload.helmet > 0 ? packet.payload.slot : null,
                );
            }
            return true;

        case "changeWeapon":
            await ctx.applyEquipmentVisualChange(packet.payload.id, {
                idWeapon: packet.payload.weapon,
            });
            if (engine?.user?.id === packet.payload.id) {
                ctx.updateEquippedInventoryByType(
                    OBJECT_TYPE.armas,
                    packet.payload.weapon > 0 ? packet.payload.slot : null,
                );
            }
            return true;

        case "changeBody":
            await ctx.applyCharacterAppearanceChange(packet.payload.id, {
                idHead: packet.payload.head,
                idBody: packet.payload.body,
                idHelmet: packet.payload.helmet,
                idWeapon: packet.payload.weapon,
                idShield: packet.payload.shield,
            });
            return true;

        case "changeShield":
            await ctx.applyEquipmentVisualChange(packet.payload.id, {
                idShield: packet.payload.shield,
            });
            if (engine?.user?.id === packet.payload.id) {
                ctx.updateEquippedInventoryByType(
                    OBJECT_TYPE.escudos,
                    packet.payload.shield > 0 ? packet.payload.slot : null,
                );
            }
            return true;

        case "changeArrow":
            if (engine?.user?.id === packet.payload.id) {
                ctx.updateEquippedInventoryByType(
                    OBJECT_TYPE.flechas,
                    packet.payload.slot > 0 ? packet.payload.slot : null,
                );
            }
            return true;

        case "aprenderSpell":
            ctx.upsertSpell(packet.payload);
            return true;

        case "updateAgilidad":
            ctx.mergeHud({
                attrAgilidad: packet.payload.agilidad,
                buffAgilidadSeconds: packet.payload.buffSecondsRemaining,
                buffAgilidadUpdatedAt: Date.now(),
            });
            return true;

        case "updateFuerza":
            ctx.mergeHud({
                attrFuerza: packet.payload.fuerza,
                buffFuerzaSeconds: packet.payload.buffSecondsRemaining,
                buffFuerzaUpdatedAt: Date.now(),
            });
            return true;

        case "partyState":
        case "clanState":
        case "navegando":
            return false;

        default:
            return false;
    }
}
