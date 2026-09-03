// Unit tests for src/lib/portrait.ts (head portrait resolution).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveHeadPortrait } from "../src/lib/portrait";
import type { GraphicData, GraphicsDB, HeadsDB } from "../src/types/game";

const makeGraphic = (overrides: Partial<GraphicData> = {}): GraphicData => ({
    numFrames: 1,
    numFile: "100",
    sX: 0,
    sY: 0,
    width: 16,
    height: 16,
    frames: {},
    offset: { x: 0, y: 0 },
    ...overrides,
});

test("resolves the front (direction 2) head graphic", () => {
    const headsDB: HeadsDB = { "3": { "1": 0, "2": 50, "3": 0, "4": 0 } };
    const graphicsDB: GraphicsDB = { "50": makeGraphic({ numFile: "777" }) };
    const graphic = resolveHeadPortrait(headsDB, graphicsDB, 3);
    assert.equal(graphic?.numFile, "777");
});

test("resolves animated head graphics through the first frame", () => {
    const headsDB: HeadsDB = { "7": { "1": 0, "2": 60, "3": 0, "4": 0 } };
    const graphicsDB: GraphicsDB = {
        "60": makeGraphic({ numFile: "", numFrames: 2, frames: { "1": "61" } }),
        "61": makeGraphic({ numFile: "888" }),
    };
    const graphic = resolveHeadPortrait(headsDB, graphicsDB, 7);
    assert.equal(graphic?.numFile, "888");
});

test("returns null for unknown heads, missing direction or bad inputs", () => {
    const headsDB: HeadsDB = { "3": { "1": 0, "2": 50, "3": 0, "4": 0 } };
    const graphicsDB: GraphicsDB = { "50": makeGraphic() };
    assert.equal(resolveHeadPortrait(headsDB, graphicsDB, 99), null);
    assert.equal(
        resolveHeadPortrait(
            { "1": { "1": 0, "2": 0, "3": 0, "4": 0 } },
            graphicsDB,
            1,
        ),
        null,
    );
    assert.equal(resolveHeadPortrait(null, graphicsDB, 3), null);
    assert.equal(resolveHeadPortrait(headsDB, null, 3), null);
    assert.equal(resolveHeadPortrait(headsDB, graphicsDB, null), null);
    assert.equal(resolveHeadPortrait(headsDB, graphicsDB, undefined), null);
});
