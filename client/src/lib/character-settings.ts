import {
    DEFAULT_HOTKEY_SETTINGS,
    normalizeHotkeySettings,
    type HotkeySettings,
} from "./hotkeys";

export const MACRO_SLOTS = 8;

export type MacroTargetType = "item" | "spell" | "command";

export type StoredMacro = {
    keyCode: string;
    targetType: MacroTargetType;
    label: string;
    targetSlot?: number;
    targetId?: number;
    command?: string;
    grhIndex?: number;
};

export type CharacterSettingsResponse = {
    characterId: string;
    hotkeys: HotkeySettings;
    macros: Array<StoredMacro | null>;
};

export function createEmptyMacros(): Array<StoredMacro | null> {
    return Array.from({ length: MACRO_SLOTS }, () => null);
}

export function normalizeMacros(value: unknown): Array<StoredMacro | null> {
    if (!Array.isArray(value)) {
        return createEmptyMacros();
    }

    return Array.from({ length: MACRO_SLOTS }, (_, index) => {
        const entry = value[index];

        if (!entry || typeof entry !== "object") {
            return null;
        }

        const macro = entry as Partial<StoredMacro>;

        if (
            typeof macro.keyCode !== "string" ||
            (macro.targetType !== "item" &&
                macro.targetType !== "spell" &&
                macro.targetType !== "command") ||
            typeof macro.label !== "string"
        ) {
            return null;
        }

        if (macro.targetType === "command") {
            if (typeof macro.command !== "string" || !macro.command.trim()) {
                return null;
            }

            return {
                keyCode: macro.keyCode,
                targetType: "command",
                label: macro.label,
                command: macro.command,
            };
        }

        if (
            typeof macro.targetSlot !== "number" ||
            typeof macro.targetId !== "number"
        ) {
            return null;
        }

        return {
            keyCode: macro.keyCode,
            targetType: macro.targetType,
            targetSlot: macro.targetSlot,
            targetId: macro.targetId,
            label: macro.label,
            grhIndex:
                typeof macro.grhIndex === "number" ? macro.grhIndex : undefined,
        };
    });
}

export function normalizeCharacterSettings(
    value: Partial<CharacterSettingsResponse> | null | undefined,
): CharacterSettingsResponse | null {
    if (!value?.characterId || typeof value.characterId !== "string") {
        return null;
    }

    return {
        characterId: value.characterId,
        hotkeys: normalizeHotkeySettings(
            value.hotkeys ?? DEFAULT_HOTKEY_SETTINGS,
        ),
        macros: normalizeMacros(value.macros),
    };
}
