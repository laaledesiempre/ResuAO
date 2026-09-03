// Unit tests for the inventory icon helpers (src/lib/inventoryIcons.ts).
// Run with: npm test (bundles with esbuild, then `node --test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    resolveIconGraphic,
    iconImageUrl,
    inventoryIconLayout,
} from "../src/lib/inventoryIcons";
import type { GraphicData, GraphicsDB } from "../src/types/game";

const makeGraphic = (overrides: Partial<GraphicData> = {}): GraphicData => ({
    numFrames: 1,
    numFile: "100",
    sX: 10,
    sY: 20,
    width: 32,
    height: 32,
    frames: {},
    offset: { x: 0, y: 0 },
    ...overrides,
});

test("resolveIconGraphic returns the graphic itself when it has numFile", () => {
    const db: GraphicsDB = { "5": makeGraphic({ numFile: "321" }) };
    const graphic = resolveIconGraphic(db, 5);
    assert.equal(graphic?.numFile, "321");
});

test("resolveIconGraphic falls back to the first frame for animated graphics", () => {
    const db: GraphicsDB = {
        "7": makeGraphic({ numFile: "", numFrames: 3, frames: { "1": "70" } }),
        "70": makeGraphic({ numFile: "777", sX: 1, sY: 2 }),
    };
    const graphic = resolveIconGraphic(db, 7);
    assert.equal(graphic?.numFile, "777");
    assert.equal(graphic?.sX, 1);
});

test("resolveIconGraphic returns null for unknown or unresolvable grhIndex", () => {
    assert.equal(resolveIconGraphic({}, 42), null);
    assert.equal(resolveIconGraphic(null, 42), null);
    assert.equal(resolveIconGraphic(undefined, 42), null);
    const db: GraphicsDB = {
        "9": makeGraphic({ numFile: "", numFrames: 2, frames: {} }),
    };
    assert.equal(resolveIconGraphic(db, 9), null);
});

test("iconImageUrl maps numFile to the /graphics png path", () => {
    assert.equal(iconImageUrl(makeGraphic({ numFile: "1505" })), "/graphics/1505.png");
});

test("inventoryIconLayout fits the sprite region inside the slot", () => {
    const layout = inventoryIconLayout(
        makeGraphic({ numFile: "55", sX: 10, sY: 20, width: 32, height: 32 }),
        40,
    );
    assert.equal(layout.url, "/graphics/55.png");
    assert.equal(layout.scale, 40 / 32);
    assert.equal(layout.boxWidth, 40);
    assert.equal(layout.boxHeight, 40);
    assert.equal(layout.offsetX, -10 * layout.scale);
    assert.equal(layout.offsetY, -20 * layout.scale);
});

test("inventoryIconLayout scales by the limiting dimension and guards zero sizes", () => {
    const wide = inventoryIconLayout(
        makeGraphic({ width: 64, height: 16, sX: 0, sY: 0 }),
        40,
    );
    assert.equal(wide.scale, 40 / 64);
    assert.equal(wide.boxWidth, 40);
    assert.equal(wide.boxHeight, 10);

    const zero = inventoryIconLayout(
        makeGraphic({ width: 0, height: 0 }),
        40,
    );
    assert.ok(Number.isFinite(zero.scale));
    assert.ok(zero.boxWidth > 0);
    assert.ok(zero.boxHeight > 0);
});
