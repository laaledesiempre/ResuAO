// Pure helpers for the admin site-config editor: draft validation,
// theme export filename and JSON theme import. No DOM access.
import { mergeSiteConfig, type SiteConfig } from "./siteConfig";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
    return HEX_COLOR.test(value);
}

const COLOR_LABELS: Record<keyof SiteConfig["colors"], string> = {
    accent: "Acento",
    accentHover: "Acento (hover)",
    bg: "Fondo",
    panel: "Panel",
    text: "Texto",
};

// Returns an error message, or null when the draft is valid.
export function validateSiteConfigDraft(config: SiteConfig): string | null {
    if (!config.brandName.trim()) {
        return "El nombre de la marca no puede estar vacio.";
    }
    for (const key of Object.keys(config.colors) as Array<keyof SiteConfig["colors"]>) {
        if (!isHexColor(config.colors[key])) {
            return `El color "${COLOR_LABELS[key]}" debe ser un valor hexadecimal (#rgb o #rrggbb).`;
        }
    }
    return null;
}

// Builds "<slug>-theme.json" from the brand name.
export function themeFilename(brandName: string): string {
    const slug = brandName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug || "sitio"}-theme.json`;
}

// Parses a theme JSON file into a full SiteConfig (merged over defaults).
// Throws when the text is not valid JSON.
export function parseThemeJson(text: string): SiteConfig {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("El archivo no contiene JSON valido.");
    }
    return mergeSiteConfig(parsed);
}
