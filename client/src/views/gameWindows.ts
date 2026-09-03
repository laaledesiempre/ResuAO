// Floating gameplay windows (trade/bank, market, crafting, bail, retos).
// One modal at a time, medieval skin (see styles.css `.gw-*`), opened/closed
// from the play view in response to hudStateController emissions.
import { el } from "../ui";
import type {
    BailOffer,
    CraftingState,
    InventoryItem,
    MarketListingEntry,
    MarketState,
    RetosState,
    TradeItem,
    TradeState,
    TrainerState,
    CorreoState,
} from "../lib/aowProtocol";
import type { GameHandle } from "../game/bootstrap";
import { inventoryIconLayout } from "../lib/inventoryIcons";
import { formatNumber } from "../lib/number-format";
import {
    buildMarketBrowsePayload,
    buildTradeSlots,
    canCraftRecipe,
    canMoveBankItem,
    clampMarketDurationHours,
    computeMarketPublicationFee,
    getRecipeMaterialNeeds,
    isCancellableListing,
    isOwnChallenge,
    parseAmountInput,
    parseItemDetails,
    MARKET_PAGE_SIZE,
    type MarketBrowsePayload,
} from "../lib/gameWindows";

const ICON_SLOT_SIZE = 36;

type WindowKind =
    | "trade"
    | "market"
    | "bail"
    | "crafting"
    | "retos"
    | "trainer"
    | "correo";

export type GameWindowsDeps = {
    host: HTMLElement;
    getGame: () => GameHandle | null;
    getInventory: () => InventoryItem[];
    getCharacterId: () => string | number | null;
    getGold: () => number;
};

export type GameWindows = {
    setTradeState: (state: TradeState | null) => void;
    setMarketState: (state: MarketState | null) => void;
    setBailState: (state: BailOffer | null) => void;
    setCraftingState: (state: CraftingState | null) => void;
    setRetosState: (state: RetosState | null) => void;
    setTrainerState: (state: TrainerState | null) => void;
    setCorreoState: (state: CorreoState | null) => void;
    closeAll: () => void;
    destroy: () => void;
};

