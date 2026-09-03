import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import { listNpcSoldItemIds } from "../repositories/gameNpcs";
import { cancelForbiddenMarketListings } from "../repositories/market";
import {
    buyMarketListing,
    cancelMarketListing,
    claimMarket,
    createCharacterFixture,
    createMarketListing,
    ensureApiReady,
    expireMarketListing,
    getCharacterState,
    getMarketClaims,
    listMarketListings,
} from "./helpers/api";

async function getNpcSoldItemId(): Promise<number> {
    const itemId = (await listNpcSoldItemIds())[0];
    assert.ok(itemId, "No se encontró un item vendido por NPCs para la prueba");
    return itemId;
}

beforeAll(async () => {
    await ensureApiReady();
});

test("market roundtrip compra y reclamos acredita oro e item", async () => {
    const seller = await createCharacterFixture({
        namePrefix: "Sell",
        gold: 1000,
        items: [{ idPos: 1, idItem: 1, cant: 4, equipped: false }],
    });
    const buyer = await createCharacterFixture({
        namePrefix: "Buyr",
        gold: 2000,
        items: [],
    });

    const created = await createMarketListing({
        sellerCharacterId: seller.id,
        sellerName: seller.name,
        itemId: 1,
        quantity: 2,
        price: 600,
        publicationFee: 12,
        durationHours: 24,
        characterGold: 988,
        characterItems: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });

    assert.equal(created.ok, true, JSON.stringify(created.data));
    const listingId = created.data.listing?.id;
    assert.ok(listingId);

    const buy = await buyMarketListing({
        buyerCharacterId: buyer.id,
        buyerName: buyer.name,
        listingId,
        characterGold: 1400,
        characterItems: [],
    });
    assert.equal(buy.ok, true, JSON.stringify(buy.data));

    const sellerClaims = await getMarketClaims(seller.id);
    const buyerClaims = await getMarketClaims(buyer.id);
    assert.equal(sellerClaims.ok, true, JSON.stringify(sellerClaims.data));
    assert.equal(buyerClaims.ok, true, JSON.stringify(buyerClaims.data));

    assert.deepEqual(sellerClaims.data.claims, [
        {
            id: sellerClaims.data.claims[0]?.id,
            ownerCharacterId: seller.id,
            claimType: "gold",
            goldAmount: 600,
            itemId: 1,
            itemQuantity: 2,
            sourceListingId: listingId,
            createdAt: sellerClaims.data.claims[0]?.createdAt,
        },
    ]);
    assert.deepEqual(buyerClaims.data.claims, [
        {
            id: buyerClaims.data.claims[0]?.id,
            ownerCharacterId: buyer.id,
            claimType: "item",
            goldAmount: 0,
            itemId: 1,
            itemQuantity: 2,
            sourceListingId: listingId,
            createdAt: buyerClaims.data.claims[0]?.createdAt,
        },
    ]);

    const sellerClaimResult = await claimMarket(seller.id, {
        characterGold: 1588,
        characterItems: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });
    const buyerClaimResult = await claimMarket(buyer.id, {
        characterGold: 1400,
        characterItems: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });
    assert.equal(
        sellerClaimResult.ok,
        true,
        JSON.stringify(sellerClaimResult.data),
    );
    assert.equal(
        buyerClaimResult.ok,
        true,
        JSON.stringify(buyerClaimResult.data),
    );

    assert.deepEqual(
        await getCharacterState(seller.accountId, seller.id, seller.email),
        {
            gold: 1588,
            clanId: null,
            items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
        },
    );
    assert.deepEqual(
        await getCharacterState(buyer.accountId, buyer.id, buyer.email),
        {
            gold: 1400,
            clanId: null,
            items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
        },
    );

    const sellerClaimsAfter = await getMarketClaims(seller.id);
    const buyerClaimsAfter = await getMarketClaims(buyer.id);
    assert.deepEqual(sellerClaimsAfter.data.claims, []);
    assert.deepEqual(buyerClaimsAfter.data.claims, []);
});

