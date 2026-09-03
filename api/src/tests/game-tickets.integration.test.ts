import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    consumeGameTicket,
    countGameTickets,
    createAccountFixture,
    createCharacterFixture,
    createWorldGameTicket,
    ensureApiReady,
    logoutSession,
    patchCharacter,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("world ticket creation requires a selected character", async () => {
    const account = await createAccountFixture();

    const response = await createWorldGameTicket(account.session.sessionToken);

    assert.equal(response.status, 400);
    assert.equal(
        (response.data as { error?: string }).error,
        "No hay un personaje seleccionado",
    );
});

test("world tickets can be consumed once", async () => {
    const owner = await createCharacterFixture({ namePrefix: "Tick" });

    const created = await createWorldGameTicket(owner.sessionToken);
    assert.equal(created.status, 200);
    const ticket = (created.data as { ticket: string }).ticket;
    assert.ok(ticket, "No se devolvió ticket");

    const consumed = await consumeGameTicket(ticket, "198.51.100.10");
    const consumedAgain = await consumeGameTicket(ticket, "198.51.100.10");

    assert.equal(consumed.status, 200);
    assert.equal(
        (consumed.data as { account?: { _id: string } }).account?._id,
        owner.accountId,
    );
    assert.equal(consumedAgain.status, 404);
    assert.equal(
        (consumedAgain.data as { error?: string }).error,
        "Game ticket invalido",
    );
});

test("logout removes pending world tickets", async () => {
    const owner = await createCharacterFixture({ namePrefix: "OutT" });

    const created = await createWorldGameTicket(owner.sessionToken);
    assert.equal(created.status, 200);
    assert.equal(await countGameTickets(owner.accountId), 1);

    const logout = await logoutSession(owner.sessionToken);
    assert.equal(logout.status, 200);
    assert.equal(await countGameTickets(owner.accountId), 0);
});

test("banned characters cannot create world tickets", async () => {
    const owner = await createCharacterFixture({ namePrefix: "BanT" });

    await patchCharacter(owner.id, {
        banned: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await createWorldGameTicket(owner.sessionToken);

    assert.equal(response.status, 403);
    assert.equal(
        (response.data as { error?: string }).error,
        "Tu personaje se encuentra baneado.",
    );
});

test("consume rejects malformed payloads without a ticket", async () => {
    const response = await consumeGameTicket("", "198.51.100.11");

    assert.equal(response.status, 400);
    assert.equal(
        (response.data as { error?: string }).error,
        "ticket es requerido",
    );
});
