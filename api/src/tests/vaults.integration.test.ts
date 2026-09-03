import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    createCharacterFixture,
    createClanFixture,
    ensureApiReady,
    getAccountVaultState,
    getCharacterState,
    getClanVaultState,
    putAccountVault,
    putClanVault,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("account vault rejects invalid payloads and preserves state", async () => {
    const owner = await createCharacterFixture({
        namePrefix: "Acct",
        gold: 900,
        items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });

    const initialPut = await putAccountVault(owner.accountId, {
        characterId: owner.id,
        characterGold: 700,
        characterItems: [{ idPos: 1, idItem: 1, cant: 1, equipped: false }],
        gold: 200,
        items: [{ idPos: 1, idItem: 474, cant: 1 }],
    });

    assert.equal(initialPut.ok, true, JSON.stringify(initialPut.data));

    const baselineVault = await getAccountVaultState(owner.accountId);
    const baselineCharacter = await getCharacterState(
        owner.accountId,
        owner.id,
        owner.email,
    );

    const invalidGold = await putAccountVault(owner.accountId, {
        gold: -1,
    });
    assert.equal(invalidGold.status, 400);

    const duplicateVaultSlots = await putAccountVault(owner.accountId, {
        items: [
            { idPos: 2, idItem: 1, cant: 1 },
            { idPos: 2, idItem: 474, cant: 1 },
        ],
    });
    assert.equal(duplicateVaultSlots.status, 400);

    const duplicateCharacterSlots = await putAccountVault(owner.accountId, {
        characterId: owner.id,
        characterItems: [
            { idPos: 1, idItem: 1, cant: 1, equipped: false },
            { idPos: 1, idItem: 474, cant: 1, equipped: false },
        ],
    });
    assert.equal(duplicateCharacterSlots.status, 400);

    assert.deepEqual(
        await getAccountVaultState(owner.accountId),
        baselineVault,
    );
    assert.deepEqual(
        await getCharacterState(owner.accountId, owner.id, owner.email),
        baselineCharacter,
    );
});

test("account vault rejects foreign character ownership and stays atomic", async () => {
    const owner = await createCharacterFixture({
        namePrefix: "Ownr",
        gold: 1000,
        items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });
    const intruder = await createCharacterFixture({
        namePrefix: "Intr",
        gold: 555,
        items: [{ idPos: 1, idItem: 474, cant: 1, equipped: false }],
    });

    const seedResponse = await putAccountVault(owner.accountId, {
        characterId: owner.id,
        characterGold: 750,
        characterItems: [{ idPos: 1, idItem: 1, cant: 1, equipped: false }],
        gold: 250,
        items: [{ idPos: 3, idItem: 2, cant: 4 }],
    });
    assert.equal(seedResponse.ok, true, JSON.stringify(seedResponse.data));

    const ownerBefore = await getCharacterState(
        owner.accountId,
        owner.id,
        owner.email,
    );
    const intruderBefore = await getCharacterState(
        intruder.accountId,
        intruder.id,
        intruder.email,
    );
    const vaultBefore = await getAccountVaultState(owner.accountId);

    const attackResponse = await putAccountVault(owner.accountId, {
        characterId: intruder.id,
        characterGold: 1,
        characterItems: [{ idPos: 1, idItem: 2, cant: 99, equipped: false }],
        gold: 999999,
        items: [{ idPos: 8, idItem: 474, cant: 99 }],
    });

    assert.equal(attackResponse.status, 400);
    assert.match(
        String((attackResponse.data as { error?: string }).error ?? ""),
        /no pertenece a esa cuenta/i,
    );

    assert.deepEqual(await getAccountVaultState(owner.accountId), vaultBefore);
    assert.deepEqual(
        await getCharacterState(owner.accountId, owner.id, owner.email),
        ownerBefore,
    );
    assert.deepEqual(
        await getCharacterState(
            intruder.accountId,
            intruder.id,
            intruder.email,
        ),
        intruderBefore,
    );
});

