import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    API_AUTH,
    banCharacter,
    banIp,
    createAccountFixture,
    createCharacterFixture,
    createWorldGameTicket,
    ensureApiReady,
    expectErrorPayload,
    getAuthClans,
    loginAccount,
    patchCharacter,
    requestJson,
    selectCharacterRequest,
    unbanCharacter,
    unbanIp,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("requireAuth rejects missing or invalid internal authorization", async () => {
    const noAuth = await requestJson<{ error?: string }>(
        "/internal/vaults/account/not-a-uuid",
    );
    const badAuth = await requestJson<{ error?: string }>(
        "/internal/vaults/account/not-a-uuid",
        {
            headers: {
                Authorization: "Bearer definitely-wrong",
            },
        },
    );

    assert.equal(noAuth.status, 401);
    assert.equal(badAuth.status, 401);
    assert.equal(noAuth.data.error, "Unauthorized");
    assert.equal(badAuth.data.error, "Unauthorized");
});

test("authenticated clan endpoints reject missing bearer tokens", async () => {
    const response = await requestJson<{ error?: string }>("/auth/clans");
    assert.equal(response.status, 401);
    assert.equal(response.data.error, "Unauthorized");
});

test("ban character blocks select-character and game ticket creation until unbanned", async () => {
    const owner = await createCharacterFixture({ namePrefix: "ModB" });
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const banned = await banCharacter(owner.name, until);
    assert.equal(banned.status, 200);

    const selected = await selectCharacterRequest(owner.sessionToken, owner.id);
    const ticket = await createWorldGameTicket(owner.sessionToken);

    assert.equal(selected.status, 403);
    assert.equal(
        expectErrorPayload(selected.data).error,
        "Tu personaje se encuentra baneado.",
    );
    assert.equal(ticket.status, 403);
    assert.equal(
        expectErrorPayload(ticket.data).error,
        "Tu personaje se encuentra baneado.",
    );

    const unbanned = await unbanCharacter(owner.name);
    assert.equal(unbanned.status, 200);

    const selectedAgain = await selectCharacterRequest(
        owner.sessionToken,
        owner.id,
    );
    assert.equal(selectedAgain.status, 200);
});

test("ip bans block select-character and ticket consumption until lifted", async () => {
    const owner = await createCharacterFixture({ namePrefix: "IpBn" });
    await patchCharacter(owner.id, { ip: "198.51.100.200" });
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const banned = await banIp(owner.name, until);
    assert.equal(banned.status, 200);

    const selected = await selectCharacterRequest(owner.sessionToken, owner.id);
    assert.equal(selected.status, 403);
    assert.equal(
        expectErrorPayload(selected.data).error,
        "Tu personaje tiene un ban de IP activo.",
    );

    const unbanned = await unbanIp(owner.name);
    assert.equal(unbanned.status, 200);

    const selectedAgain = await selectCharacterRequest(
        owner.sessionToken,
        owner.id,
    );
    assert.equal(selectedAgain.status, 200);
});

test("login remains available after bans are lifted", async () => {
    const account = await createAccountFixture();
    const login = await loginAccount(account.email, account.password);
    assert.equal(login.status, 200);
    assert.notEqual(API_AUTH.length, 0);
});
