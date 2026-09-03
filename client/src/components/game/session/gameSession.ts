// Vanilla port of frontend/components/game/session/useGameSession.ts
// The single connection effect becomes startGameSession() returning a
// dispose function. Ref objects ({current}) are used exactly as before.
import {
    CLIENT_PACKET_ID,
    createConnectCharacterPacket,
    createPingPacket,
    normalizeSocketMessageData,
    parseServerPacket,
} from "../../../lib/aowProtocol";
import { setTextIfChanged } from "../rendering/textStyles";
import { getSmoothedPingDisplay } from "../network/ping";
import { parseQueuedSocketMessage } from "../network/packetQueue";
import type { RefObject } from "../vanilla";

export type GameConnectionConfig = {
    wsUrl: string;
    ticket: string;
    typeGame?: number;
    idChar?: number;
    sessionKey: string;
};

export type GameSessionOptions = {
    connection: GameConnectionConfig;
    isClientReadyForConnection: () => boolean;
    activeSocketInstanceRef: RefObject<number>;
    websocketRef: RefObject<WebSocket | null>;
    activeSessionKeyRef: RefObject<string | null>;
    pingIntervalRef: RefObject<number | null>;
    pendingPingRef: RefObject<{ token: number; sentAt: number } | null>;
    recentPingSamplesRef: RefObject<number[]>;
    nextPingTokenRef: RefObject<number>;
    pingTextRef: RefObject<any>;
    pingDisplayTextRef: RefObject<string>;
    fpsDisplayTextRef: RefObject<string>;
    onPingSample?: (pingMs: number | null) => void;
    clearUseItemQueues: () => void;
    clearTargetingMode: () => void;
    resetMovementSyncState: () => void;
    lastServerConfirmedSelfPositionRef: RefObject<any>;
    clearMovementInputState: (engine?: any) => void;
    clearTtEntities: (engine?: any) => void;
    incomingPacketQueueRef: RefObject<
        Array<Blob | ArrayBuffer | ArrayBufferView>
    >;
    isProcessingIncomingPacketsRef: RefObject<boolean>;
    lastSentChatTokenRef: RefObject<number | null>;
    pendingUserSnapshotRef: RefObject<any>;
    pendingRemoteSnapshotsRef: RefObject<Map<number, any>>;
    setIsSceneReady: (value: boolean) => void;
    emitHud: (value: any) => void;
    emitStatus: (value: any) => void;
    flushPendingChatRequest: () => void;
    currentMapRef: RefObject<number>;
    engineRef: RefObject<any>;
    latestStatusRef: RefObject<any>;
    clearAllDialogMessages: () => void;
    clearAllCastBars: () => void;
    panelSnapshotChunkBufferRef: RefObject<string>;
    panelSnapshotChunkExpectedIndexRef: RefObject<number>;
    panelSnapshotChunkTotalRef: RefObject<number>;
    characterStatsChunkBufferRef: RefObject<string>;
    characterStatsChunkExpectedIndexRef: RefObject<number>;
    characterStatsChunkTotalRef: RefObject<number>;
    onPacket: (args: {
        packet: any;
        engine: any;
        renderedMapNumber: number;
        disconnectSocket: () => void;
    }) => Promise<void>;
};

