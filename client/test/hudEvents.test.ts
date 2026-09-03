// Unit tests for src/lib/hudEvents.ts (HUD diff → animation events).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHudEvents } from "../src/lib/hudEvents";

test("no events on the first snapshot (prev is null)", () => {
    assert.deepEqual(deriveHudEvents(null, { hp: 50, level: 3 }), {
        hpDropped: false,
        leveledUp: false,
    });
    assert.deepEqual(deriveHudEvents({ hp: 50, level: 3 }, null), {
        hpDropped: false,
        leveledUp: false,
    });
});

test("hpDropped fires only when hp strictly decreases", () => {
    assert.equal(
        deriveHudEvents({ hp: 100 }, { hp: 80 }).hpDropped,
        true,
    );
    assert.equal(
        deriveHudEvents({ hp: 80 }, { hp: 100 }).hpDropped,
        false,
    );
    assert.equal(
        deriveHudEvents({ hp: 80 }, { hp: 80 }).hpDropped,
        false,
    );
});

test("leveledUp fires only when level strictly increases", () => {
    assert.equal(
        deriveHudEvents({ level: 4 }, { level: 5 }).leveledUp,
        true,
    );
    assert.equal(
        deriveHudEvents({ level: 5 }, { level: 5 }).leveledUp,
        false,
    );
    assert.equal(
        deriveHudEvents({ level: 5 }, { level: 4 }).leveledUp,
        false,
    );
});

test("missing fields never produce events", () => {
    assert.deepEqual(deriveHudEvents({}, {}), {
        hpDropped: false,
        leveledUp: false,
    });
    assert.deepEqual(deriveHudEvents({ hp: 10 }, {}), {
        hpDropped: false,
        leveledUp: false,
    });
});
