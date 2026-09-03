// Tiny DOM helpers + session store + toast.
import type { AuthSession } from "./api";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "./lib/siteConfig";

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "className") {
            node.className = value;
        } else {
            node.setAttribute(key, value);
        }
    }
    for (const child of children) {
        if (child == null) continue;
        node.append(child);
    }
    return node;
}

export function showToast(text: string, durationMs = 3000): void {
    const toast = el("div", { className: "toast" }, text);
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), durationMs);
}

// ---------------- session store ----------------

let currentSession: AuthSession | null = null;
const listeners = new Set<(session: AuthSession | null) => void>();

export function getSession(): AuthSession | null {
    return currentSession;
}

export function setSession(session: AuthSession | null): void {
    currentSession = session;
    for (const listener of listeners) {
        listener(session);
    }
}

export function onSessionChange(
    listener: (session: AuthSession | null) => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// ---------------- site config store ----------------

let currentSiteConfig: SiteConfig = DEFAULT_SITE_CONFIG;
const siteConfigListeners = new Set<(config: SiteConfig) => void>();

export function getSiteConfig(): SiteConfig {
    return currentSiteConfig;
}

export function setSiteConfig(config: SiteConfig): void {
    currentSiteConfig = config;
    for (const listener of siteConfigListeners) {
        listener(config);
    }
}

export function onSiteConfigChange(
    listener: (config: SiteConfig) => void,
): () => void {
    siteConfigListeners.add(listener);
    return () => siteConfigListeners.delete(listener);
}

export function getSelectedCharacter() {
    if (!currentSession) return null;
    return (
        currentSession.characters.find(
            (character) => character._id === currentSession?.selectedCharacterId,
        ) ?? null
    );
}
