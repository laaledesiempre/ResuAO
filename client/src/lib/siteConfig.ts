// Site branding config: defaults, deep-merge, debug flag and theme application.
// Pure module: no DOM globals; applySiteConfigTheme receives the target element.

export interface SiteColors {
    accent: string;
    accentHover: string;
    bg: string;
    panel: string;
    text: string;
}

export interface SiteTexts {
    loginTitle: string;
    loginSubtitle: string;
    welcome: string;
    footer: string;
}

export interface SiteDebug {
    showFpsPing: boolean;
}

export interface SiteFonts {
    displayUrl: string | null;
    bodyUrl: string | null;
}

export interface SiteMusic {
    url: string | null;
    autoplay: boolean;
    volume: number;
}

export interface SiteMessages {
    loginNotice: string;
    playWelcome: string;
    serverWelcome: string[];
}

export interface SiteRegistration {
    enabled: boolean;
    requireEmail: boolean;
}

export interface SiteConfig {
    brandName: string;
    tagline: string;
    logoUrl: string | null;
    loginBackgroundUrl: string | null;
    colors: SiteColors;
    texts: SiteTexts;
    debug: SiteDebug;
    fonts: SiteFonts;
    music: SiteMusic;
    messages: SiteMessages;
    registration: SiteRegistration;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
    brandName: "Resu",
    tagline: "El clasico Argentum Online en tu navegador",
    logoUrl: null,
    loginBackgroundUrl: null,
    colors: {
        accent: "#c8a44d",
        accentHover: "#e0c06a",
        bg: "#101018",
        panel: "#1a1a24",
        text: "#e8e4d8",
    },
    texts: {
        loginTitle: "Resu",
        loginSubtitle: "Ingresa a tu cuenta para continuar",
        welcome: "Bienvenido a Resu",
        footer: "Resu - Proyecto fan sin fines de lucro",
    },
    debug: {
        showFpsPing: false,
    },
    fonts: {
        displayUrl: null,
        bodyUrl: null,
    },
    music: {
        url: null,
        autoplay: false,
        volume: 0.5,
    },
    messages: {
        loginNotice: "",
        playWelcome: "",
        serverWelcome: [],
    },
    registration: {
        enabled: true,
        requireEmail: true,
    },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeStrings<T extends object>(
    defaults: T,
    partial: unknown,
): T {
    const result = { ...defaults };
    if (!isPlainObject(partial)) return result;
    for (const key of Object.keys(defaults) as Array<keyof T>) {
        const value = partial[key as string];
        if (typeof value === "string" && typeof result[key] === "string") {
            result[key] = value as T[keyof T];
        }
    }
    return result;
}

export function mergeSiteConfig(partial: unknown): SiteConfig {
    const merged: SiteConfig = {
        ...DEFAULT_SITE_CONFIG,
        colors: { ...DEFAULT_SITE_CONFIG.colors },
        texts: { ...DEFAULT_SITE_CONFIG.texts },
        debug: { ...DEFAULT_SITE_CONFIG.debug },
        fonts: { ...DEFAULT_SITE_CONFIG.fonts },
        music: { ...DEFAULT_SITE_CONFIG.music },
        messages: { ...DEFAULT_SITE_CONFIG.messages },
        registration: { ...DEFAULT_SITE_CONFIG.registration },
    };
    if (!isPlainObject(partial)) return merged;

    if (typeof partial.brandName === "string") merged.brandName = partial.brandName;
    if (typeof partial.tagline === "string") merged.tagline = partial.tagline;
    if (typeof partial.logoUrl === "string") merged.logoUrl = partial.logoUrl;
    if (typeof partial.loginBackgroundUrl === "string") {
        merged.loginBackgroundUrl = partial.loginBackgroundUrl;
    }

    merged.colors = mergeStrings(DEFAULT_SITE_CONFIG.colors, partial.colors);
    merged.texts = mergeStrings(DEFAULT_SITE_CONFIG.texts, partial.texts);

    if (isPlainObject(partial.debug)) {
        if (typeof partial.debug.showFpsPing === "boolean") {
            merged.debug.showFpsPing = partial.debug.showFpsPing;
        }
    }

    if (isPlainObject(partial.fonts)) {
        if (typeof partial.fonts.displayUrl === "string") {
            merged.fonts.displayUrl = partial.fonts.displayUrl;
        }
        if (typeof partial.fonts.bodyUrl === "string") {
            merged.fonts.bodyUrl = partial.fonts.bodyUrl;
        }
    }

    if (isPlainObject(partial.music)) {
        if (typeof partial.music.url === "string") {
            merged.music.url = partial.music.url;
        }
        if (typeof partial.music.autoplay === "boolean") {
            merged.music.autoplay = partial.music.autoplay;
        }
        if (
            typeof partial.music.volume === "number" &&
            Number.isFinite(partial.music.volume)
        ) {
            merged.music.volume = Math.min(1, Math.max(0, partial.music.volume));
        }
    }

    merged.messages = mergeStrings(
        DEFAULT_SITE_CONFIG.messages,
        partial.messages,
    );
    if (isPlainObject(partial.messages) && Array.isArray(partial.messages.serverWelcome)) {
        merged.messages.serverWelcome = partial.messages.serverWelcome.filter(
            (line): line is string => typeof line === "string",
        );
    }

    if (isPlainObject(partial.registration)) {
        if (typeof partial.registration.enabled === "boolean") {
            merged.registration.enabled = partial.registration.enabled;
        }
        if (typeof partial.registration.requireEmail === "boolean") {
            merged.registration.requireEmail = partial.registration.requireEmail;
        }
    }

    return merged;
}

export function isDebugEnabled(
    config: SiteConfig,
    env: { query: string; localStorageValue: string | null },
): boolean {
    if (config.debug.showFpsPing) return true;
    if (env.localStorageValue === "1") return true;
    const params = new URLSearchParams(env.query.replace(/^\?/, ""));
    return params.get("debug") === "1";
}

export interface ThemeTarget {
    style: {
        setProperty(name: string, value: string): void;
    };
}

export function applySiteConfigTheme(
    config: SiteConfig,
    target: ThemeTarget,
): string {
    target.style.setProperty("--brand-accent", config.colors.accent);
    target.style.setProperty("--brand-accent-hover", config.colors.accentHover);
    target.style.setProperty("--brand-bg", config.colors.bg);
    target.style.setProperty("--brand-panel", config.colors.panel);
    target.style.setProperty("--brand-text", config.colors.text);
    if (config.fonts.displayUrl) {
        target.style.setProperty(
            "--brand-font-display",
            '"SiteDisplay", Cinzel, Georgia, serif',
        );
    }
    if (config.fonts.bodyUrl) {
        target.style.setProperty(
            "--brand-font-body",
            '"SiteBody", "IM Fell English", Georgia, serif',
        );
    }
    return config.brandName;
}

/**
 * Builds the <style> contents declaring @font-face for the custom brand
 * fonts. Returns an empty string when no custom fonts are configured.
 * Pure: the caller owns injecting it into a <style> element.
 */
export function buildCustomFontCss(config: SiteConfig): string {
    const blocks: string[] = [];
    if (config.fonts.displayUrl) {
        blocks.push(
            `@font-face { font-family: "SiteDisplay"; src: url("${config.fonts.displayUrl}"); font-display: swap; }`,
        );
    }
    if (config.fonts.bodyUrl) {
        blocks.push(
            `@font-face { font-family: "SiteBody"; src: url("${config.fonts.bodyUrl}"); font-display: swap; }`,
        );
    }
    return blocks.join("\n");
}