test("market rechaza compra si la publicación no coincide con el item esperado", async () => {
    const seller = await createCharacterFixture({
        namePrefix: "Mism",
        gold: 1000,
        items: [{ idPos: 1, idItem: 1, cant: 2, equipped: false }],
    });
    const buyer = await createCharacterFixture({
        namePrefix: "Mbry",
        gold: 2000,
        items: [],
    });

    const created = await createMarketListing({
        sellerCharacterId: seller.id,
        sellerName: seller.name,
        itemId: 1,
        quantity: 2,
        price: 600,
        publicationFee: 12,
        durationHours: 24,
        characterGold: 988,
        characterItems: [],
    });

    assert.equal(created.ok, true, JSON.stringify(created.data));
    const listingId = created.data.listing?.id;
    assert.ok(listingId);

    const rejected = await buyMarketListing({
        buyerCharacterId: buyer.id,
        buyerName: buyer.name,
        listingId,
        expectedItemId: 2,
        expectedQuantity: 1,
        expectedPrice: 50,
        characterGold: 1400,
        characterItems: [],
    });

    assert.equal(rejected.ok, false, JSON.stringify(rejected.data));
    assert.match(String(rejected.data.error ?? ""), /publicación cambió/i);

    const listings = await listMarketListings({
        sellerCharacterId: seller.id,
        includeInactive: true,
        limit: 10,
    });
    assert.equal(listings.ok, true, JSON.stringify(listings.data));
    assert.equal(
        listings.data.listings.find((listing) => listing.id === listingId)
            ?.status,
        "active",
    );

    const sellerClaims = await getMarketClaims(seller.id);
    const buyerClaims = await getMarketClaims(buyer.id);
    assert.equal(sellerClaims.ok, true, JSON.stringify(sellerClaims.data));
    assert.equal(buyerClaims.ok, true, JSON.stringify(buyerClaims.data));
    assert.deepEqual(sellerClaims.data.claims, []);
    assert.deepEqual(buyerClaims.data.claims, []);

    assert.deepEqual(
        await getCharacterState(buyer.accountId, buyer.id, buyer.email),
        {
            gold: 2000,
            clanId: null,
            items: [],
        },
    );
});

test("market cancel devuelve el item por claim y limpia la publicación", async () => {
    const seller = await createCharacterFixture({
        namePrefix: "Cncl",
        gold: 1000,
        items: [{ idPos: 1, idItem: 1, cant: 3, equipped: false }],
    });

    const created = await createMarketListing({
        sellerCharacterId: seller.id,
        sellerName: seller.name,
        itemId: 1,
        quantity: 2,
        price: 700,
        publicationFee: 14,
        durationHours: 24,
        characterGold: 986,
        characterItems: [{ idPos: 1, idItem: 1, cant: 1, equipped: false }],
    });
    assert.equal(created.ok, true, JSON.stringify(created.data));
    const listingId = created.data.listing?.id;
    assert.ok(listingId);

    const cancel = await cancelMarketListing(listingId!, {
        sellerCharacterId: seller.id,
    });
    assert.equal(cancel.ok, true, JSON.stringify(cancel.data));

    const listings = await listMarketListings({
        sellerCharacterId: seller.id,
        includeInactive: true,
        limit: 10,
    });
    assert.equal(listings.ok, true, JSON.stringify(listings.data));
    assert.equal(listings.data.listings[0]?.status, "cancelled");

    const claims = await getMarketClaims(seller.id);
    assert.equal(claims.ok, true, JSON.stringify(claims.data));
    assert.equal(claims.data.claims.length, 1);
    assert.equal(claims.data.claims[0]?.claimType, "item");
    assert.equal(claims.data.claims[0]?.itemId, 1);
    assert.equal(claims.data.claims[0]?.itemQuantity, 2);

    const claimResult = await claimMarket(seller.id, {
        characterGold: 986,
        characterItems: [{ idPos: 1, idItem: 1, cant: 3, equipped: false }],
    });
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult.data));

    assert.deepEqual(
        await getCharacterState(seller.accountId, seller.id, seller.email),
        {
            gold: 986,
            clanId: null,
            items: [{ idPos: 1, idItem: 1, cant: 3, equipped: false }],
        },
    );
});

test("market expiración mueve la publicación activa a expirada y genera claim de devolución", async () => {
    const seller = await createCharacterFixture({
        namePrefix: "Expi",
        gold: 1000,
        items: [{ idPos: 1, idItem: 1, cant: 3, equipped: false }],
    });

    const created = await createMarketListing({
        sellerCharacterId: seller.id,
        sellerName: seller.name,
        itemId: 1,
        quantity: 2,
        price: 550,
        publicationFee: 11,
        durationHours: 24,
        characterGold: 989,
        characterItems: [{ idPos: 1, idItem: 1, cant: 1, equipped: false }],
    });
    assert.equal(created.ok, true, JSON.stringify(created.data));
    const listingId = created.data.listing?.id;
    assert.ok(listingId);

    await expireMarketListing(listingId!);

    const claims = await getMarketClaims(seller.id);
    assert.equal(claims.ok, true, JSON.stringify(claims.data));
    assert.equal(claims.data.claims.length, 1);
    assert.equal(claims.data.claims[0]?.claimType, "item");
    assert.equal(claims.data.claims[0]?.itemId, 1);
    assert.equal(claims.data.claims[0]?.itemQuantity, 2);

    const listings = await listMarketListings({
        sellerCharacterId: seller.id,
        includeInactive: true,
        limit: 10,
    });
    assert.equal(listings.ok, true, JSON.stringify(listings.data));
    assert.equal(
        listings.data.listings.find((listing) => listing.id === listingId)
            ?.status,
        "expired",
    );
});