export function startGameSession(options: GameSessionOptions): () => void {
    const {
        connection,
        activeSocketInstanceRef,
        websocketRef,
        activeSessionKeyRef,
        pingIntervalRef,
        pendingPingRef,
        recentPingSamplesRef,
        nextPingTokenRef,
        pingTextRef,
        pingDisplayTextRef,
        fpsDisplayTextRef,
        lastServerConfirmedSelfPositionRef,
        incomingPacketQueueRef,
        isProcessingIncomingPacketsRef,
        lastSentChatTokenRef,
        pendingUserSnapshotRef,
        pendingRemoteSnapshotsRef,
        currentMapRef,
        engineRef,
        latestStatusRef,
        panelSnapshotChunkBufferRef,
        panelSnapshotChunkExpectedIndexRef,
        panelSnapshotChunkTotalRef,
        characterStatsChunkBufferRef,
        characterStatsChunkExpectedIndexRef,
        characterStatsChunkTotalRef,
    } = options;

    const socketInstanceId = activeSocketInstanceRef.current + 1;
    activeSocketInstanceRef.current = socketInstanceId;

    const isCurrentSocketInstance = (socket?: WebSocket | null) =>
        Boolean(
            socket &&
            websocketRef.current === socket &&
            activeSocketInstanceRef.current === socketInstanceId,
        );

    const clearPing = () => {
        if (pingIntervalRef.current) {
            window.clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
        }

        pendingPingRef.current = null;
        recentPingSamplesRef.current = [];
        pingDisplayTextRef.current = "Ping: -- ms";
        options.onPingSample?.(null);

        if (pingTextRef.current) {
            setTextIfChanged(pingTextRef.current, pingDisplayTextRef.current);
        }
    };

    const updatePingDisplay = (sampleMs: number) => {
        const nextPing = getSmoothedPingDisplay(
            recentPingSamplesRef.current,
            sampleMs,
        );
        recentPingSamplesRef.current = nextPing.samples;
        pingDisplayTextRef.current = nextPing.text;
        options.onPingSample?.(sampleMs);

        if (pingTextRef.current) {
            setTextIfChanged(pingTextRef.current, pingDisplayTextRef.current);
        }
    };

    const disconnectSocket = () => {
        clearPing();
        fpsDisplayTextRef.current = "FPS: 0";
        options.clearUseItemQueues();
        options.clearTargetingMode();
        options.resetMovementSyncState();
        lastServerConfirmedSelfPositionRef.current = null;
        options.clearMovementInputState(engineRef.current);
        options.clearTtEntities(engineRef.current);
        incomingPacketQueueRef.current = [];
        isProcessingIncomingPacketsRef.current = false;
        lastSentChatTokenRef.current = null;
        const socket = websocketRef.current;
        websocketRef.current = null;
        if (socket) {
            socket.close();
        }
    };

    if (!options.isClientReadyForConnection()) {
        // The caller starts the session only when the scene is ready, so this
        // is a defensive no-op path.
        disconnectSocket();
        return () => undefined;
    }

    disconnectSocket();
    activeSessionKeyRef.current = connection.sessionKey;

    const socket = new WebSocket(connection.wsUrl);
    socket.binaryType = "arraybuffer";
    websocketRef.current = socket;

    options.emitStatus({ connected: false, connecting: true });

    socket.onopen = () => {
        if (
            activeSessionKeyRef.current !== connection.sessionKey ||
            !isCurrentSocketInstance(socket)
        ) {
            socket.close();
            return;
        }

        const sendPing = () => {
            if (socket.readyState !== WebSocket.OPEN) {
                return;
            }

            const token = nextPingTokenRef.current++;
            pendingPingRef.current = {
                token,
                sentAt: performance.now(),
            };
            socket.send(createPingPacket(token));
        };

        socket.send(
            createConnectCharacterPacket({
                ticket: connection.ticket,
                typeGame: connection.typeGame,
                idChar: connection.idChar,
            }),
        );

        options.flushPendingChatRequest();
        sendPing();
        pingIntervalRef.current = window.setInterval(sendPing, 10000);
    };

    const processIncomingPacketQueue = async () => {
        if (isProcessingIncomingPacketsRef.current) {
            return;
        }

        isProcessingIncomingPacketsRef.current = true;

        try {
            while (incomingPacketQueueRef.current.length > 0) {
                if (activeSessionKeyRef.current !== connection.sessionKey) {
                    incomingPacketQueueRef.current = [];
                    return;
                }

                const queuedMessage = incomingPacketQueueRef.current.shift();
                if (!queuedMessage) {
                    continue;
                }

                try {
                    const { packets } =
                        await parseQueuedSocketMessage(queuedMessage);

                    if (activeSessionKeyRef.current !== connection.sessionKey) {
                        incomingPacketQueueRef.current = [];
                        return;
                    }

                    for (const packet of packets) {
                        const engine = engineRef.current;
                        const renderedMapNumber =
                            engine?.mapNumber ?? currentMapRef.current;

                        await options.onPacket({
                            packet,
                            engine,
                            renderedMapNumber,
                            disconnectSocket,
                        });
                    }
                } catch (packetError) {
                    console.error("Error parsing server packet", packetError);
                }
            }
        } finally {
            isProcessingIncomingPacketsRef.current = false;
        }
    };

    const tryHandlePongMessage = async (
        rawMessage: Blob | ArrayBuffer | ArrayBufferView,
    ): Promise<boolean> => {
        if (rawMessage instanceof ArrayBuffer) {
            if (
                new DataView(rawMessage).getUint8(0) !== CLIENT_PACKET_ID.pong
            ) {
                return false;
            }
        } else if (ArrayBuffer.isView(rawMessage)) {
            if (
                new DataView(
                    rawMessage.buffer,
                    rawMessage.byteOffset,
                    rawMessage.byteLength,
                ).getUint8(0) !== CLIENT_PACKET_ID.pong
            ) {
                return false;
            }
        }

        const messageData = await normalizeSocketMessageData(rawMessage);
        const packet = parseServerPacket(messageData);

        if (packet.type !== "pong") {
            return false;
        }

        const pendingPing = pendingPingRef.current;
        if (
            pendingPing &&
            (packet.payload.token === 0 ||
                packet.payload.token === pendingPing.token)
        ) {
            updatePingDisplay(
                Math.max(
                    0,
                    Math.round(performance.now() - pendingPing.sentAt),
                ),
            );

            pendingPingRef.current = null;
        }

        return true;
    };

    socket.onmessage = (event) => {
        if (!isCurrentSocketInstance(socket)) {
            return;
        }

        const rawMessage = event.data as
            | Blob
            | ArrayBuffer
            | ArrayBufferView;

        void tryHandlePongMessage(rawMessage)
            .then((wasPong) => {
                if (wasPong) {
                    return;
                }

                incomingPacketQueueRef.current.push(rawMessage);
                void processIncomingPacketQueue();
            })
            .catch(() => {
                incomingPacketQueueRef.current.push(rawMessage);
                void processIncomingPacketQueue();
            });
    };

    socket.onerror = () => {
        if (!isCurrentSocketInstance(socket)) {
            return;
        }

        options.setIsSceneReady(false);
        options.emitStatus({
            connected: false,
            connecting: false,
            error: "No se pudo establecer la conexion websocket.",
        });
    };

    socket.onclose = () => {
        clearPing();
        if (
            activeSessionKeyRef.current === connection.sessionKey &&
            isCurrentSocketInstance(socket)
        ) {
            options.setIsSceneReady(false);
            const previousError = latestStatusRef.current.error;
            options.emitStatus({
                connected: false,
                connecting: false,
                error: previousError || "Conexion cerrada.",
            });
        }
    };

    // dispose
    return () => {
        if (
            activeSessionKeyRef.current === connection.sessionKey &&
            isCurrentSocketInstance(socket)
        ) {
            activeSessionKeyRef.current = null;
        }
        options.clearAllDialogMessages();
        options.clearAllCastBars();
        panelSnapshotChunkBufferRef.current = "";
        panelSnapshotChunkExpectedIndexRef.current = 0;
        panelSnapshotChunkTotalRef.current = 0;
        characterStatsChunkBufferRef.current = "";
        characterStatsChunkExpectedIndexRef.current = 0;
        characterStatsChunkTotalRef.current = 0;
        disconnectSocket();
        pendingUserSnapshotRef.current = null;
        pendingRemoteSnapshotsRef.current.clear();
        options.setIsSceneReady(false);
        options.emitHud(null);
        options.emitStatus({ connected: false, connecting: false });
    };
}
