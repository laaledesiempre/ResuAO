import { useCallback, useRef, type RefObject } from "../vanilla";

export const CLIENT_RECENT_INPUT_WINDOW_MS = 750;
export const CLIENT_TRUSTED_INPUT_SUPPRESSION_MS = 50;

export function normalizeKeyboardEventKey(
    key: string | null | undefined,
): string {
    if (key === " ") {
        return " ";
    }

    return (key ?? "").trim().toLowerCase();
}

export function getKeyboardKeyCandidatesFromCode(code: string): string[] {
    if (code.startsWith("Key") && code.length === 4) {
        return [code.slice(3).toLowerCase()];
    }

    if (code.startsWith("Digit") && code.length === 6) {
        return [code.slice(5)];
    }

    if (code === "Space") {
        return [" "];
    }

    if (code === "ArrowUp") {
        return ["arrowup"];
    }

    if (code === "ArrowDown") {
        return ["arrowdown"];
    }

    if (code === "ArrowLeft") {
        return ["arrowleft"];
    }

    if (code === "ArrowRight") {
        return ["arrowright"];
    }

    return [];
}

type UseClientInputDiagnosticsOptions = {
    connectionSessionKey?: string | null;
    getBlockedKeyboardSequenceUntil: (event: KeyboardEvent) => number;
    resolveBlockedGameplayKeyboardReason: (
        event: KeyboardEvent,
    ) => "document_not_focused" | "untrusted_event" | null;
    macroKeyCodesRef: RefObject<Set<string>>;
    blockedKeyboardCodesRef: RefObject<Map<string, number>>;
    blockedKeyboardKeysRef: RefObject<Map<string, number>>;
};

export function useClientInputDiagnostics({
    blockedKeyboardCodesRef,
    blockedKeyboardKeysRef,
}: UseClientInputDiagnosticsOptions) {
    const lastTrustedInputAtRef = useRef(0);
    const lastUntrustedInputAtRef = useRef(0);

    const resetClientInputDiagnosticsState = useCallback(() => {
        lastTrustedInputAtRef.current = 0;
        lastUntrustedInputAtRef.current = 0;
        blockedKeyboardCodesRef.current?.clear();
        blockedKeyboardKeysRef.current?.clear();
    }, [blockedKeyboardCodesRef, blockedKeyboardKeysRef]);

    const recordClientGameAction = useCallback(
        (_action: string, _details?: Record<string, unknown>) => {
            void _action;
            void _details;
        },
        [],
    );

    return {
        lastTrustedInputAtRef,
        lastUntrustedInputAtRef,
        recordClientGameAction,
        resetClientInputDiagnosticsState,
    };
}
