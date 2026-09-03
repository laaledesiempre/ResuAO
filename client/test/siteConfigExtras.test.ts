// Tests for the extended site config groups: fonts, music, messages,
// registration, and custom font CSS generation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_SITE_CONFIG,
    mergeSiteConfig,
    buildCustomFontCss,
    applySiteConfigTheme,
} from "../src/lib/siteConfig";

test("defaults include fonts/music/messages/registration groups", () => {
    const config = mergeSiteConfig(undefined);
    assert.deepEqual(config.fonts, { displayUrl: null, bodyUrl: null });
    assert.deepEqual(config.music, { url: null, autoplay: false, volume: 0.5 });
    assert.deepEqual(config.messages, {
        loginNotice: "",
        playWelcome: "",
        serverWelcome: [],
    });
    assert.deepEqual(config.registration, {
        enabled: true,
        requireEmail: true,
    });
});

test("merge keeps partial nested groups and ignores wrong types", () => {
    const config = mergeSiteConfig({
        music: { url: "/api/uploads/song.mp3", volume: 2, autoplay: "si" },
        registration: { enabled: false, requireEmail: "no" },
        messages: { loginNotice: "Server en mantenimiento" },
    });
    assert.equal(config.music.url, "/api/uploads/song.mp3");
    assert.equal(config.music.volume, 1); // clamped
    assert.equal(config.music.autoplay, false); // wrong type ignored
    assert.equal(config.registration.enabled, false);
    assert.equal(config.registration.requireEmail, true); // wrong type ignored
    assert.equal(config.messages.loginNotice, "Server en mantenimiento");
    assert.equal(config.messages.playWelcome, "");
});

test("merge accepts serverWelcome string arrays only", () => {
    const config = mergeSiteConfig({
        messages: { serverWelcome: ["Hola", 42, "Mundo", null] },
    });
    assert.deepEqual(config.messages.serverWelcome, ["Hola", "Mundo"]);

    const invalid = mergeSiteConfig({ messages: { serverWelcome: "Hola" } });
    assert.deepEqual(invalid.messages.serverWelcome, []);
});

test("buildCustomFontCss is empty without custom fonts", () => {
    assert.equal(buildCustomFontCss(DEFAULT_SITE_CONFIG), "");
});

test("buildCustomFontCss emits @font-face per configured font", () => {
    const css = buildCustomFontCss(
        mergeSiteConfig({
            fonts: {
                displayUrl: "/api/uploads/display.woff2",
                bodyUrl: "/api/uploads/body.woff2",
            },
        }),
    );
    assert.match(css, /font-family: "SiteDisplay"/);
    assert.match(css, /url\("\/api\/uploads\/display\.woff2"\)/);
    assert.match(css, /font-family: "SiteBody"/);
});

test("applySiteConfigTheme sets font vars only when fonts configured", () => {
    const calls: Array<[string, string]> = [];
    const target = {
        style: {
            setProperty: (name: string, value: string) => {
                calls.push([name, value]);
            },
        },
    };
    applySiteConfigTheme(DEFAULT_SITE_CONFIG, target);
    assert.equal(calls.some(([name]) => name === "--brand-font-display"), false);

    calls.length = 0;
    applySiteConfigTheme(
        mergeSiteConfig({ fonts: { displayUrl: "/api/uploads/d.woff2" } }),
        target,
    );
    const fontVar = calls.find(([name]) => name === "--brand-font-display");
    assert.ok(fontVar);
    assert.match(fontVar![1], /"SiteDisplay"/);
});
