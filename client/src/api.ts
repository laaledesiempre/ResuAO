import { API_BASE_URL } from "./config";
import { mergeSiteConfig, type SiteConfig } from "./lib/siteConfig";

export type { SiteConfig } from "./lib/siteConfig";

export type AuthCharacterSummary = {
    _id: string;
    name: string;
    level: number;
    map: number;
    className: string;
    raceName: string;
    isAdministrator: boolean;
    criminal: boolean;
    faction: "none" | "armada" | "caos";
    clanName: string | null;
    id_head: number;
    id_body: number;
    id_weapon: number;
    id_shield: number;
    id_helmet: number;
};

export type AuthSession = {
    account: {
        _id: string;
        name: string;
        email: string;
        is_admin: boolean;
        must_change_password?: boolean;
    };
    characters: AuthCharacterSummary[];
    selectedCharacterId: string | null;
};

export class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method ?? "GET",
        credentials: "include",
        headers:
            options.body !== undefined
                ? { "content-type": "application/json" }
                : undefined,
        body: options.body !== undefined ? JSON.stringify(options.body) : null,
    });

    if (!response.ok) {
        let message = `Error ${response.status}`;
        try {
            const data = (await response.json()) as { error?: string };
            if (data?.error) {
                message = data.error;
            }
        } catch {
            // keep generic message
        }
        throw new ApiError(response.status, message);
    }

    return (await response.json()) as T;
}

export function register(payload: {
    name: string;
    email: string;
    password: string;
}): Promise<AuthSession> {
    return request<AuthSession>("/api/auth/register", {
        method: "POST",
        body: payload,
    });
}

export function login(payload: {
    identifier: string;
    password: string;
}): Promise<AuthSession> {
    return request<AuthSession>("/api/auth/login", {
        method: "POST",
        body: payload,
    });
}

export function changePassword(payload: {
    currentPassword: string;
    newPassword: string;
}): Promise<AuthSession> {
    return request<AuthSession>("/api/auth/change-password", {
        method: "POST",
        body: payload,
    });
}

export function fetchSession(): Promise<AuthSession> {
    return request<AuthSession>("/api/auth/session");
}

export function logout(): Promise<{ ok?: boolean }> {
    return request("/api/auth/logout", { method: "POST" });
}

export function createCharacter(payload: {
    name: string;
    class: string;
    race: string;
    gender: string;
    headId: number;
}): Promise<AuthSession> {
    return request<AuthSession>("/api/auth/create-character", {
        method: "POST",
        body: payload,
    });
}

export function selectCharacter(characterId: string): Promise<AuthSession> {
    return request<AuthSession>("/api/auth/select-character", {
        method: "POST",
        body: { characterId },
    });
}

export function fetchGameTicket(): Promise<{
    ticket: string;
    expiresAt: string;
}> {
    return request("/api/auth/game-ticket", { method: "POST" });
}

export async function fetchSiteConfig(): Promise<SiteConfig> {
    const data = await request<{ config?: unknown }>("/api/site-config");
    return mergeSiteConfig(data?.config ?? data);
}

export async function saveSiteConfig(config: SiteConfig): Promise<SiteConfig> {
    const data = await request<{ config?: unknown }>("/api/admin/site-config", {
        method: "PUT",
        body: { config },
    });
    return mergeSiteConfig(data?.config ?? data);
}

export async function uploadBrandAsset(file: File): Promise<{ url: string }> {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_BASE_URL}/api/admin/upload`, {
        method: "POST",
        credentials: "include",
        body: form,
    });
    if (!response.ok) {
        let message = `Error ${response.status}`;
        try {
            const data = (await response.json()) as { error?: string };
            if (data?.error) {
                message = data.error;
            }
        } catch {
            // keep generic message
        }
        throw new ApiError(response.status, message);
    }
    return (await response.json()) as { url: string };
}

export type AdminAccount = {
    id: string;
    name: string;
    email: string;
    is_admin: boolean;
    disabled_at: string | null;
    created_at: string;
};

export async function fetchAdminAccounts(q = ""): Promise<AdminAccount[]> {
    const query = q ? `?q=${encodeURIComponent(q)}` : "";
    const data = await request<{ accounts?: AdminAccount[] } | AdminAccount[]>(
        `/api/admin/accounts${query}`,
    );
    return Array.isArray(data) ? data : (data.accounts ?? []);
}

export async function updateAdminAccount(
    id: string,
    patch: { disabled?: boolean; is_admin?: boolean },
): Promise<AdminAccount> {
    const data = await request<{ account?: AdminAccount } | AdminAccount>(
        `/api/admin/accounts/${encodeURIComponent(id)}`,
        { method: "PUT", body: patch },
    );
    return "account" in data && data.account
        ? data.account
        : (data as AdminAccount);
}

export async function resetAdminAccountPassword(
    id: string,
    newPassword: string,
): Promise<AdminAccount> {
    const data = await request<{ account?: AdminAccount } | AdminAccount>(
        `/api/admin/accounts/${encodeURIComponent(id)}/reset-password`,
        { method: "POST", body: { newPassword } },
    );
    return "account" in data && data.account
        ? data.account
        : (data as AdminAccount);
}

export async function deleteAdminAccount(id: string): Promise<void> {
    await request(`/api/admin/accounts/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
}
