export type ClientSignalSeverity = "low" | "medium" | "high";

type ClientSignalPayload = {
    action: string;
    severity: ClientSignalSeverity;
    suspicionScore: number;
    confidence?: number;
    details?: Record<string, unknown>;
};

export function isClientDiagnosticsDisabled(): boolean {
    return true;
}

export function sendClientSignal(
    _payload: ClientSignalPayload,
    _options: { throttleKey?: string; throttleMs?: number } = {},
): void {
    void _payload;
    void _options;
}