test("market limpieza masiva cancela items vendidos por NPCs y reintegra comisión", async () => {
    const forbiddenItemId = await getNpcSoldItemId();
    const seller = await createCharacterFixture({
        namePrefix: "Npcm",
        gold: 1000,
        items: [
            { idPos: 1, idItem: forbiddenItemId, cant: 3, equipped: false },
        ],
    });

    const created = await createMarketListing({
        sellerCharacterId: seller.id,
        sellerName: seller.name,
        itemId: forbiddenItemId,
        quantity: 2,
        price: 700,
        publicationFee: 14,
        durationHours: 24,
        characterGold: 986,
        characterItems: [
            { idPos: 1, idItem: forbiddenItemId, cant: 1, equipped: false },
        ],
    });
    assert.equal(created.ok, true, JSON.stringify(created.data));
    const listingId = created.data.listing?.id;
    assert.ok(listingId);

    const cleanup = await cancelForbiddenMarketListings([forbiddenItemId]);
    assert.equal(cleanup.cancelledListings >= 1, true);
    assert.equal(cleanup.refundedPublicationFees >= 14, true);

    const listings = await listMarketListings({
        sellerCharacterId: seller.id,
        includeInactive: true,
        limit: 10,
    });
    assert.equal(listings.ok, true, JSON.stringify(listings.data));
    assert.equal(
        listings.data.listings.find((listing) => listing.id === listingId)
            ?.status,
        "cancelled",
    );

    const claims = await getMarketClaims(seller.id);
    assert.equal(claims.ok, true, JSON.stringify(claims.data));
    assert.equal(claims.data.claims.length, 2);

    const normalizedClaims = claims.data.claims
        .map((claim) => ({
            claimType: claim.claimType,
            goldAmount: claim.goldAmount,
            itemId: claim.itemId,
            itemQuantity: claim.itemQuantity,
            sourceListingId: claim.sourceListingId,
        }))
        .sort((left, right) => left.claimType.localeCompare(right.claimType));

    assert.deepEqual(normalizedClaims, [
        {
            claimType: "gold",
            goldAmount: 14,
            itemId: forbiddenItemId,
            itemQuantity: 2,
            sourceListingId: listingId,
        },
        {
            claimType: "item",
            goldAmount: 0,
            itemId: forbiddenItemId,
            itemQuantity: 2,
            sourceListingId: listingId,
        },
    ]);

    const claimResult = await claimMarket(seller.id, {
        characterGold: 1000,
        characterItems: [
            { idPos: 1, idItem: forbiddenItemId, cant: 3, equipped: false },
        ],
    });
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult.data));

    assert.deepEqual(
        await getCharacterState(seller.accountId, seller.id, seller.email),
        {
            gold: 1000,
            clanId: null,
            items: [
                { idPos: 1, idItem: forbiddenItemId, cant: 3, equipped: false },
            ],
        },
    );
});

test("market limita a 20 publicaciones activas por cuenta", async () => {
    const seller = await createCharacterFixture({
        namePrefix: "Acct",
        gold: 10_000,
        items: Array.from({ length: 21 }, (_, index) => ({
            idPos: index + 1,
            idItem: 1,
            cant: 1,
            equipped: false,
        })),
    });

    let remainingGold = 10_000;
    const remainingItems = Array.from({ length: 21 }, (_, index) => ({
        idPos: index + 1,
        idItem: 1,
        cant: 1,
        equipped: false,
    }));

    for (let slot = 1; slot <= 20; slot += 1) {
        remainingGold -= 1;
        const nextItems = remainingItems.filter((item) => item.idPos !== slot);
        const created = await createMarketListing({
            sellerCharacterId: seller.id,
            sellerAccountId: seller.accountId,
            sellerName: seller.name,
            itemId: 1,
            quantity: 1,
            price: 50,
            publicationFee: 1,
            durationHours: 24,
            characterGold: remainingGold,
            characterItems: nextItems,
        });
        assert.equal(created.ok, true, JSON.stringify(created.data));
        remainingItems.splice(
            remainingItems.findIndex((item) => item.idPos === slot),
            1,
        );
    }

    const rejected = await createMarketListing({
        sellerCharacterId: seller.id,
        sellerAccountId: seller.accountId,
        sellerName: seller.name,
        itemId: 1,
        quantity: 1,
        price: 50,
        publicationFee: 1,
        durationHours: 24,
        characterGold: remainingGold - 1,
        characterItems: remainingItems.filter((item) => item.idPos !== 21),
    });

    assert.equal(rejected.ok, false, JSON.stringify(rejected.data));
    assert.match(
        String(rejected.data.error ?? ""),
        /20 publicaciones activas/i,
    );
});
