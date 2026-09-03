// Resolves a character's portrait graphic from heads.json + graficos.json.
// Same resolution strategy as spritePreview/inventoryIcons: the head entry
// maps directions to grh ids; the front frame is direction "2", resolved
// through the graphics DB (animated entries resolve to their first frame).
import type { GraphicData, GraphicsDB, HeadsDB } from "../types/game";
import { resolveIconGraphic } from "./inventoryIcons";

const FRONT_DIRECTION = "2";

export function resolveHeadPortrait(
    headsDB: HeadsDB | null | undefined,
    graphicsDB: GraphicsDB | null | undefined,
    headId: number | string | null | undefined,
): GraphicData | null {
    if (headId == null) return null;
    const head = headsDB?.[headId.toString()];
    if (!head) return null;
    const grhId = head[FRONT_DIRECTION as keyof typeof head];
    if (!grhId) return null;
    const graphic = resolveIconGraphic(graphicsDB, grhId);
    if (!graphic) return null;
    // Head grh cells are vertical strips (e.g. 17x50) with the face in the
    // top square; crop to the top width×width region so the portrait shows
    // the face, not the whole strip.
    const side = Math.min(graphic.width, graphic.height);
    return { ...graphic, width: side, height: side };
}
