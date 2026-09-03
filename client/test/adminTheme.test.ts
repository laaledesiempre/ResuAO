// Unit tests for the admin theme helpers (src/lib/adminTheme.ts).
// Run with: npm test (bundles with esbuild, then `node --test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SITE_CONFIG } from "../src/lib/siteConfig";
import {
    isHexColor,
    parseThemeJson,
    themeFilename,
    validateSiteConfigDraft,
} from "../src/lib/adminTheme";

test("isHexColor accepts #rgb and #rrggbb, rejects the rest", () => {
    assert.equal(isHexColor("#c8a44d"), true);
    assert.equal(isHexColor("#FFF"), true);
    assert.equal(isHexColor("#123abF"), true);
    assert.equal(isHexColor("c8a44d"), false);
    assert.equal(isHexColor("#12345"), false);
    assert.equal(isHexColor("#1234567"), false);
    assert.equal(isHexColor("#gggggg"), false);
    assert.equal(isHexColor(""), false);
});

test("validateSiteConfigDraft returns null for the default config", () => {
    assert.equal(validateSiteConfigDraft(structuredClone(DEFAULT_SITE_CONFIG)), null);
});

test("validateSiteConfigDraft rejects an empty brand name", () => {
    const draft = structuredClone(DEFAULT_SITE_CONFIG);
    draft.brandName = "   ";
    assert.match(validateSiteConfigDraft(draft) ?? "", /marca/);
});

test("validateSiteConfigDraft rejects invalid colors and names the field", () => {
    const draft = structuredClone(DEFAULT_SITE_CONFIG);
    draft.colors.accent = "dorado";
    assert.match(validateSiteConfigDraft(draft) ?? "", /Acento/);
    draft.colors.accent = "#c8a44d";
    draft.colors.panel = "#12345";
    assert.match(validateSiteConfigDraft(draft) ?? "", /Panel/);
});

test("themeFilename slugifies the brand name", () => {
    assert.equal(themeFilename("Resu"), "resu-theme.json");
    assert.equal(themeFilename("Mi Reino AO!"), "mi-reino-ao-theme.json");
    assert.equal(themeFilename("  --  "), "sitio-theme.json");
    assert.equal(themeFilename("Café León"), "cafe-leon-theme.json");
});

test("parseThemeJson merges a partial theme over defaults", () => {
    const config = parseThemeJson(
        JSON.stringify({ brandName: "Mi AO", colors: { accent: "#ff0000" } }),
    );
    assert.equal(config.brandName, "Mi AO");
    assert.equal(config.colors.accent, "#ff0000");
    assert.equal(config.colors.bg, DEFAULT_SITE_CONFIG.colors.bg);
    assert.equal(config.texts.footer, DEFAULT_SITE_CONFIG.texts.footer);
});

test("parseThemeJson throws on invalid JSON", () => {
    assert.throws(() => parseThemeJson("not json {"), /JSON/);
    assert.throws(() => parseThemeJson(""), /JSON/);
});

test("parseThemeJson tolerates non-object JSON by falling back to defaults", () => {
    assert.deepEqual(parseThemeJson("42"), DEFAULT_SITE_CONFIG);
    assert.deepEqual(parseThemeJson("[1,2,3]"), DEFAULT_SITE_CONFIG);
});
