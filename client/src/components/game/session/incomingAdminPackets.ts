import type {
    ChunkedCharacterStatsSnapshot,
    ChunkedPanelSnapshot,
    FullCharacterStatsSnapshot,
    FullPanelSnapshot,
    IncomingPacketHandlerArgs,
} from "./incomingPacketTypes";

export async function handleIncomingAdminPacket({
    packet,
    ctx,
}: IncomingPacketHandlerArgs): Promise<boolean> {
    switch (packet.type) {
        case "openAdminIntervals":
            ctx.onAdminIntervalsOpen?.();
            return true;

        case "panelSnapshot":
            ctx.panelSnapshotChunkBufferRef.current = "";
            ctx.panelSnapshotChunkExpectedIndexRef.current = 0;
            ctx.panelSnapshotChunkTotalRef.current = 0;
            ctx.onAdminOverviewSnapshot?.(packet.payload);
            return true;

        case "panelSnapshotChunk": {
            const payload = packet.payload as ChunkedPanelSnapshot;
            if (
                payload.chunkIndex === 0 ||
                ctx.panelSnapshotChunkTotalRef.current !== payload.totalChunks
            ) {
                ctx.panelSnapshotChunkBufferRef.current = "";
                ctx.panelSnapshotChunkExpectedIndexRef.current = 0;
                ctx.panelSnapshotChunkTotalRef.current = payload.totalChunks;
            }

            if (
                payload.chunkIndex !==
                ctx.panelSnapshotChunkExpectedIndexRef.current
            ) {
                ctx.panelSnapshotChunkBufferRef.current = "";
                ctx.panelSnapshotChunkExpectedIndexRef.current = 0;
                ctx.panelSnapshotChunkTotalRef.current = 0;
                return true;
            }

            ctx.panelSnapshotChunkBufferRef.current += payload.chunk;
            ctx.panelSnapshotChunkExpectedIndexRef.current += 1;

            if (
                ctx.panelSnapshotChunkExpectedIndexRef.current <
                payload.totalChunks
            ) {
                return true;
            }

            try {
                ctx.onAdminOverviewSnapshot?.(
                    JSON.parse(
                        ctx.panelSnapshotChunkBufferRef.current,
                    ) as FullPanelSnapshot,
                );
            } catch (snapshotError) {
                console.error(
                    "Error parsing chunked panel snapshot",
                    snapshotError,
                );
            }

            ctx.panelSnapshotChunkBufferRef.current = "";
            ctx.panelSnapshotChunkExpectedIndexRef.current = 0;
            ctx.panelSnapshotChunkTotalRef.current = 0;
            return true;
        }

        case "characterStatsSnapshot":
            ctx.characterStatsChunkBufferRef.current = "";
            ctx.characterStatsChunkExpectedIndexRef.current = 0;
            ctx.characterStatsChunkTotalRef.current = 0;
            ctx.onCharacterStatsSnapshot?.(packet.payload);
            return true;

        case "characterStatsSnapshotChunk": {
            const payload = packet.payload as ChunkedCharacterStatsSnapshot;
            if (
                payload.chunkIndex === 0 ||
                ctx.characterStatsChunkTotalRef.current !== payload.totalChunks
            ) {
                ctx.characterStatsChunkBufferRef.current = "";
                ctx.characterStatsChunkExpectedIndexRef.current = 0;
                ctx.characterStatsChunkTotalRef.current = payload.totalChunks;
            }

            if (
                payload.chunkIndex !==
                ctx.characterStatsChunkExpectedIndexRef.current
            ) {
                ctx.characterStatsChunkBufferRef.current = "";
                ctx.characterStatsChunkExpectedIndexRef.current = 0;
                ctx.characterStatsChunkTotalRef.current = 0;
                return true;
            }

            ctx.characterStatsChunkBufferRef.current += payload.chunk;
            ctx.characterStatsChunkExpectedIndexRef.current += 1;

            if (
                ctx.characterStatsChunkExpectedIndexRef.current <
                payload.totalChunks
            ) {
                return true;
            }

            try {
                ctx.onCharacterStatsSnapshot?.(
                    JSON.parse(
                        ctx.characterStatsChunkBufferRef.current,
                    ) as FullCharacterStatsSnapshot,
                );
            } catch (snapshotError) {
                console.error(
                    "Error parsing chunked character stats snapshot",
                    snapshotError,
                );
            }

            ctx.characterStatsChunkBufferRef.current = "";
            ctx.characterStatsChunkExpectedIndexRef.current = 0;
            ctx.characterStatsChunkTotalRef.current = 0;
            return true;
        }

        default:
            return false;
    }
}
