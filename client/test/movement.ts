// Movement probe: connect and try walking in all 4 directions.
import {
    createConnectCharacterPacket,
    createPositionPacket,
    normalizeSocketMessageData,
    parseServerFrame,
} from "../src/lib/aowProtocol";

const API = process.env.AO_API ?? "http://127.0.0.1:3001";
const WS = "ws://127.0.0.1:7666";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const loginRes = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            identifier: "vanillatest",
            password: "testpass123",
        }),
    });
    const cookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];
    const session = await loginRes.json();
    const selectRes = await fetch(`${API}/api/auth/select-character`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ characterId: session.characters[0]._id }),
    });
    const finalCookie =
        (selectRes.headers.get("set-cookie") ?? "").split(";")[0] || cookie;

    const ticketRes = await fetch(`${API}/api/auth/game-ticket`, {
        method: "POST",
        headers: { cookie: finalCookie },
    });
    const { ticket } = await ticketRes.json();

    const ws = new WebSocket(WS);
    ws.binaryType = "arraybuffer";

    ws.onmessage = (event) => {
        void (async () => {
            const data = await normalizeSocketMessageData(event.data);
            for (const packet of parseServerFrame(data)) {
                if (
                    packet.type === "actPositionServer" ||
                    packet.type === "getMyCharacter" ||
                    packet.type === "error" ||
                    packet.type === "console"
                ) {
                    console.log(
                        `[move] ${packet.type}:`,
                        JSON.stringify(packet.payload).slice(0, 200),
                    );
                }
            }
        })();
    };

    await new Promise((r) => (ws.onopen = r));
    ws.send(createConnectCharacterPacket({ ticket, typeGame: 1, idChar: 0 }));
    await sleep(3000);

    let moveId = 1;
    for (const heading of [4, 3, 2, 1, 2, 4]) {
        console.log(`[move] sending heading ${heading} moveId ${moveId}`);
        ws.send(createPositionPacket(heading, moveId++));
        await sleep(1200);
    }

    await sleep(1500);
    ws.close();
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
