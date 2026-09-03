import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeWorldMapMarker,
    WORLD_MAP_TILES,
    type WorldMapGridData,
} from "../src/lib/worldMap";

const grid: WorldMapGridData = {
    generatedAt: "2026-01-01",
    totalCols: 10,
    totalRows: 20,
    maps: [
        { id: 1, gridX: 4, gridY: 13 },
        { id: 2, gridX: 0, gridY: 0 },
    ],
};

test("marker centers the map cell for the map origin", () => {
    const marker = computeWorldMapMarker(grid, 1, { x: 1, y: 1 });
    assert.ok(marker);
    // normalized = (1 - 0.5) / 100 = 0.005 inside cell (4,13)
    assert.equal(marker.leftPct, ((4 + 0.005) / 10) * 100);
    assert.equal(marker.topPct, ((13 + 0.005) / 20) * 100);
});

test("marker clamps positions outside the map bounds", () => {
    const over = computeWorldMapMarker(grid, 1, {
        x: WORLD_MAP_TILES + 50,
        y: -10,
    });
    assert.ok(over);
    assert.equal(over.leftPct, ((4 + 1) / 10) * 100);
    assert.equal(over.topPct, ((13 + 0) / 20) * 100);
});

test("marker is null for unknown maps or missing data", () => {
    assert.equal(computeWorldMapMarker(grid, 999, { x: 10, y: 10 }), null);
    assert.equal(computeWorldMapMarker(grid, null, { x: 10, y: 10 }), null);
    assert.equal(computeWorldMapMarker(grid, 1, null), null);
});
