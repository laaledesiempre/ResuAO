// Headless check of the create-character view: login, open the view,
// verify the preview canvas paints and the head cycler works, then create
// a character via the UI and confirm we land back on /characters.
const DEBUG_PORT = 9222;
const BASE = "http://127.0.0.1:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargetWs() {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const page = (await res.json()).find((t) => t.type === "page");
    return page.webSocketDebuggerUrl;
}

function makeCdp(ws) {
    let id = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
        }
    };
    return (method, params = {}) =>
        new Promise((resolve, reject) => {
            const msgId = ++id;
            pending.set(msgId, { resolve, reject });
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });
}

async function evaluate(send, expression) {
    const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        throw new Error(
            JSON.stringify(result.exceptionDetails).slice(0, 300),
        );
    }
    return result.result?.value;
}

async function main() {
    const ws = new WebSocket(await getTargetWs());
    await new Promise((r) => (ws.onopen = r));
    const send = makeCdp(ws);
    await send("Page.enable");
    await send("Runtime.enable");

    await send("Page.navigate", { url: `${BASE}/#/login` });
    await sleep(2500);
    await evaluate(
        send,
        `(() => {
            document.querySelector('input[autocomplete="username"]').value = 'vanillatest';
            document.querySelector('input[type="password"]').value = 'testpass123';
            document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            return true;
        })()`,
    );
    await sleep(2500);
    console.log("[cc] hash:", await evaluate(send, `location.hash`));

    await send("Page.navigate", { url: `${BASE}/#/create-character` });
    await sleep(4000);

    const state = await evaluate(
        send,
        `(() => {
            const canvas = document.querySelector('canvas');
            let painted = false;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 3; i < data.length; i += 4) {
                    if (data[i] !== 0) { painted = true; break; }
                }
            }
            return {
                hasCanvas: Boolean(canvas),
                painted,
                headLabel: [...document.querySelectorAll('span')].find(s => s.textContent.startsWith('Cabeza'))?.textContent ?? null,
                buttons: [...document.querySelectorAll('button')].length,
            };
        })()`,
    );
    console.log("[cc] state:", JSON.stringify(state));

    // cycle head next and re-check label
    const before = state.headLabel;
    await evaluate(
        send,
        `(() => {
            const buttons = [...document.querySelectorAll('button')];
            const next = buttons.find(b => b.textContent.trim() === '>');
            next.click();
            return true;
        })()`,
    );
    await sleep(1500);
    const after = await evaluate(
        send,
        `[...document.querySelectorAll('span')].find(s => s.textContent.startsWith('Cabeza'))?.textContent ?? null`,
    );
    console.log("[cc] head cycled:", before, "->", after);

    // pick elfo race + female to exercise dependent UI
    await evaluate(
        send,
        `(() => {
            const buttons = [...document.querySelectorAll('button')];
            buttons.find(b => b.textContent.trim() === 'Elfo')?.click();
            return true;
        })()`,
    );
    await sleep(800);
    await evaluate(
        send,
        `(() => {
            const buttons = [...document.querySelectorAll('button')];
            buttons.find(b => b.textContent.trim() === 'Femenino')?.click();
            return true;
        })()`,
    );
    await sleep(2000);

    // fill name and submit
    await evaluate(
        send,
        `(() => {
            const name = document.querySelector('input[maxlength]');
            name.value = 'ElficaTest';
            name.dispatchEvent(new Event('input', { bubbles: true }));
            const submit = [...document.querySelectorAll('button')].find(b => b.type === 'submit');
            submit.click();
            return true;
        })()`,
    );
    await sleep(4000);
    console.log("[cc] hash after create:", await evaluate(send, `location.hash`));
    const cards = await evaluate(
        send,
        `[...document.querySelectorAll('.char-card .char-name')].map(n => n.textContent)`,
    );
    console.log("[cc] characters:", JSON.stringify(cards));

    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/resu-cc.png", Buffer.from(screenshot.data, "base64"));
    ws.close();
    process.exit(0);
}

main().catch((e) => {
    console.error("[cc] fatal:", e);
    process.exit(1);
});
