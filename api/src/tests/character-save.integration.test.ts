import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    createCharacterFixture,
    ensureApiReady,
    getCharacterBankAndSpells,
    getCharacterHomeState,
    getCharacterState,
    patchCharacter,
    putCharacterBank,
    putCharacterItems,
    putCharacterSpells,
    putCharacterStorage,
    requestJson,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("character_save patches top-level fields and nested items", async () => {
    const owner = await createCharacterFixture({
        namePrefix: "Save",
        gold: 100,
        items: [{ idPos: 1, idItem: 1, cant: 1, equipped: false }],
    });

    await patchCharacter(owner.id, {
        gold: 777,
        level: 12,
        criminal: true,
        items: [{ idPos: 2, idItem: 474, cant: 3, equipped: true }],
        ignoredField: "should-pass-through-without-effect",
    });

    const state = await getCharacterState(
        owner.accountId,
        owner.id,
        owner.email,
    );
    assert.equal(state.gold, 777);
    assert.deepEqual(state.items, [
        { idPos: 2, idItem: 474, cant: 3, equipped: true },
    ]);

    const homeState = await getCharacterHomeState(
        owner.accountId,
        owner.id,
        owner.email,
    );
    assert.equal(homeState.homeMap, 1);
    assert.equal(homeState.homeX, 54);
    assert.equal(homeState.homeY, 60);
});

test("character_save patches custom home coordinates", async () => {
    const owner = await createCharacterFixture({ namePrefix: "Home" });

    await patchCharacter(owner.id, {
        homeMap: 62,
        homeX: 74,
        homeY: 44,
    });

    const state = await getCharacterHomeState(
        owner.accountId,
        owner.id,
        owner.email,
    );
    assert.equal(state.homeMap, 62);
    assert.equal(state.homeX, 74);
    assert.equal(state.homeY, 44);
});

test("character_save items endpoint replaces inventory", async () => {
    const owner = await createCharacterFixture({
        namePrefix: "Item",
        items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });

    const response = await putCharacterItems(owner.id, [
        { idPos: 3, idItem: 2, cant: 5, equipped: false },
    ]);

    assert.equal(response.status, 200);
    const state = await getCharacterState(
        owner.accountId,
        owner.id,
        owner.email,
    );
    assert.deepEqual(state.items, [
        { idPos: 3, idItem: 2, cant: 5, equipped: false },
    ]);
});

test("character_save items endpoint rejects invalid inventory slots", async () => {
    const owner = await createCharacterFixture({ namePrefix: "BadInv" });

    const response = await putCharacterItems(owner.id, [
        { idPos: 0, idItem: 474, cant: 1, equipped: false },
    ]);

    assert.equal(response.status, 400);
});

test("character_save bank and spells endpoints persist their collections", async () => {
    const owner = await createCharacterFixture({ namePrefix: "Bank" });

    const bankResponse = await putCharacterBank(owner.id, [
        { idPos: 1, idItem: 474, cant: 10 },
        { idPos: 5, idItem: 2, cant: 1 },
    ]);
    const spellsResponse = await putCharacterSpells(owner.id, [
        { idPos: 0, idSpell: 7 },
        { idPos: 2, idSpell: 9 },
    ]);

    assert.equal(bankResponse.status, 200);
    assert.equal(spellsResponse.status, 200);

    const state = await getCharacterBankAndSpells(owner.id);
    assert.deepEqual(state.bankItems, [
        { idPos: 1, idItem: 474, cant: 10 },
        { idPos: 5, idItem: 2, cant: 1 },
    ]);
    assert.deepEqual(state.spells, [
        { idPos: 0, idSpell: 7 },
        { idPos: 2, idSpell: 9 },
    ]);
});

test("character_save bank endpoint rejects invalid bank slots", async () => {
    const owner = await createCharacterFixture({ namePrefix: "BadBank" });

    const response = await putCharacterBank(owner.id, [
        { idPos: 101, idItem: 474, cant: 1 },
    ]);

    assert.equal(response.status, 400);
});

test("character_save storage updates items and bank atomically", async () => {
    const owner = await createCharacterFixture({
        namePrefix: "Stor",
        items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });
    await putCharacterBank(owner.id, [{ idPos: 1, idItem: 474, cant: 2 }]);

    const beforeCharacter = await getCharacterState(
        owner.accountId,
        owner.id,
        owner.email,
    );
    const beforeCollections = await getCharacterBankAndSpells(owner.id);

    const invalid = await putCharacterStorage(owner.id, {
        items: [{ idPos: 9, idItem: 2, cant: 4, equipped: false }],
        bankItems: [{ idPos: 2, idItem: -1, cant: 1 }],
    });

    assert.equal(invalid.status, 400);
    assert.deepEqual(
        await getCharacterState(owner.accountId, owner.id, owner.email),
        beforeCharacter,
    );
    assert.deepEqual(
        await getCharacterBankAndSpells(owner.id),
        beforeCollections,
    );
});

test("character_save returns 404 for missing characters", async () => {
    const response = await requestJson<{ error?: string }>(
        "/character_save/not-a-uuid",
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization:
                    process.env.API_TEST_AUTH ||
                    process.env.TOKEN_AUTH ||
                    "changeme",
            },
            body: JSON.stringify({ gold: 1 }),
        },
    );

    assert.equal(response.status, 404);
    assert.equal(response.data.error, "Character not found");
});
