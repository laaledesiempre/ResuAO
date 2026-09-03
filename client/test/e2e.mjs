// Headless end-to-end drive of the vanilla client via raw CDP.
// Flow: open login -> submit credentials -> characters view -> click Jugar
// -> wait for the game scene -> report console logs + DOM state + screenshot.
const DEBUG_PORT = 9222;
const BASE = "http://127.0.0.1:8080";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargetWs() {
    for (let i = 0; i < 30; i++) {
        try {
            const res = await fetch(
                `http://127.0.0.1:${DEBUG_PORT}/json/list`,
            );
            const targets = await res.json();
            const page = targets.find((t) => t.type === "page");
            if (page) return page.webSocketDebuggerUrl;
        } catch {
            // retry
        }
        await sleep(500);
    }
    throw new Error("chromium devtools not reachable");
}

function makeCdp(ws) {
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
        } else if (msg.method) {
            events.push(msg);
        }
    };
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const msgId = ++id;
            pending.set(msgId, { resolve, reject });
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });
    return { send, events };
}

async function evaluate(cdp, expression) {
    const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        throw new Error(
            `eval failed: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`,
        );
    }
    return result.result?.value;
}

async function main() {
    const wsUrl = await getTargetWs();
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));
    const cdp = makeCdp(ws);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    console.log("[e2e] navigating to login");
    await cdp.send("Page.navigate", { url: `${BASE}/#/login` });
    await sleep(3000);

    const hasLoginForm = await evaluate(
        cdp,
        `Boolean(document.querySelector('input[autocomplete="username"]'))`,
    );
    console.log("[e2e] login form present:", hasLoginForm);

    console.log("[e2e] submitting login");
    await evaluate(
        cdp,
        `(() => {
            const u = document.querySelector('input[autocomplete="username"]');
            const p = document.querySelector('input[type="password"]');
            u.value = 'vanillatest';
            p.value = 'testpass123';
            u.dispatchEvent(new Event('input', { bubbles: true }));
            p.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            return true;
        })()`,
    );
    await sleep(3000);
    console.log(
        "[e2e] hash after login:",
        await evaluate(cdp, `location.hash`),
    );

    // select the first character card if none selected, then click Jugar
    const clicked = await evaluate(
        cdp,
        `(() => {
            const cards = [...document.querySelectorAll('.char-card')];
            if (cards.length && !document.querySelector('.char-card.selected')) {
                cards[0].click();
                return 'selected-card';
            }
            return cards.length ? 'already-selected' : 'no-cards';
        })()`,
    );
    console.log("[e2e] character selection:", clicked);
    await sleep(1500);

    const playClicked = await evaluate(
        cdp,
        `(() => {
            const buttons = [...document.querySelectorAll('button')];
            const play = buttons.find(b => b.textContent.trim() === 'Jugar');
            if (!play || play.disabled) return 'missing-or-disabled';
            play.click();
            return 'clicked';
        })()`,
    );
    console.log("[e2e] play button:", playClicked);

    // wait for the game to boot (scene ready / loading overlay hidden)
    let state = null;
    for (let i = 0; i < 24; i++) {
        await sleep(2500);
        state = await evaluate(
            cdp,
            `(() => {
                const overlay = document.querySelector('.loading-overlay');
                const canvas = document.querySelector('.game-canvas-wrap canvas');
                const chatLines = document.querySelectorAll('.chat-log .line').length;
                const hud = document.querySelector('.hud-row')?.textContent ?? '';
                return {
                    hash: location.hash,
                    overlayVisible: overlay ? getComputedStyle(overlay).display !== 'none' : false,
                    overlayText: overlay?.textContent?.trim()?.slice(0, 120) ?? null,
                    hasCanvas: Boolean(canvas),
                    canvasSize: canvas ? [canvas.width, canvas.height] : null,
                    chatLines,
                    hud: hud.slice(0, 200),
                };
            })()`,
        );
        console.log(`[e2e] t=${(i + 1) * 2.5}s`, JSON.stringify(state));
        if (state.hasCanvas && !state.overlayVisible && state.chatLines > 0) {
            break;
        }
    }

    // try walking + chatting via the exposed UI
    console.log("[e2e] sending chat message");
    await evaluate(
        cdp,
        `(() => {
            const input = document.querySelector('.chat-input-row input');
            input.value = 'hola desde e2e';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('.chat-input-row').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            return true;
        })()`,
    );
    await sleep(2500);

    // simulate movement with trusted key events (synthetic KeyboardEvents
    // are rejected by the client's anti-macro input checks)
    const keyParams = {
        code: "KeyW",
        key: "w",
        windowsVirtualKeyCode: 87,
        nativeVirtualKeyCode: 87,
    };
    await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        ...keyParams,
    });
    await sleep(1500);
    await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        ...keyParams,
    });
    await sleep(2000);

    const finalState = await evaluate(
        cdp,
        `(() => ({
            chat: [...document.querySelectorAll('.chat-log .line')].map(l => l.textContent).slice(-8),
            hud: document.querySelector('.hud-row')?.textContent ?? '',
        }))()`,
    );
    console.log("[e2e] final:", JSON.stringify(finalState, null, 1));

    const screenshot = await cdp.send("Page.captureScreenshot", {
        format: "png",
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/resu-e2e.png", Buffer.from(screenshot.data, "base64"));
    console.log("[e2e] screenshot saved to /tmp/resu-e2e.png");

    const consoleErrors = cdp.events
        .filter(
            (e) =>
                e.method === "Log.entryAdded" &&
                e.params.entry.level === "error",
        )
        .map((e) => e.params.entry.text.slice(0, 200));
    const exceptions = cdp.events
        .filter((e) => e.method === "Runtime.exceptionThrown")
        .map((e) => JSON.stringify(e.params.exceptionDetails).slice(0, 300));
    console.log("[e2e] console errors:", consoleErrors.slice(0, 10));
    console.log("[e2e] exceptions:", exceptions.slice(0, 10));

    ws.close();
    process.exit(0);
}

main().catch((error) => {
    console.error("[e2e] fatal:", error);
    process.exit(1);
});
