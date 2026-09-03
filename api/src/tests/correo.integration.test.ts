import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    API_AUTH,
    createCharacterFixture,
    ensureApiReady,
    requestJson,
} from "./helpers/api";

type CorreoMessage = {
    id: string;
    remitente: string;
    mensaje: string;
    item: string;
    itemCount: number;
    leido: boolean;
    fecha: string;
};

function correoHeaders() {
    return {
        Authorization: API_AUTH,
        "Content-Type": "application/json",
    };
}

async function listCorreo(characterId: string) {
    return requestJson<{ mensajes?: CorreoMessage[]; error?: string }>(
        `/internal/correo/${encodeURIComponent(characterId)}`,
        { headers: { Authorization: API_AUTH } },
    );
}

beforeAll(async () => {
    await ensureApiReady();
});

test("correo roundtrip enviar, listar, marcar leido y borrar", async () => {
    const emisor = await createCharacterFixture({ namePrefix: "Corr" });
    const receptor = await createCharacterFixture({ namePrefix: "Corr" });

    const sent = await requestJson<{ status?: string; error?: string }>(
        "/internal/correo",
        {
            method: "POST",
            headers: correoHeaders(),
            body: JSON.stringify({
                recipientName: receptor.name,
                remitente: emisor.name,
                mensaje: "Hola, te escribo desde el correo.",
                item: "",
                itemCount: 0,
                fecha: "03/09/2026 - 18:30:45",
            }),
        },
    );
    assert.equal(sent.ok, true, JSON.stringify(sent.data));
    assert.equal(sent.data.status, "sent");

    const unread = await requestJson<{ unread?: number }>(
        `/internal/correo/${encodeURIComponent(receptor.id)}/unread`,
        { headers: { Authorization: API_AUTH } },
    );
    assert.equal(Number(unread.data.unread), 1);

    const list = await listCorreo(receptor.id);
    assert.equal(list.ok, true, JSON.stringify(list.data));
    assert.equal(list.data.mensajes?.length, 1);
    const mensaje = list.data.mensajes?.[0];
    assert.equal(mensaje?.remitente, emisor.name);
    assert.equal(mensaje?.mensaje, "Hola, te escribo desde el correo.");
    assert.equal(mensaje?.leido, false);
    assert.equal(mensaje?.fecha, "03/09/2026 - 18:30:45");

    const read = await requestJson<{ ok?: boolean }>(
        `/internal/correo/${encodeURIComponent(receptor.id)}/read`,
        { method: "POST", headers: { Authorization: API_AUTH } },
    );
    assert.equal(read.ok, true, JSON.stringify(read.data));

    const unreadAfter = await requestJson<{ unread?: number }>(
        `/internal/correo/${encodeURIComponent(receptor.id)}/unread`,
        { headers: { Authorization: API_AUTH } },
    );
    assert.equal(Number(unreadAfter.data.unread), 0);

    const deleted = await requestJson<{ deleted?: boolean }>(
        `/internal/correo/${encodeURIComponent(receptor.id)}/${encodeURIComponent(mensaje!.id)}`,
        { method: "DELETE", headers: { Authorization: API_AUTH } },
    );
    assert.equal(deleted.ok, true, JSON.stringify(deleted.data));
    assert.equal(deleted.data.deleted, true);

    const listAfter = await listCorreo(receptor.id);
    assert.equal(listAfter.data.mensajes?.length, 0);
});

test("correo destinatario inexistente y buzon lleno (60 mensajes, VB6 MAX_CORREOS_SLOTS)", async () => {
    const emisor = await createCharacterFixture({ namePrefix: "Corr" });
    const receptor = await createCharacterFixture({ namePrefix: "Corr" });

    const notFound = await requestJson<{ status?: string }>(
        "/internal/correo",
        {
            method: "POST",
            headers: correoHeaders(),
            body: JSON.stringify({
                recipientName: "No Existe Nadie",
                remitente: emisor.name,
                mensaje: "Mensaje a nadie.",
                item: "",
                itemCount: 0,
                fecha: "03/09/2026 - 18:30:45",
            }),
        },
    );
    assert.equal(notFound.data.status, "not_found");

    for (let i = 0; i < 60; i++) {
        const result = await requestJson<{ status?: string }>(
            "/internal/correo",
            {
                method: "POST",
                headers: correoHeaders(),
                body: JSON.stringify({
                    recipientName: receptor.name,
                    remitente: emisor.name,
                    mensaje: `Mensaje ${i + 1}`,
                    item: "",
                    itemCount: 0,
                    fecha: "03/09/2026 - 18:30:45",
                }),
            },
        );
        assert.equal(result.data.status, "sent", JSON.stringify(result.data));
    }

    const full = await requestJson<{ status?: string }>("/internal/correo", {
        method: "POST",
        headers: correoHeaders(),
        body: JSON.stringify({
            recipientName: receptor.name,
            remitente: emisor.name,
            mensaje: "Uno mas.",
            item: "",
            itemCount: 0,
            fecha: "03/09/2026 - 18:30:45",
        }),
    });
    assert.equal(full.data.status, "full");

    const list = await listCorreo(receptor.id);
    assert.equal(list.data.mensajes?.length, 60);
});