export function createGameWindows(deps: GameWindowsDeps): GameWindows {
    let overlay: HTMLElement | null = null;
    let openKind: WindowKind | null = null;
    let escapeListener: ((event: KeyboardEvent) => void) | null = null;

    const removeEscapeListener = () => {
        if (escapeListener) {
            window.removeEventListener("keydown", escapeListener);
            escapeListener = null;
        }
    };

    const closeCurrent = () => {
        removeEscapeListener();
        overlay?.remove();
        overlay = null;
        openKind = null;
    };

    // Trade/market sessions live server-side: closing them notifies the
    // server so it can release the trade/vault session.
    const closeWithNotify = () => {
        const kind = openKind;
        closeCurrent();
        if (kind === "trade" || kind === "market") {
            deps.getGame()?.closeTrade();
        }
    };

    const openWindow = (kind: WindowKind, content: HTMLElement): void => {
        closeCurrent();
        openKind = kind;

        const closeButton = el(
            "button",
            { type: "button", className: "gw-close", title: "Cerrar" },
            "✕",
        );
        closeButton.addEventListener("click", closeWithNotify);

        const modal = el(
            "div",
            { className: `gw-modal gw-${kind}` },
            closeButton,
            content,
        );
        modal.addEventListener("click", (event) => event.stopPropagation());

        overlay = el("div", { className: "gw-overlay" }, modal);
        overlay.addEventListener("click", closeWithNotify);
        deps.host.append(overlay);

        escapeListener = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                closeWithNotify();
            }
        };
        window.addEventListener("keydown", escapeListener);
    };

    const iconNode = (grhIndex: number, name: string): HTMLElement => {
        const graphic = deps.getGame()?.resolveIconGraphic(grhIndex) ?? null;
        if (!graphic) {
            return el("span", { className: "inv-fallback" }, name);
        }
        const layout = inventoryIconLayout(graphic, ICON_SLOT_SIZE);
        const img = el("img", {
            src: layout.url,
            alt: name,
            draggable: "false",
        }) as HTMLImageElement;
        img.style.left = `${layout.offsetX}px`;
        img.style.top = `${layout.offsetY}px`;
        img.style.transform = `scale(${layout.scale})`;
        const box = el("div", { className: "inv-icon" }, img);
        box.style.width = `${layout.boxWidth}px`;
        box.style.height = `${layout.boxHeight}px`;
        return box;
    };

    const itemSlot = (
        item: TradeItem | InventoryItem | null,
        onClick?: () => void,
    ): HTMLElement => {
        const slot = el("div", { className: "inv-slot" });
        if (!item) return slot;
        slot.classList.add("occupied");
        if ("equipped" in item && item.equipped) slot.classList.add("equipped");
        slot.title = item.name;
        slot.append(iconNode(item.grhIndex, item.name));
        if (item.amount > 1) {
            slot.append(
                el("span", { className: "inv-amount" }, String(item.amount)),
            );
        }
        if (onClick) {
            slot.addEventListener("click", onClick);
        }
        return slot;
    };

    const amountRow = (
        buttonLabel: string,
        onConfirm: (amount: number) => void,
        disabled = false,
    ): HTMLElement => {
        const input = el("input", {
            type: "text",
            inputmode: "numeric",
            value: "1",
            className: "gw-amount",
        }) as HTMLInputElement;
        const button = el(
            "button",
            { type: "button", className: "gw-action" },
            buttonLabel,
        ) as HTMLButtonElement;
        button.disabled = disabled;
        button.addEventListener("click", () =>
            onConfirm(parseAmountInput(input.value)),
        );
        return el("div", { className: "gw-amount-row" }, input, button);
    };

    const detailBlock = (
        item: TradeItem | InventoryItem,
        price: string | null,
    ): HTMLElement =>
        el(
            "div",
            { className: "gw-detail" },
            el("div", { className: "gw-detail-name" }, item.name),
            price
                ? el("div", { className: "gw-detail-price" }, price)
                : null,
            ...parseItemDetails(item.details ?? "").map((line) =>
                el("div", { className: "gw-detail-line" }, line),
            ),
        );

    // ---------------- Trade / Bank ----------------

    const renderTrade = (state: TradeState): void => {
        const isBank = state.mode === "bank";
        const game = deps.getGame();

        let moveSourceSlot: number | null = null;

        const body = el("div", { className: "gw-body" });
        const detail = el("div", { className: "gw-side" });
        const actions = el("div", { className: "gw-actions" });

        const showNpcSelection = (item: TradeItem) => {
            detail.replaceChildren(
                detailBlock(
                    item,
                    isBank ? null : `Precio: ${formatNumber(item.value)} oro`,
                ),
            );
            actions.replaceChildren(
                amountRow(isBank ? "Retirar" : "Comprar", (amount) =>
                    deps.getGame()?.buyItem(item.slot, amount),
                ),
            );
        };

        const showPlayerSelection = (item: TradeItem) => {
            detail.replaceChildren(
                detailBlock(
                    item,
                    isBank
                        ? null
                        : `Venta: ${formatNumber(item.value)} oro`,
                ),
            );
            actions.replaceChildren(
                amountRow(
                    isBank ? "Depositar" : "Vender",
                    (amount) => deps.getGame()?.sellItem(item.slot, amount),
                    isBank && Boolean(item.equipped),
                ),
            );
            if (isBank && item.equipped) {
                actions.append(
                    el(
                        "div",
                        { className: "gw-note err" },
                        "Primero debes desequiparlo para guardarlo.",
                    ),
                );
            }
        };

        const npcGrid = el("div", { className: "gw-grid" });
        const clearMoveArmed = () => {
            moveSourceSlot = null;
            npcGrid
                .querySelectorAll(".move-armed")
                .forEach((other) => other.classList.remove("move-armed"));
        };
        for (const item of buildTradeSlots(state.merchantItems)) {
            const slot = itemSlot(item, () => {
                if (!item) return;
                if (isBank && moveSourceSlot !== null) {
                    if (canMoveBankItem(moveSourceSlot, item.slot)) {
                        game?.reorderBankItem(moveSourceSlot, item.slot);
                    }
                    clearMoveArmed();
                    return;
                }
                showNpcSelection(item);
            });
            // Right-click a vault item to arm a move, then click the target slot.
            if (isBank && item) {
                slot.addEventListener("contextmenu", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    clearMoveArmed();
                    moveSourceSlot = item.slot;
                    slot.classList.add("move-armed");
                });
            }
            npcGrid.append(slot);
        }

        const playerGrid = el("div", { className: "gw-grid" });
        for (const item of buildTradeSlots(state.playerItems)) {
            playerGrid.append(
                itemSlot(item, () => {
                    if (!item) return;
                    if (isBank && moveSourceSlot !== null) {
                        clearMoveArmed();
                    }
                    showPlayerSelection(item);
                }),
            );
        }

        if (isBank) {
            npcGrid.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                clearMoveArmed();
            });
        }

        const columns = el(
            "div",
            { className: "gw-columns" },
            el(
                "div",
                { className: "gw-col" },
                el(
                    "div",
                    { className: "gw-col-title" },
                    isBank ? "Bóveda" : "Mercader",
                ),
                npcGrid,
            ),
            el(
                "div",
                { className: "gw-col" },
                el("div", { className: "gw-col-title" }, "Tu inventario"),
                playerGrid,
            ),
        );

        body.append(columns, el("div", { className: "gw-right" }, detail, actions));

        const headerExtras: HTMLElement[] = [];
        if (isBank) {
            const tabs: Array<["character" | "account" | "clan", string]> = [
                ["character", "Personal"],
                ["account", "Cuenta"],
            ];
            if (state.hasClanVault) {
                tabs.push(["clan", state.clanName ? `Clan ${state.clanName}` : "Clan"]);
            }
            const tabButtons = tabs.map(([tab, label]) => {
                const button = el(
                    "button",
                    {
                        type: "button",
                        className: `gw-tab${state.bankTab === tab ? " active" : ""}`,
                    },
                    label,
                );
                button.addEventListener("click", () =>
                    deps.getGame()?.changeBankTab(tab),
                );
                return button;
            });
            headerExtras.push(el("div", { className: "gw-tabs" }, ...tabButtons));

            const goldInput = el("input", {
                type: "text",
                inputmode: "numeric",
                value: "1000",
                className: "gw-amount",
            }) as HTMLInputElement;
            const depositButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Depositar oro",
            );
            depositButton.addEventListener("click", () =>
                deps
                    .getGame()
                    ?.depositBankGold(parseAmountInput(goldInput.value, 1_000_000_000)),
            );
            const withdrawButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Retirar oro",
            );
            withdrawButton.addEventListener("click", () =>
                deps
                    .getGame()
                    ?.withdrawBankGold(parseAmountInput(goldInput.value, 1_000_000_000)),
            );
            headerExtras.push(
                el(
                    "div",
                    { className: "gw-gold-row" },
                    el(
                        "span",
                        { className: "gw-gold" },
                        `Bóveda: ${formatNumber(state.vaultGold ?? 0)} oro`,
                    ),
                    el(
                        "span",
                        { className: "gw-gold" },
                        `Tuyo: ${formatNumber(deps.getGold())} oro`,
                    ),
                    goldInput,
                    depositButton,
                    withdrawButton,
                ),
            );
            headerExtras.push(
                el(
                    "div",
                    { className: "gw-note" },
                    "Click derecho sobre un item de la bóveda y luego click en otro casillero para moverlo.",
                ),
            );
        }

        const title = el(
            "div",
            { className: "gw-head" },
            el("h2", { className: "gw-title" }, isBank ? "Bóveda" : "Comercio"),
            ...headerExtras,
        );

        openWindow("trade", el("div", {}, title, body));
    };

    // ---------------- Market ----------------

    const renderMarket = (state: MarketState): void => {
        const marketAction = deps.getGame()?.marketAction.bind(deps.getGame());
        let listingLimit = MARKET_PAGE_SIZE;
        let searchText = "";
        let sortPrice: "recent" | "asc" | "desc" = "recent";

        const browse = (): MarketBrowsePayload =>
            buildMarketBrowsePayload({ listingLimit, searchText, sortPrice });

        const content = el("div", {});
        const tabBar = el("div", { className: "gw-tabs" });
        const panel = el("div", { className: "gw-market-panel" });

        const listingIcon = (grhIndex: number | null, name: string) =>
            iconNode(grhIndex ?? 0, name);

        const renderBrowse = () => {
            panel.replaceChildren();
            const searchInput = el("input", {
                type: "text",
                placeholder: "Buscar (mín. 4 letras)...",
                value: searchText,
                className: "gw-search",
            }) as HTMLInputElement;
            searchInput.addEventListener("input", () => {
                searchText = searchInput.value;
            });
            searchInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    listingLimit = MARKET_PAGE_SIZE;
                    marketAction?.("refresh", { ...browse() });
                }
            });

            const sortSelect = el(
                "select",
                { className: "gw-select" },
                el("option", { value: "recent" }, "Recientes"),
                el("option", { value: "asc" }, "Menor precio"),
                el("option", { value: "desc" }, "Mayor precio"),
            ) as HTMLSelectElement;
            sortSelect.value = sortPrice;
            sortSelect.addEventListener("change", () => {
                sortPrice = sortSelect.value as typeof sortPrice;
                listingLimit = MARKET_PAGE_SIZE;
                marketAction?.("refresh", { ...browse() });
            });

            const refreshButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Refrescar",
            );
            refreshButton.addEventListener("click", () =>
                marketAction?.("refresh", { ...browse() }),
            );

            panel.append(
                el(
                    "div",
                    { className: "gw-toolbar" },
                    searchInput,
                    sortSelect,
                    refreshButton,
                ),
            );

            if (state.listingGroups.length === 0) {
                panel.append(
                    el("div", { className: "panel-empty" }, "No hay publicaciones."),
                );
                return;
            }

            const list = el("div", { className: "gw-list" });
            for (const group of state.listingGroups) {
                const groupEl = el(
                    "div",
                    { className: "gw-market-group" },
                    el(
                        "div",
                        { className: "gw-market-group-head" },
                        listingIcon(group.itemGrhIndex, group.itemName),
                        el(
                            "div",
                            { className: "gw-market-group-info" },
                            el("div", { className: "gw-detail-name" }, group.itemName),
                            el(
                                "div",
                                { className: "gw-detail-line" },
                                `${group.totalListings} pub. · ${group.totalQuantity} uds. · desde ${formatNumber(group.minUnitPrice)} oro`,
                            ),
                        ),
                    ),
                );
                const listingsEl = el("div", { className: "gw-market-listings" });
                for (const listing of group.listings) {
                    const buyButton = el(
                        "button",
                        { type: "button", className: "gw-action" },
                        "Comprar",
                    );
                    buyButton.addEventListener("click", () =>
                        marketAction?.("buy", {
                            listingId: listing.id,
                            expectedItemId: listing.itemId,
                            expectedQuantity: listing.quantity,
                            expectedPrice: listing.price,
                            ...browse(),
                        }),
                    );
                    listingsEl.append(
                        el(
                            "div",
                            { className: "gw-row" },
                            el(
                                "span",
                                {},
                                `${listing.itemName} x${listing.quantity} · ${listing.sellerName}`,
                            ),
                            el(
                                "span",
                                { className: "gw-price" },
                                `${formatNumber(listing.price)} oro`,
                            ),
                            buyButton,
                        ),
                    );
                }
                groupEl.append(listingsEl);
                list.append(groupEl);
            }
            panel.append(list);

            if (state.hasMoreListings) {
                const moreButton = el(
                    "button",
                    { type: "button", className: "gw-action" },
                    "Cargar más",
                );
                moreButton.addEventListener("click", () => {
                    listingLimit += MARKET_PAGE_SIZE;
                    marketAction?.("refresh", { ...browse() });
                });
                panel.append(el("div", { className: "gw-toolbar" }, moreButton));
            }
        };

        const renderPublish = () => {
            panel.replaceChildren();
            const inventory = deps.getInventory().filter((item) => !item.equipped);
            let selectedSlot: number | null = inventory[0]?.slot ?? null;

            const grid = el("div", { className: "gw-grid" });
            const qtyInput = el("input", {
                type: "text",
                inputmode: "numeric",
                value: "1",
                className: "gw-amount",
            }) as HTMLInputElement;
            const priceInput = el("input", {
                type: "text",
                inputmode: "numeric",
                value: "100",
                className: "gw-amount",
            }) as HTMLInputElement;
            const durationInput = el("input", {
                type: "text",
                inputmode: "numeric",
                value: String(state.defaultDurationHours || 24),
                className: "gw-amount",
            }) as HTMLInputElement;
            const feeNote = el("div", { className: "gw-note" }, "");

            const updateFee = () => {
                const price = parseAmountInput(priceInput.value, 1_000_000_000);
                feeNote.textContent = `Comisión de publicación: ${formatNumber(
                    computeMarketPublicationFee(price, state.publicationFeeBps),
                )} oro`;
            };
            priceInput.addEventListener("input", updateFee);
            updateFee();

            const publishButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Publicar",
            );
            publishButton.addEventListener("click", () => {
                const item = inventory.find((entry) => entry.slot === selectedSlot);
                if (!item) return;
                marketAction?.("create", {
                    slot: item.slot,
                    quantity: Math.min(
                        item.amount,
                        parseAmountInput(qtyInput.value),
                    ),
                    price: parseAmountInput(priceInput.value, 1_000_000_000),
                    durationHours: clampMarketDurationHours(
                        parseAmountInput(durationInput.value, 999),
                        state.maxDurationHours,
                    ),
                    ...browse(),
                });
            });

            const refreshGrid = () => {
                grid.replaceChildren();
                for (const item of buildTradeSlots(inventory)) {
                    const slot = itemSlot(item, () => {
                        if (!item) return;
                        selectedSlot = item.slot;
                        refreshGrid();
                    });
                    if (item && item.slot === selectedSlot) {
                        slot.classList.add("equipped");
                    }
                    grid.append(slot);
                }
            };
            refreshGrid();

            panel.append(
                el(
                    "div",
                    { className: "gw-note" },
                    `Oro disponible: ${formatNumber(deps.getGold())}. Selecciona un item de tu inventario.`,
                ),
                grid,
                el(
                    "div",
                    { className: "gw-form" },
                    el("label", {}, "Cantidad", qtyInput),
                    el("label", {}, "Precio total (oro)", priceInput),
                    el("label", {}, "Duración (horas)", durationInput),
                ),
                feeNote,
                el("div", { className: "gw-toolbar" }, publishButton),
            );
        };

        const renderMine = () => {
            panel.replaceChildren();
            if (state.myListings.length === 0) {
                panel.append(
                    el(
                        "div",
                        { className: "panel-empty" },
                        "No tienes publicaciones.",
                    ),
                );
                return;
            }
            const list = el("div", { className: "gw-list" });
            for (const listing of state.myListings) {
                const children: HTMLElement[] = [
                    listingIcon(listing.itemGrhIndex, listing.itemName),
                    el(
                        "span",
                        {},
                        `${listing.itemName} x${listing.quantity} · ${formatNumber(listing.price)} oro`,
                    ),
                    el(
                        "span",
                        { className: `gw-status gw-status-${listing.status}` },
                        listing.status,
                    ),
                ];
                if (isCancellableListing(listing)) {
                    const cancelButton = el(
                        "button",
                        { type: "button", className: "gw-action" },
                        "Cancelar",
                    );
                    cancelButton.addEventListener("click", () =>
                        marketAction?.("cancel", {
                            listingId: listing.id,
                            ...browse(),
                        }),
                    );
                    children.push(cancelButton);
                }
                list.append(el("div", { className: "gw-row" }, ...children));
            }
            panel.append(list);
        };

        const renderClaims = () => {
            panel.replaceChildren();
            const list = el("div", { className: "gw-list" });
            if (state.claims.length === 0) {
                list.append(
                    el("div", { className: "panel-empty" }, "Nada para reclamar."),
                );
            }
            for (const claim of state.claims) {
                list.append(
                    el(
                        "div",
                        { className: "gw-row" },
                        claim.itemGrhIndex !== null
                            ? listingIcon(claim.itemGrhIndex, claim.itemName ?? "")
                            : null,
                        el(
                            "span",
                            {},
                            claim.claimType === "gold"
                                ? `${formatNumber(claim.goldAmount)} oro`
                                : `${claim.itemName ?? "Item"} x${claim.itemQuantity ?? 0}`,
                        ),
                    ),
                );
            }
            const claimButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Reclamar todo",
            );
            claimButton.disabled = state.claims.length === 0;
            claimButton.addEventListener("click", () =>
                marketAction?.("claim", { ...browse() }),
            );
            panel.append(list, el("div", { className: "gw-toolbar" }, claimButton));
        };

        const tabs: Array<[string, string, () => void]> = [
            ["browse", "Explorar", renderBrowse],
            ["publish", "Publicar", renderPublish],
            ["mine", "Mis publicaciones", renderMine],
            ["claims", "Reclamos", renderClaims],
        ];

        let activeTab = "browse";
        const rebuildTabs = () => {
            tabBar.replaceChildren();
            for (const [id, label, render] of tabs) {
                const button = el(
                    "button",
                    {
                        type: "button",
                        className: `gw-tab${activeTab === id ? " active" : ""}`,
                    },
                    label,
                );
                button.addEventListener("click", () => {
                    activeTab = id;
                    rebuildTabs();
                    render();
                });
                tabBar.append(button);
            }
        };
        rebuildTabs();
        renderBrowse();

        content.append(
            el(
                "div",
                { className: "gw-head" },
                el("h2", { className: "gw-title" }, state.npcName || "Mercado"),
                tabBar,
            ),
            panel,
        );
        openWindow("market", content);
    };

    // ---------------- Bail (fianza) ----------------

    const renderBail = (state: BailOffer): void => {
        const stat = (label: string, value: string, ok?: boolean) =>
            el(
                "div",
                { className: "gw-stat" },
                el("div", { className: "gw-stat-label" }, label),
                el(
                    "div",
                    {
                        className: `gw-stat-value${ok === undefined ? "" : ok ? " ok" : " err"}`,
                    },
                    value,
                ),
            );

        const payButton = el(
            "button",
            { type: "button", className: "gw-action gw-pay" },
            "Pagar fianza",
        ) as HTMLButtonElement;
        payButton.disabled = !state.canPay;
        payButton.addEventListener("click", () => {
            deps.getGame()?.sendChat("/fianza pagar");
        });

        openWindow(
            "bail",
            el(
                "div",
                {},
                el(
                    "div",
                    { className: "gw-head" },
                    el("h2", { className: "gw-title" }, "Fianza"),
                    el(
                        "p",
                        { className: "gw-note" },
                        "Paga tu deuda en oro para volver a ser ciudadano.",
                    ),
                ),
                el(
                    "div",
                    { className: "gw-stats" },
                    stat("Muertes", formatNumber(state.kills)),
                    stat("Oro requerido", formatNumber(state.goldRequired)),
                    stat(
                        "Oro disponible",
                        formatNumber(state.goldAvailable),
                        state.canPay,
                    ),
                ),
                el(
                    "div",
                    { className: `gw-note${state.canPay ? " ok" : " err"}` },
                    `Ciudadanos: ${formatNumber(state.citizensKilled)} · Veces pagadas: ${formatNumber(state.fianza)}. ${
                        state.canPay
                            ? "Tienes el oro suficiente."
                            : "No tienes suficiente oro."
                    }`,
                ),
                el("div", { className: "gw-toolbar" }, payButton),
            ),
        );
    };

    // ---------------- Crafting ----------------

    const renderCrafting = (state: CraftingState): void => {
        const inventory = deps.getInventory();
        let selectedItemId: number | null = state.recipes[0]?.itemId ?? null;

        const listEl = el("div", { className: "gw-list gw-recipes" });
        const detailEl = el("div", { className: "gw-side" });

        const renderDetail = () => {
            detailEl.replaceChildren();
            const recipe =
                state.recipes.find((entry) => entry.itemId === selectedItemId) ??
                null;
            if (!recipe) {
                detailEl.append(
                    el("div", { className: "panel-empty" }, "No hay recetas."),
                );
                return;
            }

            const amountInput = el("input", {
                type: "text",
                inputmode: "numeric",
                value: "1",
                className: "gw-amount",
            }) as HTMLInputElement;

            const materialsEl = el("div", { className: "gw-list" });
            const craftButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Craftear",
            ) as HTMLButtonElement;
            craftButton.addEventListener("click", () =>
                deps
                    .getGame()
                    ?.craftItem(
                        state.profession,
                        recipe.itemId,
                        parseAmountInput(amountInput.value),
                    ),
            );

            const refreshMaterials = () => {
                const amount = parseAmountInput(amountInput.value);
                const needs = getRecipeMaterialNeeds(recipe, inventory, amount);
                materialsEl.replaceChildren(
                    ...needs.map((need) =>
                        el(
                            "div",
                            { className: `gw-row${need.enough ? "" : " missing"}` },
                            el("span", {}, need.name),
                            el(
                                "span",
                                {
                                    className: need.enough ? "gw-ok" : "gw-err",
                                },
                                `${need.owned} / ${need.required}`,
                            ),
                        ),
                    ),
                );
                craftButton.disabled = !canCraftRecipe(
                    recipe,
                    inventory,
                    amount,
                );
            };
            amountInput.addEventListener("input", refreshMaterials);
            refreshMaterials();

            detailEl.append(
                el(
                    "div",
                    { className: "gw-detail-head" },
                    iconNode(recipe.grhIndex, recipe.name),
                    el(
                        "div",
                        {},
                        el("div", { className: "gw-detail-name" }, recipe.name),
                        el(
                            "div",
                            { className: "gw-detail-line" },
                            `${recipe.category} · Skill ${recipe.skill}`,
                        ),
                    ),
                ),
            );
            if (recipe.details) {
                detailEl.append(
                    el("div", { className: "gw-note" }, recipe.details),
                );
            }
            if (recipe.stats) {
                detailEl.append(
                    el("div", { className: "gw-note" }, recipe.stats),
                );
            }
            detailEl.append(
                el("div", { className: "gw-col-title" }, "Materiales"),
                materialsEl,
                el(
                    "div",
                    { className: "gw-amount-row" },
                    amountInput,
                    craftButton,
                ),
            );
        };

        const renderList = () => {
            listEl.replaceChildren();
            for (const recipe of state.recipes) {
                const row = el(
                    "button",
                    {
                        type: "button",
                        className: `gw-recipe${recipe.itemId === selectedItemId ? " active" : ""}`,
                    },
                    iconNode(recipe.grhIndex, recipe.name),
                    el(
                        "span",
                        {},
                        el("span", { className: "gw-detail-name" }, recipe.name),
                        el(
                            "span",
                            { className: "gw-detail-line" },
                            `${recipe.category} · Skill ${recipe.skill}`,
                        ),
                    ),
                );
                row.addEventListener("click", () => {
                    selectedItemId = recipe.itemId;
                    renderList();
                    renderDetail();
                });
                listEl.append(row);
            }
        };
        renderList();
        renderDetail();

        openWindow(
            "crafting",
            el(
                "div",
                {},
                el(
                    "div",
                    { className: "gw-head" },
                    el("h2", { className: "gw-title" }, state.title || "Crafteo"),
                ),
                el("div", { className: "gw-columns" }, listEl, detailEl),
            ),
        );
    };

    // ---------------- Retos ----------------

    const renderRetos = (state: RetosState): void => {
        const characterId = deps.getCharacterId();
        const retosAction = deps.getGame()?.retosAction.bind(deps.getGame());

        const listEl = el("div", { className: "gw-list" });
        if (state.challenges.length === 0) {
            listEl.append(
                el("div", { className: "panel-empty" }, "No hay retos abiertos."),
            );
        }
        for (const challenge of state.challenges) {
            const own = isOwnChallenge(challenge.proposer.id, characterId);
            const actionButton = el(
                "button",
                { type: "button", className: "gw-action" },
                own ? "Cancelar" : "Unirte",
            );
            actionButton.addEventListener("click", () =>
                retosAction?.(own ? "cancel" : "join", {
                    challengeId: challenge.id,
                }),
            );
            listEl.append(
                el(
                    "div",
                    { className: "gw-row gw-challenge" },
                    el(
                        "div",
                        {},
                        el(
                            "div",
                            { className: "gw-detail-name" },
                            `${challenge.teamSize}vs${challenge.teamSize}`,
                        ),
                        ...challenge.participants.map((participant) =>
                            el(
                                "div",
                                { className: "gw-detail-line" },
                                `${participant.name} · Nivel ${participant.level} · ${participant.className}`,
                            ),
                        ),
                    ),
                    actionButton,
                ),
            );
        }

        const create1 = el(
            "button",
            { type: "button", className: "gw-action" },
            "Crear 1vs1",
        );
        create1.addEventListener("click", () =>
            retosAction?.("create", { teamSize: 1 }),
        );
        const create2 = el(
            "button",
            { type: "button", className: "gw-action" },
            "Crear 2vs2",
        );
        create2.addEventListener("click", () =>
            retosAction?.("create", { teamSize: 2 }),
        );
        const refresh = el(
            "button",
            { type: "button", className: "gw-action" },
            "Refrescar",
        );
        refresh.addEventListener("click", () => retosAction?.("refresh"));

        openWindow(
            "retos",
            el(
                "div",
                {},
                el(
                    "div",
                    { className: "gw-head" },
                    el("h2", { className: "gw-title" }, "Retos"),
                    el(
                        "p",
                        { className: "gw-note" },
                        "Vivo y en zona segura. En 2vs2, party de 2.",
                    ),
                    el(
                        "div",
                        { className: "gw-toolbar" },
                        create1,
                        create2,
                        refresh,
                    ),
                ),
                listEl,
            ),
        );
    };

    // Ventana del entrenador (VB6 frmEntrenador): una fila por criatura con
    // su boton Invocar y el cupo usado/maximo. El server reenvia el estado
    // actualizado tras cada invocacion.
    const renderTrainer = (state: TrainerState): void => {
        const list = el("div", { className: "gw-list" });

        if (!state.criaturas.length) {
            list.append(
                el("div", { className: "panel-empty" }, "No hay criaturas."),
            );
        }

        for (const criatura of state.criaturas) {
            const invokeButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Invocar",
            );
            invokeButton.addEventListener("click", () =>
                deps
                    .getGame()
                    ?.trainerAction("invoke", { index: criatura.index }),
            );
            list.append(
                el(
                    "div",
                    { className: "gw-row" },
                    el(
                        "div",
                        { className: "gw-market-group-info" },
                        el(
                            "div",
                            { className: "gw-detail-name" },
                            `${criatura.index}) ${criatura.name}`,
                        ),
                    ),
                    invokeButton,
                ),
            );
        }

        openWindow(
            "trainer",
            el(
                "div",
                {},
                el(
                    "div",
                    { className: "gw-head" },
                    el(
                        "h2",
                        { className: "gw-title" },
                        state.npcName || "Entrenador",
                    ),
                    el(
                        "div",
                        { className: "gw-note" },
                        `${state.used}/${state.max} criaturas`,
                    ),
                ),
                list,
            ),
        );
    };

    // Ventana del correo (VB6 frmCorreo): lista de mensajes con remitente y
    // fecha; cada fila se expande para leer el texto y tiene boton Borrar
    // (VB6 BorrarCorreo). El formulario de redaccion envia destinatario +
    // mensaje (VB6 SendCorreo; el envio de items del VB6 queda fuera).
    const renderCorreo = (state: CorreoState): void => {
        const list = el("div", { className: "gw-list" });

        if (!state.mensajes.length) {
            list.append(
                el("div", { className: "panel-empty" }, "No hay mensajes."),
            );
        }

        for (const mensaje of state.mensajes) {
            const deleteButton = el(
                "button",
                { type: "button", className: "gw-action" },
                "Borrar",
            );
            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                deps.getGame()?.correoAction("delete", { index: mensaje.index });
            });

            const body = el(
                "div",
                { className: "gw-correo-body", style: "display:none" },
                el("div", { className: "gw-correo-text" }, mensaje.mensaje),
                deleteButton,
            );

            const head = el(
                "div",
                { className: "gw-row" },
                el(
                    "div",
                    { className: "gw-market-group-info" },
                    el(
                        "div",
                        { className: "gw-detail-name" },
                        `${mensaje.index}) ${mensaje.remitente}`,
                    ),
                    el(
                        "div",
                        { className: "gw-note" },
                        mensaje.fecha,
                    ),
                ),
            );
            head.addEventListener("click", () => {
                body.style.display =
                    body.style.display === "none" ? "" : "none";
            });

            list.append(el("div", { className: "gw-correo-item" }, head, body));
        }

        const destinatarioInput = el("input", {
            type: "text",
            className: "gw-input",
            placeholder: "Destinatario",
            maxLength: 50,
        }) as HTMLInputElement;
        const mensajeInput = el("textarea", {
            className: "gw-input gw-correo-compose-text",
            placeholder: "Mensaje",
            maxLength: 600,
            rows: 4,
        }) as HTMLTextAreaElement;
        const sendButton = el(
            "button",
            { type: "button", className: "gw-action" },
            "Enviar",
        );
        sendButton.addEventListener("click", () => {
            const destinatario = destinatarioInput.value.trim();
            const texto = mensajeInput.value.trim();

            if (!destinatario || !texto) {
                return;
            }

            deps.getGame()?.correoAction("send", {
                destinatario,
                mensaje: texto,
            });
            mensajeInput.value = "";
        });

        openWindow(
            "correo",
            el(
                "div",
                {},
                el(
                    "div",
                    { className: "gw-head" },
                    el("h2", { className: "gw-title" }, "Correo"),
                ),
                list,
                el(
                    "div",
                    { className: "gw-correo-compose" },
                    destinatarioInput,
                    mensajeInput,
                    sendButton,
                ),
            ),
        );
    };

    // ---------------- public API ----------------
    return {
        setTradeState(state) {
            if (state) {
                renderTrade(state);
            } else if (openKind === "trade") {
                closeCurrent();
            }
        },
        setMarketState(state) {
            if (state) {
                renderMarket(state);
            } else if (openKind === "market") {
                closeCurrent();
            }
        },
        setBailState(state) {
            if (state) {
                renderBail(state);
            } else if (openKind === "bail") {
                closeCurrent();
            }
        },
        setCraftingState(state) {
            if (state) {
                renderCrafting(state);
            } else if (openKind === "crafting") {
                closeCurrent();
            }
        },
        setRetosState(state) {
            if (state) {
                renderRetos(state);
            } else if (openKind === "retos") {
                closeCurrent();
            }
        },
        setTrainerState(state) {
            if (state) {
                renderTrainer(state);
            } else if (openKind === "trainer") {
                closeCurrent();
            }
        },
        setCorreoState(state) {
            if (state) {
                renderCorreo(state);
            } else if (openKind === "correo") {
                closeCurrent();
            }
        },
        closeAll: closeCurrent,
        destroy() {
            removeEscapeListener();
            closeCurrent();
        },
    };
}
