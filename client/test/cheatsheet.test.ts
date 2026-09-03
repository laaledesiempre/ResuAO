import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCheatsheetEntries } from "../src/lib/cheatsheet";
import {
    DEFAULT_HOTKEY_SETTINGS,
    cloneHotkeySettings,
} from "../src/lib/hotkeys";

test("cheatsheet lists all default interactions", () => {
    const entries = buildCheatsheetEntries(DEFAULT_HOTKEY_SETTINGS);
    const byAction = new Map(entries.map((e) => [e.action, e.keys]));

    assert.equal(byAction.get("Moverse"), "W/A/S/D");
    assert.equal(byAction.get("Atacar"), "Espacio");
    assert.equal(byAction.get("Tomar item del suelo"), "Q");
    assert.equal(byAction.get("Meditar"), "N");
    assert.equal(byAction.get("Ocultarse"), "O");
    assert.equal(byAction.get("Seguro de ataque"), "K");
    assert.equal(byAction.get("Seguro de clan"), "J");
    assert.equal(byAction.get("Usar slot seleccionado"), "U");
    assert.equal(byAction.get("Equipar slot seleccionado"), "E");
    assert.equal(byAction.get("Tirar slot seleccionado"), "T");
    assert.equal(byAction.get("Ir al chat"), "Enter");
    assert.equal(byAction.get("Tirar item"), "Click derecho");
    assert.equal(
        byAction.get("Apuntar hechizo (click objetivo)"),
        "Click hechizo",
    );
    assert.equal(entries.length, 16);
});

test("cheatsheet reflects remapped hotkeys", () => {
    const settings = cloneHotkeySettings();
    settings.pickupItem = ["KeyG"];
    settings.attackOrTarget = ["ControlLeft", "ControlRight"];
    const entries = buildCheatsheetEntries(settings);
    const byAction = new Map(entries.map((e) => [e.action, e.keys]));

    assert.equal(byAction.get("Tomar item del suelo"), "G");
    assert.equal(byAction.get("Atacar"), "Ctrl");
});

test("cheatsheet handles an unbound action", () => {
    const settings = cloneHotkeySettings();
    settings.meditate = [];
    const entries = buildCheatsheetEntries(settings);
    const meditate = entries.find((e) => e.action === "Meditar");
    assert.equal(meditate?.keys, "");
});
