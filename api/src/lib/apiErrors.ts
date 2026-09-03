// Ported from frontend/lib/api-errors.ts so the cookie-session routes under
// /api/* can normalize error payloads exactly like the old Next.js proxy did.

type ValidationIssue = {
    code?: string;
    path?: Array<string | number>;
    message?: unknown;
    origin?: string;
    format?: string;
    minimum?: number;
    maximum?: number;
    inclusive?: boolean;
    validation?: string;
    received?: string;
};

type ApiErrorLike = {
    error?: unknown;
    message?: unknown;
};

const FIELD_LABELS: Record<string, string> = {
    name: "El nombre",
    email: "El email",
    identifier: "El email o nombre de usuario",
    password: "La password",
    capacity: "La capacidad",
    characterId: "El personaje",
    templateId: "La plantilla",
    class: "La clase",
    race: "La raza",
    gender: "El genero",
    headId: "La cabeza",
};

function getFieldLabel(path: ValidationIssue["path"]): string {
    const firstSegment = path?.find((segment) => typeof segment === "string");

    if (!firstSegment) {
        return "El valor";
    }

    return FIELD_LABELS[firstSegment] ?? `El campo ${firstSegment}`;
}

function formatValidationIssue(issue: ValidationIssue): string {
    const fieldLabel = getFieldLabel(issue.path);

    switch (issue.code) {
        case "too_small":
            if (issue.origin === "string" && typeof issue.minimum === "number") {
                return `${fieldLabel} debe tener al menos ${issue.minimum} caracteres.`;
            }

            return `${fieldLabel} es demasiado corto.`;
        case "too_big":
            if (issue.origin === "string" && typeof issue.maximum === "number") {
                return `${fieldLabel} debe tener como maximo ${issue.maximum} caracteres.`;
            }

            return `${fieldLabel} es demasiado largo.`;
        case "invalid_string":
        case "invalid_format":
            if (issue.validation === "email" || issue.format === "email") {
                return "Ingresa un email valido.";
            }

            return `${fieldLabel} no es valido.`;
        case "invalid_type":
            if (issue.received === "undefined") {
                return `${fieldLabel} es obligatorio.`;
            }

            return `${fieldLabel} no es valido.`;
        case "invalid_enum_value":
            return `${fieldLabel} no es valido.`;
        case "custom":
            return typeof issue.message === "string" && issue.message.trim()
                ? issue.message.trim()
                : `${fieldLabel} no es valido.`;
        default:
            return typeof issue.message === "string" && issue.message.trim()
                ? issue.message.trim()
                : `${fieldLabel} no es valido.`;
    }
}

function tryParseJson(value: string): unknown {
    const trimmed = value.trim();

    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function normalizePlainError(message: string): string {
    const trimmed = message.trim();

    switch (trimmed) {
        case "Unauthorized":
            return "Tu sesion no es valida o ya vencio.";
        case "Unexpected error":
            return "Ocurrio un error inesperado. Intenta de nuevo.";
        default:
            return trimmed;
    }
}

function extractValidationIssues(value: unknown): ValidationIssue[] | null {
    if (Array.isArray(value)) {
        return value;
    }

    if (value && typeof value === "object" && Array.isArray((value as { issues?: unknown }).issues)) {
        return (value as { issues: ValidationIssue[] }).issues;
    }

    return null;
}

export function toUserFriendlyError(input: unknown): string {
    if (typeof input === "string") {
        const parsed = tryParseJson(input);

        if (parsed !== null) {
            return toUserFriendlyError(parsed);
        }

        return normalizePlainError(input);
    }

    const issues = extractValidationIssues(input);

    if (issues?.length) {
        const messages = Array.from(
            new Set(issues.map((issue) => formatValidationIssue(issue)).filter(Boolean)),
        );

        if (messages.length > 0) {
            return messages.join(" ");
        }
    }

    if (input && typeof input === "object") {
        const payload = input as ApiErrorLike;

        if (typeof payload.error === "string") {
            return toUserFriendlyError(payload.error);
        }

        if (typeof payload.message === "string") {
            return toUserFriendlyError(payload.message);
        }
    }

    return "Ocurrio un error inesperado. Intenta de nuevo.";
}

export function normalizeErrorPayload<T>(payload: T): T {
    if (!payload || typeof payload !== "object" || !("error" in payload)) {
        return payload;
    }

    const nextPayload = payload as T & { error?: unknown };

    return {
        ...nextPayload,
        error: toUserFriendlyError(nextPayload.error),
    };
}
