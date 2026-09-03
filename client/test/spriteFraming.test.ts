// Unit tests for the sprite framing math (src/lib/spriteFraming.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    bodySpritePosition,
    headSpritePosition,
    computeSpriteFraming,
} from "../src/lib/spriteFraming";

test("bodySpritePosition anchors the body to the bottom-center of a 32px tile", () => {
    assert.deepEqual(bodySpritePosition(32, 32), { x: 0, y: 0 });
    // Narrow body is centered; tall body extends above the tile.
    assert.deepEqual(bodySpritePosition(25, 52), { x: 4, y: -20 });
});

test("headSpritePosition centers the head on the body, 50px above its bottom", () => {
    const bodyPos = { x: 4, y: -20 };
    // bodyWidth 25, bodyHeight 52, headWidth 20:
    // x = 4 + 12.5 - 10 = 6.5 ; y = -20 + 52 - 50 = -18
    assert.deepEqual(headSpritePosition(bodyPos, 25, 52, 20), {
        x: 6.5,
        y: -18,
    });
    // Per-body offsets from bodies.json shift the head.
    assert.deepEqual(headSpritePosition(bodyPos, 25, 52, 20, 2, -4), {
        x: 8.5,
        y: -22,
    });
});

test("computeSpriteFraming fits the union bounds into the canvas, centered", () => {
    // Body from y=-20..32, head from y=-38..-18: union is 25 wide, 70 tall.
    const framing = computeSpriteFraming(
        [
            { x: 4, y: -20, width: 25, height: 52 },
            { x: 6.5, y: -38, width: 20, height: 20 },
        ],
        224,
        224,
        2,
    );
    // avail = 220; scale = min(220/25, 220/70) = 220/70
    const scale = 220 / 70;
    assert.ok(Math.abs(framing.scale - scale) < 1e-9);
    // Full character must be visible: head top and body bottom inside canvas.
    const headTop = framing.offsetY + -38 * framing.scale;
    const bodyBottom = framing.offsetY + 32 * framing.scale;
    assert.ok(headTop >= 0, `head top ${headTop} must be >= 0`);
    assert.ok(bodyBottom <= 224, `body bottom ${bodyBottom} must be <= 224`);
    // Centered vertically: margins above head and below body are equal.
    assert.ok(Math.abs(headTop - (224 - bodyBottom)) < 1e-6);
});

test("computeSpriteFraming handles edge cases deterministically", () => {
    const identity = { scale: 1, offsetX: 0, offsetY: 0 };
    assert.deepEqual(computeSpriteFraming([], 100, 100), identity);
    assert.deepEqual(
        computeSpriteFraming([{ x: 0, y: 0, width: 10, height: 10 }], 0, 100),
        identity,
    );
    assert.deepEqual(
        computeSpriteFraming([{ x: 5, y: 5, width: 0, height: 10 }], 100, 100),
        identity,
    );
});