test("account vault repeated identical requests are idempotent", async () => {
    const owner = await createCharacterFixture({
        namePrefix: "Idem",
        gold: 1000,
        items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });
    const payload = {
        characterId: owner.id,
        characterGold: 600,
        characterItems: [{ idPos: 5, idItem: 1, cant: 1, equipped: false }],
        gold: 400,
        items: [
            { idPos: 7, idItem: 474, cant: 1 },
            { idPos: 9, idItem: 2, cant: 3 },
        ],
    };

    const first = await putAccountVault(owner.accountId, payload);
    const second = await putAccountVault(owner.accountId, payload);
    assert.equal(first.ok, true, JSON.stringify(first.data));
    assert.equal(second.ok, true, JSON.stringify(second.data));

    assert.deepEqual(await getAccountVaultState(owner.accountId), {
        gold: 400,
        items: [
            { idPos: 7, idItem: 474, cant: 1 },
            { idPos: 9, idItem: 2, cant: 3 },
        ],
    });
    assert.deepEqual(
        await getCharacterState(owner.accountId, owner.id, owner.email),
        {
            gold: 600,
            clanId: null,
            items: [{ idPos: 5, idItem: 1, cant: 1, equipped: false }],
        },
    );
});

test("clan vault rejects outsider character ownership and preserves clan state", async () => {
    const { clanId, leader, outsider } = await createClanFixture();

    const seed = await putClanVault(clanId, {
        characterId: leader.id,
        characterGold: 50,
        characterItems: [{ idPos: 1, idItem: 1, cant: 1, equipped: false }],
        gold: 450,
        items: [{ idPos: 4, idItem: 474, cant: 1 }],
    });
    assert.equal(seed.ok, true, JSON.stringify(seed.data));

    const vaultBefore = await getClanVaultState(clanId);
    const outsiderBefore = await getCharacterState(
        outsider.accountId,
        outsider.id,
        outsider.email,
    );

    const attack = await putClanVault(clanId, {
        characterId: outsider.id,
        characterGold: 1,
        characterItems: [{ idPos: 1, idItem: 474, cant: 99, equipped: false }],
        gold: 999,
        items: [{ idPos: 9, idItem: 2, cant: 99 }],
    });

    assert.equal(attack.status, 400);
    assert.match(
        String((attack.data as { error?: string }).error ?? ""),
        /no pertenece a ese clan/i,
    );

    assert.deepEqual(await getClanVaultState(clanId), vaultBefore);
    assert.deepEqual(
        await getCharacterState(
            outsider.accountId,
            outsider.id,
            outsider.email,
        ),
        outsiderBefore,
    );
});

test("clan vault repeated identical requests are idempotent and replace semantics remove omitted slots", async () => {
    const { clanId, leader } = await createClanFixture();
    const initialPayload = {
        characterId: leader.id,
        characterGold: 25,
        characterItems: [{ idPos: 6, idItem: 1, cant: 1, equipped: false }],
        gold: 475,
        items: [
            { idPos: 1, idItem: 1, cant: 1 },
            { idPos: 2, idItem: 474, cant: 1 },
        ],
    };

    const first = await putClanVault(clanId, initialPayload);
    const second = await putClanVault(clanId, initialPayload);
    assert.equal(first.ok, true, JSON.stringify(first.data));
    assert.equal(second.ok, true, JSON.stringify(second.data));

    assert.deepEqual(await getClanVaultState(clanId), {
        gold: 475,
        items: [
            { idPos: 1, idItem: 1, cant: 1 },
            { idPos: 2, idItem: 474, cant: 1 },
        ],
    });

    const replace = await putClanVault(clanId, {
        items: [{ idPos: 2, idItem: 474, cant: 1 }],
        gold: 475,
    });
    assert.equal(replace.ok, true, JSON.stringify(replace.data));

    assert.deepEqual(await getClanVaultState(clanId), {
        gold: 475,
        items: [{ idPos: 2, idItem: 474, cant: 1 }],
    });
});

test("vault endpoints reject malformed owner ids", async () => {
    const accountResponse = await putAccountVault("not-a-uuid", { gold: 1 });
    const clanResponse = await putClanVault("not-a-uuid", { gold: 1 });

    assert.equal(accountResponse.status, 400);
    assert.equal(clanResponse.status, 400);
});
