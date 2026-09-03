// Pure helpers for rendering inventory item icons in the DOM HUD.
// The pixi renderer crops sprites via textures; for DOM <img> icons we
// reproduce the crop with an overflow-hidden box + negative offsets.
import type { GraphicData, GraphicsDB } from "../types/game";

export type IconLayout = {
    url: string;
    boxWidth: number;
    boxHeight: number;
    offsetX: number;
    offsetY: number;
    scale: number;
};

// Resolve a grhIndex to the graphic that actually carries the sprite sheet
// (for animated entries, that is the first frame's graphic).
export function resolveIconGraphic(
    graphicsDB: GraphicsDB | null | undefined,
    grhIndex: number | string,
): GraphicData | null {
    const graphic = graphicsDB?.[grhIndex.toString()];
    if (!graphic) return null;
    if (graphic.numFile) return graphic;
    const firstFrameId = graphic.frames?.["1"];
    const frame = firstFrameId != null ? graphicsDB?.[firstFrameId.toString()] : undefined;
    return frame && frame.numFile ? frame : null;
}

export function iconImageUrl(graphic: GraphicData): string {
    return `/graphics/${graphic.numFile}.png`;
}

// Layout to display the sprite region (sX, sY, width, height) of the sheet
// scaled to fit inside a slotSize x slotSize box.
export function inventoryIconLayout(
    graphic: GraphicData,
    slotSize: number,
): IconLayout {
    const width = Math.max(1, graphic.width);
    const height = Math.max(1, graphic.height);
    const scale = Math.min(slotSize / width, slotSize / height);
    return {
        url: iconImageUrl(graphic),
        boxWidth: width * scale,
        boxHeight: height * scale,
        offsetX: -graphic.sX * scale,
        offsetY: -graphic.sY * scale,
        scale,
    };
}

// Re-center a layout at a stronger zoom, keeping the sprite's center fixed
// inside a viewport of `viewSize` px (used for the circular player portrait,
// where the head should fill the circle instead of fitting whole). The
// returned box is the viewport itself.
export function zoomIconLayout(
    layout: IconLayout,
    factor: number,
    viewSize: number,
): IconLayout {
    // Sprite center in scaled sheet coordinates (origin = sheet top-left).
    const centerX = layout.boxWidth / 2 - layout.offsetX;
    const centerY = layout.boxHeight / 2 - layout.offsetY;
    return {
        url: layout.url,
        boxWidth: viewSize,
        boxHeight: viewSize,
        offsetX: viewSize / 2 - centerX * factor,
        offsetY: viewSize / 2 - centerY * factor,
        scale: layout.scale * factor,
    };
}
