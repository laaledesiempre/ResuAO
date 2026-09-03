// Cheatsheet data for the play view: lists every keyboard/mouse interaction
// actually wired in the client. Entries are derived from the configured
// hotkeys (lib/hotkeys.ts) so remapped keys show up correctly.
import {
    formatHotkeyBinding,
    type HotkeySettings,
} from "./hotkeys";

export interface CheatsheetEntry {
    keys: string;
    action: string;
}

export function buildCheatsheetEntries(
    settings: HotkeySettings,
): CheatsheetEntry[] {
    const bind = (codes: string[]) => formatHotkeyBinding(codes);
    const movement = [
        bind(settings.moveUp),
        bind(settings.moveLeft),
        bind(settings.moveDown),
        bind(settings.moveRight),
    ].join("/");

    return [
        { keys: movement, action: "Moverse" },
        { keys: bind(settings.attackOrTarget), action: "Atacar" },
        { keys: bind(settings.pickupItem), action: "Tomar item del suelo" },
        { keys: bind(settings.meditate), action: "Meditar" },
        { keys: bind(settings.toggleHiddenSkill), action: "Ocultarse" },
        { keys: bind(settings.toggleSeguro), action: "Seguro de ataque" },
        { keys: bind(settings.toggleClanSeguro), action: "Seguro de clan" },
        { keys: "L", action: "Resincronizar posición" },
        { keys: bind(settings.useItem), action: "Usar slot seleccionado" },
        { keys: bind(settings.equipItem), action: "Equipar slot seleccionado" },
        { keys: bind(settings.dropItem), action: "Tirar slot seleccionado" },
        { keys: "Enter", action: "Ir al chat" },
        { keys: "Escape", action: "Cancelar targeting / cerrar paneles" },
        { keys: "Click", action: "Usar/equipar item (lo selecciona)" },
        { keys: "Click derecho", action: "Tirar item" },
        { keys: "Click hechizo", action: "Apuntar hechizo (click objetivo)" },
    ];
}
