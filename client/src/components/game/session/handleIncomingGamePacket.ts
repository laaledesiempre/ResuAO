import { handleIncomingAdminPacket } from "./incomingAdminPackets";
import { handleIncomingCharacterPacket } from "./incomingCharacterPackets";
import type {
    IncomingPacketHandlerArgs,
    IncomingPacketHandlerContext,
} from "./incomingPacketTypes";
import { handleIncomingUiPacket } from "./incomingUiPackets";
import { handleIncomingWorldPacket } from "./incomingWorldPackets";

export type { IncomingPacketHandlerContext } from "./incomingPacketTypes";

export async function handleIncomingGamePacket(
    packet: any,
    engine: any,
    renderedMapNumber: number,
    ctx: IncomingPacketHandlerContext,
): Promise<void> {
    const args: IncomingPacketHandlerArgs = {
        packet,
        engine,
        renderedMapNumber,
        ctx,
    };

    if (await handleIncomingCharacterPacket(args)) {
        return;
    }

    if (await handleIncomingWorldPacket(args)) {
        return;
    }

    if (await handleIncomingAdminPacket(args)) {
        return;
    }

    if (await handleIncomingUiPacket(args)) {
        return;
    }
}
