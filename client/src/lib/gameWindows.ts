// Pure logic for the gameplay modal windows (trade, market, bank, crafting,
// retos). Kept DOM-free so it can be unit-tested with node:test.
import type {
    CraftingRecipe,
    InventoryItem,
    MarketState,
    TradeItem,
} from "./aowProtocol";

export const BANK_MAX_SLOTS = 100;
export const TRADE_MIN_GRID_SLOTS = 25;
export const MARKET_PAGE_SIZE = 20;
export const MARKET_MIN_LISTING_HOURS = 1;

// Expand a sparse slot-indexed item list into a dense array suitable for a
// grid, keeping at least `minSlots` cells. Mirrors the reference TradeModal.
export function buildTradeSlots<T extends { slot: number }>(
    items: T[],
    minSlots: number = TRADE_MIN_GRID_SLOTS,
): Array<T | null> {
    if (items.length === 0) {
        return Array.from({ length: minSlots }, () => null);
    }

    const lowestSlot = items.reduce(
        (minSlot, item) => Math.min(minSlot, item.slot),
        items[0].slot,
    );
    const highestSlot = items.reduce(
        (maxSlot, item) => Math.max(maxSlot, item.slot),
        items[0].slot,
    );
    const startSlot = lowestSlot === 0 ? 0 : 1;
    const totalSlots = Math.max(minSlots, highestSlot - startSlot + 1);
    const bySlot = new Map(items.map((item) => [item.slot, item]));

    return Array.from(
        { length: totalSlots },
        (_, index) => bySlot.get(index + startSlot) ?? null,
    );
}

// Item detail strings come from the server as "Foo | Bar | Baz".
export function parseItemDetails(details: string): string[] {
    return details
        .split("|")
        .map((detail) => detail.trim())
        .filter(Boolean);
}

// Total owned amount per itemId across the whole inventory.
export function countInventoryByItemId(
    inventory: ReadonlyArray<Pick<InventoryItem, "idItem" | "amount">>,
): Map<number, number> {
    const counts = new Map<number, number>();
    for (const item of inventory) {
        counts.set(item.idItem, (counts.get(item.idItem) ?? 0) + item.amount);
    }
    return counts;
}

export type MaterialNeed = {
    itemId: number;
    name: string;
    required: number;
    owned: number;
    enough: boolean;
};

// Per-material availability for crafting `amount` units of a recipe.
export function getRecipeMaterialNeeds(
    recipe: CraftingRecipe,
    inventory: ReadonlyArray<Pick<InventoryItem, "idItem" | "amount">>,
    amount: number,
): MaterialNeed[] {
    const craftAmount = Math.max(1, Math.floor(amount) || 1);
    const counts = countInventoryByItemId(inventory);
    return recipe.materials.map((material) => {
        const required = material.amount * craftAmount;
        const owned = counts.get(material.itemId) ?? 0;
        return {
            itemId: material.itemId,
            name: material.name,
            required,
            owned,
            enough: owned >= required,
        };
    });
}

export function canCraftRecipe(
    recipe: CraftingRecipe,
    inventory: ReadonlyArray<Pick<InventoryItem, "idItem" | "amount">>,
    amount: number,
): boolean {
    return getRecipeMaterialNeeds(recipe, inventory, amount).every(
        (need) => need.enough,
    );
}

// Server-side guard for vault moves (see game.reorderBankItem): both slots
// must be integers in [1, maxSlots] and different.
export function canMoveBankItem(
    sourceSlot: number,
    targetSlot: number,
    maxSlots: number = BANK_MAX_SLOTS,
): boolean {
    return (
        Number.isInteger(sourceSlot) &&
        Number.isInteger(targetSlot) &&
        sourceSlot >= 1 &&
        targetSlot >= 1 &&
        sourceSlot <= maxSlots &&
        targetSlot <= maxSlots &&
        sourceSlot !== targetSlot
    );
}

// Fee charged to publish a market listing, in gold.
export function computeMarketPublicationFee(
    price: number,
    publicationFeeBps: number,
): number {
    return Math.max(1, Math.floor((price * publicationFeeBps) / 10000));
}

export function clampMarketDurationHours(
    requestedHours: number,
    maxDurationHours: number,
): number {
    return Math.min(
        Math.max(MARKET_MIN_LISTING_HOURS, Math.floor(requestedHours) || 1),
        Math.max(MARKET_MIN_LISTING_HOURS, maxDurationHours),
    );
}

export type MarketBrowsePayload = {
    listingLimit: number;
    search?: string;
    sortPrice?: "recent" | "asc" | "desc";
};

export const MARKET_MIN_SEARCH_LENGTH = 4;

// Search only kicks in from MARKET_MIN_SEARCH_LENGTH characters (matches the
// reference MarketModal behaviour).
export function buildMarketBrowsePayload(options: {
    listingLimit: number;
    searchText: string;
    sortPrice: "recent" | "asc" | "desc";
}): MarketBrowsePayload {
    const search = options.searchText.trim();
    return {
        listingLimit: Math.max(1, Math.floor(options.listingLimit) || 1),
        ...(search.length >= MARKET_MIN_SEARCH_LENGTH ? { search } : {}),
        sortPrice: options.sortPrice,
    };
}

// A listing is cancellable by its owner while active.
export function isCancellableListing(
    listing: Pick<MarketState["myListings"][number], "status">,
): boolean {
    return listing.status === "active";
}

// Whether a retos challenge belongs to the current character (then the
// action is "cancel" instead of "join").
export function isOwnChallenge(
    proposerId: string | number,
    currentCharacterId: string | number | null,
): boolean {
    return (
        currentCharacterId !== null &&
        String(proposerId) === String(currentCharacterId)
    );
}

// Clamp a user-entered trade/craft amount to a sane positive integer.
export function parseAmountInput(raw: string, max = 9999): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(max, parsed));
}

// Trade sell price shown next to player items already comes from the server
// (floor(valor / 3)); this only guards against bogus values.
export function tradeItemPriceLabel(item: Pick<TradeItem, "value">): string {
    return String(Math.max(0, Math.floor(item.value)));
}
