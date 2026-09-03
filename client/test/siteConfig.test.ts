// Unit tests for the site branding config module (src/lib/siteConfig.ts).
// Run with: npm test (bundles with esbuild, then `node --test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_SITE_CONFIG,
    mergeSiteConfig,
    isDebugEnabled,
    applySiteConfigTheme,
} from "../src/lib/siteConfig";

test("DEFAULT_SITE_CONFIG has the full branding shape", () => {
    assert.equal(typeof DEFAULT_SITE_CONFIG.brandName, "string");
    assert.equal(typeof DEFAULT_SITE_CONFIG.tagline, "string");
    assert.equal(DEFAULT_SITE_CONFIG.logoUrl, null);
    assert.equal(DEFAULT_SITE_CONFIG.loginBackgroundUrl, null);
    assert.deepEqual(Object.keys(DEFAULT_SITE_CONFIG.colors).sort(), [
        "accent",
        "accentHover",
        "bg",
        "panel",
        "text",
    ]);
    for (const value of Object.values(DEFAULT_SITE_CONFIG.colors)) {
        assert.equal(typeof value, "string");
    }
    assert.deepEqual(Object.keys(DEFAULT_SITE_CONFIG.texts).sort(), [
        "footer",
        "loginSubtitle",
        "loginTitle",
        "welcome",
    ]);
    for (const value of Object.values(DEFAULT_SITE_CONFIG.texts)) {
        assert.equal(typeof value, "string");
    }
    assert.deepEqual(DEFAULT_SITE_CONFIG.debug, { showFpsPing: false });
});

test("mergeSiteConfig deep-merges a partial over defaults", () => {
    const merged = mergeSiteConfig({
        brandName: "Mi AO",
        colors: { accent: "#ff0000" },
        debug: { showFpsPing: true },
    });
    assert.equal(merged.brandName, "Mi AO");
    assert.equal(merged.tagline, DEFAULT_SITE_CONFIG.tagline);
    assert.equal(merged.colors.accent, "#ff0000");
    assert.equal(merged.colors.accentHover, DEFAULT_SITE_CONFIG.colors.accentHover);
    assert.equal(merged.colors.bg, DEFAULT_SITE_CONFIG.colors.bg);
    assert.equal(merged.texts.loginTitle, DEFAULT_SITE_CONFIG.texts.loginTitle);
    assert.equal(merged.debug.showFpsPing, true);
});

test("mergeSiteConfig ignores non-object input and returns defaults", () => {
    assert.deepEqual(mergeSiteConfig(null), DEFAULT_SITE_CONFIG);
    assert.deepEqual(mergeSiteConfig(undefined), DEFAULT_SITE_CONFIG);
    assert.deepEqual(mergeSiteConfig("brand" as unknown), DEFAULT_SITE_CONFIG);
    assert.deepEqual(mergeSiteConfig(42 as unknown), DEFAULT_SITE_CONFIG);
    assert.deepEqual(mergeSiteConfig([] as unknown), DEFAULT_SITE_CONFIG);
});

test("mergeSiteConfig ignores unknown keys", () => {
    const merged = mergeSiteConfig({
        hacker: true,
        colors: { accent: "#00ff00", evil: "x" },
        debug: { showFpsPing: true, extra: 1 },
    } as Record<string, unknown>);
    assert.equal(merged.colors.accent, "#00ff00");
    assert.ok(!("hacker" in merged));
    assert.ok(!("evil" in merged.colors));
    assert.ok(!("extra" in merged.debug));
});

test("mergeSiteConfig ignores wrong-typed values", () => {
    const merged = mergeSiteConfig({
        brandName: 123,
        logoUrl: 7,
        colors: { accent: false },
    } as Record<string, unknown>);
    assert.equal(merged.brandName, DEFAULT_SITE_CONFIG.brandName);
    assert.equal(merged.logoUrl, null);
    assert.equal(merged.colors.accent, DEFAULT_SITE_CONFIG.colors.accent);
});

test("isDebugEnabled honors config flag, query and localStorage", () => {
    const debugConfig = mergeSiteConfig({ debug: { showFpsPing: true } });
    assert.equal(isDebugEnabled(debugConfig, { query: "", localStorageValue: null }), true);
    assert.equal(
        isDebugEnabled(DEFAULT_SITE_CONFIG, { query: "?debug=1", localStorageValue: null }),
        true,
    );
    assert.equal(
        isDebugEnabled(DEFAULT_SITE_CONFIG, { query: "x=1&debug=1&y=2", localStorageValue: null }),
        true,
    );
    assert.equal(
        isDebugEnabled(DEFAULT_SITE_CONFIG, { query: "", localStorageValue: "1" }),
        true,
    );
    assert.equal(
        isDebugEnabled(DEFAULT_SITE_CONFIG, { query: "", localStorageValue: null }),
        false,
    );
    assert.equal(
        isDebugEnabled(DEFAULT_SITE_CONFIG, { query: "?debug=0", localStorageValue: "0" }),
        false,
    );
});

test("applySiteConfigTheme sets brand CSS custom properties and returns brandName", () => {
    const calls: Array<[string, string]> = [];
    const target = {
        style: {
            setProperty(name: string, value: string) {
                calls.push([name, value]);
            },
        },
    };
    const config = mergeSiteConfig({
        brandName: "Resu Custom",
        colors: { accent: "#123456" },
    });
    const brandName = applySiteConfigTheme(config, target);
    assert.equal(brandName, "Resu Custom");
    const map = new Map(calls);
    assert.equal(map.get("--brand-accent"), "#123456");
    assert.equal(map.get("--brand-accent-hover"), config.colors.accentHover);
    assert.equal(map.get("--brand-bg"), config.colors.bg);
    assert.equal(map.get("--brand-panel"), config.colors.panel);
    assert.equal(map.get("--brand-text"), config.colors.text);
    assert.equal(calls.length, 5);
});
