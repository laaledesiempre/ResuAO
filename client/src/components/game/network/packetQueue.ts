import {
    inspectServerFramePacketIds,
    normalizeSocketMessageData,
    parseServerFrame,
} from "../../../lib/aowProtocol";

export async function parseQueuedSocketMessage(
    queuedMessage: Blob | ArrayBuffer | ArrayBufferView,
) {
    const startedAt = performance.now();
    const messageData = await normalizeSocketMessageData(queuedMessage);
    const packets = parseServerFrame(messageData);
    return {
        packets,
        packetIds: inspectServerFramePacketIds(messageData),
        frameByteLength: messageData.byteLength,
        parseMs: Math.max(0, performance.now() - startedAt),
    };
}
