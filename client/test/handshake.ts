// Handshake smoke test (not shipped): logs in via the API, grabs a game
// ticket, opens the game websocket, sends the connect packet and logs
// incoming server packets for a few seconds.
import {
    createConnectCharacterPacket,
    createDialogPacket,
    createPositionPacket,
    normalizeSocketMessageData,
    parseServerFrame,
} from "../src/lib/aowProtocol";

const API = process.env.AO_API ?? "http://127.0.0.1:3001";
const WS = "ws://127.0.0.1:7666";

async function main() {
    // login
    const loginRes = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            identifier: "vanillatest",
            password: "testpass123",
        }),
    });
    if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
    const cookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];
    console.log("[test] logged in, cookie:", cookie.split("=")[0]);

    // select the character (login may not carry a selection)
    const session = (await loginRes.json()) as any;
    const characterId = session.characters[0]?._id;
    if (!characterId) throw new Error("no characters on account");
    const selectRes = await fetch(`${API}/api/auth/select-character`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ characterId }),
    });
    if (!selectRes.ok) throw new Error(`select failed: ${selectRes.status}`);
    const selectCookie = (selectRes.headers.get("set-cookie") ?? "").split(
        ";",
    )[0];
    const finalCookie = selectCookie || cookie;
    console.log("[test] selected character:", characterId);

    // ticket
    const ticketRes = await fetch(`${API}/api/auth/game-ticket`, {
        method: "POST",
        headers: { cookie: finalCookie },
    });
    if (!ticketRes.ok) throw new Error(`ticket failed: ${ticketRes.status}`);
    const { ticket, expiresAt } = (await ticketRes.json()) as any;
    console.log("[test] ticket:", ticket.slice(0, 12), "expires:", expiresAt);

    const ws = new WebSocket(WS);
    (ws as any).binaryType = "arraybuffer";

    const packetCounts = new Map<string, number>();
    let bytes = 0;

    ws.onopen = () => {
        console.log("[test] ws open, sending connect packet");
        ws.send(createConnectCharacterPacket({ ticket, typeGame: 1, idChar: 0 }));

        // exercise outgoing movement + chat after the world state arrives
        setTimeout(() => {
            console.log("[test] sending move (heading 2) + chat");
            ws.send(createPositionPacket(2, 1));
            ws.send(createDialogPacket("hola mundo"));
        }, 4000);
    };

    ws.onmessage = (event) => {
        void (async () => {
            try {
                const data = await normalizeSocketMessageData(
                    event.data as ArrayBuffer,
                );
                bytes += data.byteLength;
                for (const packet of parseServerFrame(data)) {
                    packetCounts.set(
                        packet.type,
                        (packetCounts.get(packet.type) ?? 0) + 1,
                    );
                    if (packetCounts.get(packet.type)! <= 2) {
                        console.log(
                            `[test] packet ${packet.type}:`,
                            JSON.stringify(packet.payload).slice(0, 300),
                        );
                    }
                }
            } catch (error) {
                console.log("[test] parse error:", String(error).slice(0, 120));
            }
        })();
    };

    ws.onerror = () => console.log("[test] ws error");
    ws.onclose = (event) =>
        console.log(`[test] ws closed code=${event.code} reason=${event.reason}`);

    await new Promise((resolve) => setTimeout(resolve, 12000));
    console.log("[test] packet counts:", Object.fromEntries(packetCounts));
    console.log("[test] total bytes:", bytes);
    ws.close();
    process.exit(0);
}

main().catch((error) => {
    console.error("[test] fatal:", error);
    process.exit(1);
});
