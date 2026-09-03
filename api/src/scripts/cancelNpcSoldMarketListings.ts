import pool from "../db";
import { listNpcSoldItemIds } from "../repositories/gameNpcs";
import { cancelForbiddenMarketListings } from "../repositories/market";

async function main() {
    const itemIds = await listNpcSoldItemIds();

    if (!itemIds.length) {
        throw new Error("No se encontraron items vendidos por NPCs en game_npcs");
    }

    const result = await cancelForbiddenMarketListings(itemIds);

    console.log(
        [
            `Publicaciones canceladas: ${result.cancelledListings}`,
            `Comisiones reintegradas: ${result.refundedPublicationFees}`,
            `Items NPC analizados: ${itemIds.length}`,
        ].join(" | "),
    );
}

main()
    .catch(async (error) => {
        console.error(error);
        await pool.end().catch(() => undefined);
        process.exit(1);
    })
    .finally(async () => {
        await pool.end();
    });
