// Pure math for the character-creation sprite preview: body/head anchor
// positions in unscaled sprite space (same formulas the game uses) and the
// fit-to-canvas transform so the FULL character (head to feet) is visible.
// No DOM access — unit-tested in test/spriteFraming.test.ts.

export interface SpritePoint {
    x: number;
    y: number;
}

export interface SpriteRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SpriteFraming {
    scale: number;
    offsetX: number;
    offsetY: number;
}

// Bodies are anchored to the bottom-center of a 32x32 tile.
export function bodySpritePosition(
    width: number,
    height: number,
): SpritePoint {
    return {
        x: 16 - Math.floor((width * 16) / 32),
        y: 32 - Math.floor((height * 32) / 32),
    };
}

// The head sits centered on the body, 50px above the body's bottom edge
// (plus the per-body head offsets from bodies.json).
export function headSpritePosition(
    bodyPosition: SpritePoint,
    bodyWidth: number,
    bodyHeight: number,
    headWidth: number,
    headOffsetX = 0,
    headOffsetY = 0,
): SpritePoint {
    return {
        x: bodyPosition.x + bodyWidth / 2 - headWidth / 2 + headOffsetX,
        y: bodyPosition.y + bodyHeight - 50 + headOffsetY,
    };
}

/**
 * Given the rects (in unscaled sprite space) that make up the character,
 * returns the transform that scales them uniformly to fit the canvas (with
 * padding) and centers the result. Sprite-space point (x, y) maps to canvas
 * point (offsetX + x * scale, offsetY + y * scale).
 */
export function computeSpriteFraming(
    rects: SpriteRect[],
    canvasWidth: number,
    canvasHeight: number,
    padding = 2,
): SpriteFraming {
    const fallback: SpriteFraming = { scale: 1, offsetX: 0, offsetY: 0 };
    if (!rects.length || canvasWidth <= 0 || canvasHeight <= 0) {
        return fallback;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const rect of rects) {
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
    }

    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    if (boundsWidth <= 0 || boundsHeight <= 0) return fallback;

    const availWidth = Math.max(1, canvasWidth - padding * 2);
    const availHeight = Math.max(1, canvasHeight - padding * 2);
    const scale = Math.min(availWidth / boundsWidth, availHeight / boundsHeight);

    return {
        scale,
        offsetX: (canvasWidth - boundsWidth * scale) / 2 - minX * scale,
        offsetY: (canvasHeight - boundsHeight * scale) / 2 - minY * scale,
    };
}
