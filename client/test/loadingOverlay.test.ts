// Deterministic unit tests for the loading overlay state machine.
// Regression: on a bootstrap error, setError wrote the message into the
// overlay and setIsLoading(false) immediately hid that same overlay,
// leaving the user with a fully black screen and no error message.
//
// Run with: npm test (bundles with esbuild, then `node --test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoadingOverlay } from "../src/views/loadingOverlay";

interface FakeElement {
    textContent: string;
    style: { width: string; display: string };
}

function makeOverlay() {
    const stage: FakeElement = { textContent: "", style: { width: "", display: "" } };
    const detail: FakeElement = { textContent: "", style: { width: "", display: "" } };
    const bar: FakeElement = { textContent: "", style: { width: "", display: "" } };
    const root: FakeElement = { textContent: "", style: { width: "", display: "" } };
    const overlay = createLoadingOverlay({ root, stage, detail, bar });
    return { overlay, root, stage, detail, bar };
}

test("progress updates stage, detail and bar while loading", () => {
    const { overlay, stage, detail, bar } = makeOverlay();
    overlay.progress("Renderizando mundo", 72, "Creando canvas...");
    assert.equal(stage.textContent, "Renderizando mundo");
    assert.equal(detail.textContent, "Creando canvas...");
    assert.equal(bar.style.width, "72%");
});

test("complete() hides the overlay on the happy path", () => {
    const { overlay, root } = makeOverlay();
    overlay.progress("Listo", 100, "");
    overlay.complete();
    assert.equal(root.style.display, "none");
});

test("error() keeps the overlay visible and shows the message", () => {
    const { overlay, root, stage, detail } = makeOverlay();
    overlay.error("WebGL no disponible");
    assert.equal(stage.textContent, "Error");
    assert.equal(detail.textContent, "WebGL no disponible");
    assert.notEqual(root.style.display, "none");
});

test("complete() after error() must NOT hide the overlay (black screen regression)", () => {
    const { overlay, root, detail } = makeOverlay();
    // Order matches rendererBootstrap's catch block:
    // setError(...) first, then setIsLoading(false) -> onLoadingDone.
    overlay.error("Failed to initialize");
    overlay.complete();
    assert.notEqual(root.style.display, "none");
    assert.equal(detail.textContent, "Failed to initialize");
});

test("error() reveals an overlay that was already hidden", () => {
    const { overlay, root, stage } = makeOverlay();
    overlay.complete();
    assert.equal(root.style.display, "none");
    overlay.error("Fallo tardío");
    assert.notEqual(root.style.display, "none");
    assert.equal(stage.textContent, "Error");
});
