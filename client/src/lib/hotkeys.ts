export const HOTKEYS_STORAGE_KEY = "ao-hotkeys";

export type HotkeyAction =
    | "moveUp"
    | "moveLeft"
    | "moveDown"
    | "moveRight"
    | "toggleWorldMap"
    | "toggleSeguro"
    | "toggleClanSeguro"
    | "toggleHiddenSkill"
    | "pickupItem"
    | "attackOrTarget"
    | "meditate"
    | "equipItem"
    | "useItem"
    | "dropItem";

export type HotkeySettings = Record<HotkeyAction, string[]>;

export const DEFAULT_HOTKEY_SETTINGS: HotkeySettings = {
    moveUp: ["KeyW"],
    moveLeft: ["KeyA"],
    moveDown: ["KeyS"],
    moveRight: ["KeyD"],
    toggleWorldMap: ["KeyM"],
    toggleSeguro: ["KeyK"],
    toggleClanSeguro: ["KeyJ"],
    toggleHiddenSkill: ["KeyO"],
    pickupItem: ["KeyQ"],
    attackOrTarget: ["Space"],
    meditate: ["KeyN"],
    equipItem: ["KeyE"],
    useItem: ["KeyU"],
    dropItem: ["KeyT"],
};

const HOTKEY_ACTIONS = Object.keys(DEFAULT_HOTKEY_SETTINGS) as HotkeyAction[];

export function cloneHotkeySettings(
    settings: HotkeySettings = DEFAULT_HOTKEY_SETTINGS,
): HotkeySettings {
    return HOTKEY_ACTIONS.reduce((acc, action) => {
        acc[action] = [...(settings[action] ?? [])];
        return acc;
    }, {} as HotkeySettings);
}

export function normalizeHotkeySettings(value: unknown): HotkeySettings {
    const nextSettings = cloneHotkeySettings();
    const hasStoredMeditateBinding =
        !!value &&
        typeof value === "object" &&
        Array.isArray(
            (value as Partial<Record<HotkeyAction, unknown>>).meditate,
        );

    if (!value || typeof value !== "object") {
        return nextSettings;
    }

    for (const action of HOTKEY_ACTIONS) {
        const maybeCodes = (value as Partial<Record<HotkeyAction, unknown>>)[
            action
        ];
        if (!Array.isArray(maybeCodes)) {
            continue;
        }

        const sanitizedCodes = maybeCodes
            .filter((code): code is string => typeof code === "string")
            .map((code) => code.trim())
            .filter(Boolean);

        nextSettings[action] = sanitizeHotkeyCodes(action, sanitizedCodes);
    }

    if (
        !hasStoredMeditateBinding &&
        HOTKEY_ACTIONS.some(
            (action) =>
                action !== "meditate" && nextSettings[action].includes("KeyN"),
        )
    ) {
        nextSettings.meditate = [];
    }

    return nextSettings;
}

const MODIFIER_GROUPS: Record<string, string[]> = {
    ControlLeft: ["ControlLeft", "ControlRight"],
    ControlRight: ["ControlLeft", "ControlRight"],
    ShiftLeft: ["ShiftLeft", "ShiftRight"],
    ShiftRight: ["ShiftLeft", "ShiftRight"],
    AltLeft: ["AltLeft", "AltRight"],
    AltRight: ["AltLeft", "AltRight"],
    MetaLeft: ["MetaLeft", "MetaRight"],
    MetaRight: ["MetaLeft", "MetaRight"],
};

export function expandHotkeyCode(code: string): string[] {
    return MODIFIER_GROUPS[code] ?? [code];
}

export function sanitizeHotkeyCodes(
    action: HotkeyAction,
    codes: string[],
): string[] {
    const normalizedCodes = Array.from(
        new Set(
            codes.flatMap((code) =>
                action === "attackOrTarget" ? expandHotkeyCode(code) : [code],
            ),
        ),
    );

    if (action === "attackOrTarget") {
        return normalizedCodes.slice(0, 2);
    }

    return normalizedCodes.slice(0, 1);
}

export function getPrimaryHotkeyCode(codes: string[]): string | null {
    return codes[0] ?? null;
}

export function formatHotkeyBinding(codes: string[]): string {
    if (codes.includes("ControlLeft") && codes.includes("ControlRight")) {
        return "Ctrl";
    }

    if (codes.includes("ShiftLeft") && codes.includes("ShiftRight")) {
        return "Shift";
    }

    if (codes.includes("AltLeft") && codes.includes("AltRight")) {
        return "Alt";
    }

    if (codes.includes("MetaLeft") && codes.includes("MetaRight")) {
        return "Meta";
    }

    return formatHotkeyCode(getPrimaryHotkeyCode(codes) ?? "");
}

export function isHotkeyMatch(event: KeyboardEvent, codes: string[]): boolean {
    return codes.includes(event.code);
}

const CODE_LABELS: Record<string, string> = {
    ArrowUp: "Flecha arriba",
    ArrowDown: "Flecha abajo",
    ArrowLeft: "Flecha izquierda",
    ArrowRight: "Flecha derecha",
    ControlLeft: "Ctrl izq",
    ControlRight: "Ctrl der",
    ShiftLeft: "Shift izq",
    ShiftRight: "Shift der",
    AltLeft: "Alt izq",
    AltRight: "Alt der",
    Enter: "Enter",
    Escape: "Esc",
    Space: "Espacio",
    Backspace: "Backspace",
    Delete: "Delete",
    Tab: "Tab",
};

export function formatHotkeyCode(code: string): string {
    if (CODE_LABELS[code]) {
        return CODE_LABELS[code];
    }

    if (code.startsWith("Key")) {
        return code.slice(3).toUpperCase();
    }

    if (code.startsWith("Digit")) {
        return code.slice(5);
    }

    if (code.startsWith("Numpad")) {
        return `Num ${code.slice(6)}`;
    }

    return code;
}
