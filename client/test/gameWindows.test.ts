import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BANK_MAX_SLOTS,
    buildMarketBrowsePayload,
    buildTradeSlots,
    canCraftRecipe,
    canMoveBankItem,
    clampMarketDurationHours,
    computeMarketPublicationFee,
    countInventoryByItemId,
    getRecipeMaterialNeeds,
    isCancellableListing,
    isOwnChallenge,
    parseAmountInput,
    parseItemDetails,
} from "../src/lib/gameWindows";
import type { CraftingRecipe } from "../src/lib/aowProtocol";

test("buildTradeSlots pads empty list to minimum", () => {
    const slots = buildTradeSlots([]);
    assert.equal(slots.length, 25);
    assert.ok(slots.every((slot) => slot === null));
});

test("buildTradeSlots places items at their slot and extends past the max slot", () => {
    const items = [
        { slot: 1, name: "a" },
        { slot: 30, name: "b" },
    ];
    const slots = buildTradeSlots(items);
    assert.equal(slots.length, 30);
    assert.equal(slots[0]?.name, "a");
    assert.equal(slots[29]?.name, "b");
    assert.equal(slots[1], null);
});

test("parseItemDetails splits on pipes and trims", () => {
    assert.deepEqual(parseItemDetails(" Daño: 5/10 | Tier: 2 || "), [
        "Daño: 5/10",
        "Tier: 2",
    ]);
    assert.deepEqual(parseItemDetails(""), []);
});

test("countInventoryByItemId sums amounts across slots", () => {
    const counts = countInventoryByItemId([
        { idItem: 7, amount: 3 },
        { idItem: 7, amount: 4 },
        { idItem: 9, amount: 1 },
    ]);
    assert.equal(counts.get(7), 7);
    assert.equal(counts.get(9), 1);
});

const recipe: CraftingRecipe = {
    itemId: 100,
    name: "Espada",
    grhIndex: 1,
    details: "",
    stats: "",
    skill: 10,
    category: "Armas",
    materials: [
        { itemId: 7, name: "Lingote", amount: 2, owned: 0 },
        { itemId: 9, name: "Madera", amount: 1, owned: 0 },
    ],
};

const inventory = [
    { idItem: 7, amount: 5 },
    { idItem: 9, amount: 1 },
];

test("getRecipeMaterialNeeds scales by amount and flags missing materials", () => {
    const needs = getRecipeMaterialNeeds(recipe, inventory, 3);
    assert.deepEqual(needs, [
        { itemId: 7, name: "Lingote", required: 6, owned: 5, enough: false },
        { itemId: 9, name: "Madera", required: 3, owned: 1, enough: false },
    ]);
});

test("canCraftRecipe is true only when every material is covered", () => {
    assert.equal(canCraftRecipe(recipe, inventory, 1), true);
    assert.equal(canCraftRecipe(recipe, inventory, 2), false);
    assert.equal(canCraftRecipe(recipe, [], 1), false);
});

test("canMoveBankItem enforces server slot rules", () => {
    assert.equal(canMoveBankItem(1, 2), true);
    assert.equal(canMoveBankItem(1, 1), false);
    assert.equal(canMoveBankItem(0, 2), false);
    assert.equal(canMoveBankItem(1, BANK_MAX_SLOTS + 1), false);
    assert.equal(canMoveBankItem(1.5, 2), false);
});

test("computeMarketPublicationFee applies bps with a 1 gold minimum", () => {
    assert.equal(computeMarketPublicationFee(10_000, 250), 250);
    assert.equal(computeMarketPublicationFee(3, 100), 1);
});

test("clampMarketDurationHours respects min and max", () => {
    assert.equal(clampMarketDurationHours(0, 72), 1);
    assert.equal(clampMarketDurationHours(24, 72), 24);
    assert.equal(clampMarketDurationHours(999, 72), 72);
});

test("buildMarketBrowsePayload only includes search from 4 chars", () => {
    assert.deepEqual(
        buildMarketBrowsePayload({
            listingLimit: 20,
            searchText: " esp ",
            sortPrice: "asc",
        }),
        { listingLimit: 20, sortPrice: "asc" },
    );
    assert.deepEqual(
        buildMarketBrowsePayload({
            listingLimit: 20,
            searchText: " espada ",
            sortPrice: "asc",
        }),
        { listingLimit: 20, search: "espada", sortPrice: "asc" },
    );
});

test("isCancellableListing only allows active listings", () => {
    assert.equal(isCancellableListing({ status: "active" }), true);
    assert.equal(isCancellableListing({ status: "sold" }), false);
});

test("isOwnChallenge compares ids loosely", () => {
    assert.equal(isOwnChallenge("12", 12), true);
    assert.equal(isOwnChallenge("12", "13"), false);
    assert.equal(isOwnChallenge("12", null), false);
});

test("parseAmountInput clamps to [1, max]", () => {
    assert.equal(parseAmountInput(""), 1);
    assert.equal(parseAmountInput("abc"), 1);
    assert.equal(parseAmountInput("0"), 1);
    assert.equal(parseAmountInput("5"), 5);
    assert.equal(parseAmountInput("99999"), 9999);
});
