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

// Descripcion breve de cada skill para el boton "?" del modal de stats,
// en el mismo orden que SKILL_NAMES (mecanicas del AO clasico).
export const SKILL_DESCRIPTIONS = [
    "Permite lanzar hechizos. Cuanto mas alta, mas hechizos podes aprender y menos probabilidad hay de que fallen.",
    "Permite robar oro y objetos a otros personajes y a criaturas, sin que se den cuenta.",
    "Aumenta la probabilidad de esquivar los golpes fisicos del enemigo.",
    "Mejora la punteria y el danio al pelear cuerpo a cuerpo con armas.",
    "Con /meditar recuperas mana. A mas skill, mas mana recuperas en cada intervalo.",
    "Permite apunalar con dagas: golpes de danio multiplicado, ideales atacando oculto.",
    "Te vuelve invisible para jugadores y criaturas mientras no ataques. Se rompe al actuar.",
    "Permite sobrevivir en el campo: comer carne cruda y resistir mejor el hambre y la sed.",
    "Permite extraer lenia de los arboles con un hacha. Materia prima de la carpinteria.",
    "Mejora los precios al comprar y vender con los mercaderes NPC.",
    "Aumenta la probabilidad de bloquear ataques con el escudo equipado.",
    "Permite pescar en costas y rios con una cania. Fuente de alimento y algo de oro.",
    "Permite extraer minerales de los yacimientos con un piquete. Materia prima de la herreria.",
    "Permite fabricar arcos, flechas y otros objetos de madera a partir de lenia.",
    "Permite forjar armas y armaduras a partir de lingotes, junto a un yunque.",
    "Necesario para fundar y liderar clanes y organizar grupos de aventureros.",
    "Permite domar criaturas para que peleen a tu lado. A mas skill, mejores mascotas.",
    "Mejora la punteria y el danio con arcos y otras armas arrojadizas.",
    "Mejora el danio y la punteria peleando a punio limpio, sin armas.",
    "Permite navegar: usar barcas y barcos para cruzar el mar. A mas skill, mejores naves.",
] as const;

// Textos de ayuda para los botones "?" del panel Misc. y del modal de stats.
export type HelpTopic = {
    title: string;
    paragraphs: string[];
};

export const HELP_TOPICS: Record<
    "party" | "clan" | "acciones" | "skillpoints",
    HelpTopic
> = {
    party: {
        title: "Party",
        paragraphs: [
            "Una party es un grupo temporal de aventureros: la experiencia de las criaturas derrotadas se reparte entre los miembros cercanos.",
            "Para invitar a alguien escribi en el chat /party {nombre} (el objetivo debe estar online). Si no tenes party, se crea una nueva y quedas como lider (★).",
            "Para abandonarla usa /salirparty. Los miembros de tu party aparecen listados en este panel.",
        ],
    },
    clan: {
        title: "Clan",
        paragraphs: [
            "Un clan (o guild) es una agrupacion permanente de personajes, con nombre propio y nivel minimo de ingreso.",
            "Se funda con /clancrear nombre|nivelMin. Para unirte a uno existente usa /clanpostular clanId|mensaje y espera a que el lider te acepte con /clanaceptar.",
            "El lider puede expulsar (/clanexpulsar), nombrar co-lideres (/clancolider) o disolver el clan (/claneliminar). Escribi /clan para ver todos los comandos.",
        ],
    },
    acciones: {
        title: "Acciones",
        paragraphs: [
            "Entrenador: acercate a un NPC entrenador y abri su ventana para invocar criaturas domadas que peleen a tu lado, hasta el cupo que permita tu skill de Domar animales.",
            "Correo: permite enviar y recibir mensajes con otros personajes, incluso si estan offline. El boton se resalta cuando tenes mensajes nuevos.",
        ],
    },
    skillpoints: {
        title: "Atributos y skillpoints",
        paragraphs: [
            "Los atributos (Fuerza, Agilidad, Inteligencia, Constitucion) quedan fijos desde la creacion del personaje y definen danio, vida, mana y energia.",
            "Al subir de nivel ganas skillpoints: usalos con el boton + de cada skill para subirla (0 a 100). Los puntos sin asignar se acumulan.",
            "Cada skill tiene un boton ? que explica para que sirve.",
        ],
    },
};
