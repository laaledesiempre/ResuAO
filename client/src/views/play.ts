import { el, getSelectedCharacter, getSession, getSiteConfig, showToast } from "../ui";
import { fetchGameTicket, ApiError } from "../api";
import { DEFAULT_WS_URL } from "../config";
import { startGame, type GameHandle } from "../game/bootstrap";
import { createGameWindows } from "./gameWindows";
import { createLoadingOverlay } from "./loadingOverlay";
import { isDebugEnabled } from "../lib/siteConfig";
import { inventoryIconLayout, zoomIconLayout } from "../lib/inventoryIcons";
import { deriveHudEvents } from "../lib/hudEvents";
import { resolveHeadPortrait } from "../lib/portrait";
import { OBJECT_TYPE, type PlayerHudState } from "../lib/aowProtocol";
import {
    HOTKEYS_STORAGE_KEY,
    isHotkeyMatch,
    normalizeHotkeySettings,
} from "../lib/hotkeys";
import { buildCheatsheetEntries } from "../lib/cheatsheet";
import {
    computeWorldMapMarker,
    type WorldMapGridData,
} from "../lib/worldMap";
import type { GraphicsDB, HeadsDB } from "../types/game";

// Inline SVG icons (currentColor) for the player card.
const ICON_HEART =
    '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.7-10-9C-.2 8.4 1.6 4.5 5.5 4.5c2.4 0 4.1 1.3 6.5 3.6 2.4-2.3 4.1-3.6 6.5-3.6 3.9 0 5.7 3.9 3.5 7.5-2.5 4.3-10 9-10 9z"/></svg>';
const ICON_FLAME =
    '<svg viewBox="0 0 24 24"><path d="M12 2c.8 4.2-3.5 5.6-3.5 9.5a3.5 3.5 0 007 0c0-1.4-.8-2.4-.8-2.4s2.9 1.2 2.9 4.4a5.5 5.5 0 01-11 0C6.6 8.2 11.6 6.4 12 2z"/></svg>';
const ICON_COIN =
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="1.6"/></svg>';
const ICON_LOGOUT =
    '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4v-2h4V5h-4V3zm-4.3 4.3L16.4 12l-5.7 4.7v-3.2H4v-3h6.7V7.3z"/></svg>';
const ICON_GEAR =
    '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 000-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-1.7-1L14.8 3h-4l-.5 2.6a7.6 7.6 0 00-1.7 1l-2.4-1-2 3.4L6.2 11a7.5 7.5 0 000 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 001.7 1l.5 2.6h4l.5-2.6a7.6 7.6 0 001.7-1l2.4 1 2-3.4-2-1.6zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z"/></svg>';

function svgIcon(className: string, svg: string): HTMLElement {
    const icon = el("span", { className });
    icon.innerHTML = svg;
    return icon;
}

const INVENTORY_SLOT_COUNT = 24;
const INVENTORY_COLUMNS = 4;
const ICON_SLOT_SIZE = 40;
const PORTRAIT_SIZE = 56;
const PORTRAIT_ZOOM = 1.15;

// Settings drawer preferences (localStorage).
const VOLUME_STORAGE_KEY = "resu:volume";
const MUTED_STORAGE_KEY = "resu:muted";
const MUSIC_STORAGE_KEY = "resu:music";
const CHEATSHEET_STORAGE_KEY = "resu:cheatsheet";

// Lazily fetched, cached DBs for the player-card portrait.
let portraitDBsPromise: Promise<{
    graphicsDB: GraphicsDB;
    headsDB: HeadsDB;
}> | null = null;

function loadPortraitDBs() {
    if (!portraitDBsPromise) {
        portraitDBsPromise = Promise.all([
            fetch("/init/graficos.json").then((r) => r.json()),
            fetch("/init/heads.json").then((r) => r.json()),
        ]).then(([graphicsDB, headsDB]) => ({ graphicsDB, headsDB }));
        portraitDBsPromise.catch(() => {
            portraitDBsPromise = null;
        });
    }
    return portraitDBsPromise;
}

const EQUIPPABLE_OBJ_TYPES = new Set<number>([
    OBJECT_TYPE.armas,
    OBJECT_TYPE.armaduras,
    OBJECT_TYPE.escudos,
    OBJECT_TYPE.cascos,
    OBJECT_TYPE.anillos,
    OBJECT_TYPE.instrumentosMusicales,
    OBJECT_TYPE.flechas,
]);

export function renderPlay(
    root: HTMLElement,
    navigate: (path: string) => void,
): void {
    const session = getSession();
    const character = getSelectedCharacter();
    if (!session || !character) {
        navigate("/characters");
        return;
    }

    const config = getSiteConfig();
    const debugEnabled = isDebugEnabled(config, {
        query: location.search,
        localStorageValue: localStorage.getItem("resu:debug"),
    });

    // ---------- Player card (collapsible) ----------
    // Expanded: portrait (zoomed head) with gold/level underneath, name,
    // bars, position. Collapsed: only the two bars + gold + level inline.
    // A thin XP bar is glued to the card's bottom edge in both modes.
    const portraitBox = el("div", { className: "player-portrait" });
    const playerName = el(
        "span",
        { className: "player-name" },
        character.name ?? "Personaje",
    );

    // Bars: icon at the left of the track, value overlaid inside the track
    // (saves the old label row of vertical space).
    const makeBar = (iconSvg: string, fillClass: string) => {
        const fill = el("div", { className: `bar-fill ${fillClass}` });
        const value = el("span", { className: "bar-value" }, "--");
        return {
            fill,
            value,
            node: el(
                "div",
                { className: "hud-bar" },
                svgIcon("bar-icon", iconSvg),
                el("div", { className: "bar-track" }, fill, value),
            ),
        };
    };
    const hpBar = makeBar(ICON_HEART, "hp");
    const manaBar = makeBar(ICON_FLAME, "mana");

    // Gold/level under the portrait: coin icon + value, "Lv" prefix + value.
    const goldValue = el("span", { className: "hud-stat-value" }, "--");
    const goldStat = el(
        "span",
        { className: "hud-stat hud-stat-gold" },
        svgIcon("stat-icon coin", ICON_COIN),
        goldValue,
    );
    const levelValue = el("span", { className: "hud-stat-value" }, "--");
    const levelStat = el(
        "span",
        { className: "hud-stat hud-stat-level" },
        el("span", { className: "hud-stat-prefix" }, "Lv"),
        levelValue,
    );
    const posStat = el("span", { className: "player-pos" }, "");
    const xpFill = el("div", { className: "xp-fill" });

    let pingStat: HTMLElement | null = null;
    let fpsStat: HTMLElement | null = null;
    const debugStats = el("div", { className: "hud-quick-stats" });
    if (debugEnabled) {
        pingStat = el("span", { className: "hud-stat" }, "Ping: -- ms");
        fpsStat = el("span", { className: "hud-stat" }, "FPS: --");
        debugStats.append(pingStat, fpsStat);
    }

    const exitButton = el("button", {
        type: "button",
        className: "card-icon-btn",
        title: "Salir del juego",
    });
    exitButton.append(svgIcon("btn-icon", ICON_LOGOUT));
    const cardToggle = el(
        "button",
        { type: "button", className: "card-icon-btn", title: "Expandir/colapsar" },
        "–",
    );

    const playerCard = el(
        "div",
        { className: "player-card" },
        el(
            "div",
            { className: "player-card-row" },
            el(
                "div",
                { className: "player-left" },
                portraitBox,
                el(
                    "div",
                    { className: "player-substats" },
                    goldStat,
                    levelStat,
                ),
            ),
            el(
                "div",
                { className: "player-info" },
                el(
                    "div",
                    { className: "player-name-row" },
                    playerName,
                    debugStats,
                ),
                el("div", { className: "player-bars" }, hpBar.node, manaBar.node),
                posStat,
            ),
            el(
                "div",
                { className: "player-card-actions" },
                cardToggle,
                exitButton,
            ),
        ),
        el("div", { className: "xp-bar" }, xpFill),
    );

    // Portrait: resolve the character's head via heads.json + graficos.json
    // (same crop technique as the inventory icons). Falls back to the first
    // letter of the name when the head graphic cannot be resolved.
    const renderPortrait = (headId: number | null | undefined) => {
        loadPortraitDBs()
            .then(({ graphicsDB, headsDB }) => {
                if (destroyed) return;
                const graphic = resolveHeadPortrait(
                    headsDB,
                    graphicsDB,
                    headId ?? character.id_head,
                );
                if (!graphic) return;
                // Zoom so the head fills the circle instead of fitting whole.
                const layout = zoomIconLayout(
                    inventoryIconLayout(graphic, PORTRAIT_SIZE),
                    PORTRAIT_ZOOM,
                    PORTRAIT_SIZE,
                );
                const img = el("img", {
                    src: layout.url,
                    alt: playerName.textContent ?? "",
                    draggable: "false",
                }) as HTMLImageElement;
                img.style.left = `${layout.offsetX}px`;
                img.style.top = `${layout.offsetY}px`;
                img.style.transform = `scale(${layout.scale})`;
                const iconBox = el("div", { className: "inv-icon" }, img);
                iconBox.style.width = `${layout.boxWidth}px`;
                iconBox.style.height = `${layout.boxHeight}px`;
                portraitBox.replaceChildren(iconBox);
                portraitBox.classList.add("has-image");
            })
            .catch(() => {
                /* keep the letter fallback */
            });
    };
    portraitBox.append(
        el(
            "span",
            { className: "portrait-fallback" },
            (character.name ?? "?").charAt(0).toUpperCase(),
        ),
    );
    renderPortrait(character.id_head);

    // ---------- Center: game canvas ----------
    const canvasWrap = el("div", { className: "game-canvas-wrap" });
    const loadingOverlay = el(
        "div",
        { className: "loading-overlay" },
        el("div", { className: "stage" }, "Preparando cliente"),
        el("div", { className: "detail" }, ""),
        el("div", { className: "loading-bar" }, el("div")),
    );
    canvasWrap.append(loadingOverlay);

    // ---------- Left floating stack: world map + cheatsheet (outside the game square) ----------
    const worldMapMarker = el("div", { className: "world-map-marker" });
    const worldMapImage = el("img", {
        className: "world-map-image",
        src: "/imgs/world-map.png",
        alt: "Mapa del mundo",
        draggable: "false",
    }) as HTMLImageElement;
    const mapCard = el(
        "div",
        { className: "map-card hidden" },
        el(
            "div",
            { className: "world-map-frame" },
            worldMapImage,
            worldMapMarker,
        ),
    );

    const hotkeySettings = normalizeHotkeySettings(
        JSON.parse(localStorage.getItem(HOTKEYS_STORAGE_KEY) ?? "null"),
    );
    const cheatsheetList = el("div", { className: "cheatsheet-list" });
    for (const entry of buildCheatsheetEntries(hotkeySettings)) {
        cheatsheetList.append(
            el(
                "div",
                { className: "cheatsheet-row" },
                el("span", { className: "cheatsheet-keys" }, entry.keys),
                el("span", { className: "cheatsheet-action" }, entry.action),
            ),
        );
    }
    const cheatsheetCard = el(
        "div",
        { className: "cheatsheet-card" },
        el("div", { className: "cheatsheet-title" }, "Atajos"),
        cheatsheetList,
    );
    const floatStack = el(
        "div",
        { className: "play-float" },
        mapCard,
        cheatsheetCard,
    );

    // World map grid: loaded once; the card only shows if the current map
    // exists in the grid (i.e. there is a real map image to point at).
    let worldMapGrid: WorldMapGridData | null = null;
    const updateMapMarker = (hud: PlayerHudState) => {
        const marker = worldMapGrid
            ? computeWorldMapMarker(worldMapGrid, hud.map, hud.pos)
            : null;
        mapCard.classList.toggle("hidden", !marker);
        if (marker) {
            worldMapMarker.style.left = `${marker.leftPct}%`;
            worldMapMarker.style.top = `${marker.topPct}%`;
        }
    };
    worldMapImage.addEventListener("error", () => {
        worldMapGrid = null;
        mapCard.classList.add("hidden");
    });
    fetch("/init/world-map.json")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: WorldMapGridData | null) => {
            worldMapGrid = data;
            if (lastHud) {
                updateMapMarker(lastHud);
            }
        })
        .catch(() => {
            worldMapGrid = null;
        });

    // ---------- Right sidebar: tabs + panels ----------
    const inventoryGrid = el("div", { className: "inv-grid" });
    const inventoryPanel = el(
        "div",
        { className: "side-panel", "data-panel": "inventario" },
        inventoryGrid,
    );
    const spellsList = el("div", { className: "spell-list" });
    const spellsPanel = el(
        "div",
        { className: "side-panel", "data-panel": "hechizos" },
        spellsList,
    );
    const socialList = el("div", { className: "stats-list" });
    const socialPanel = el(
        "div",
        { className: "side-panel", "data-panel": "social" },
        socialList,
    );

    const tabDefs = [
        { id: "inventario", label: "Inventario", panel: inventoryPanel },
        { id: "hechizos", label: "Hechizos", panel: spellsPanel },
        { id: "social", label: "Social", panel: socialPanel },
    ] as const;

    const tabButtons = tabDefs.map((def) => {
        const button = el(
            "button",
            { type: "button", className: "side-tab" },
            def.label,
        );
        button.addEventListener("click", () => {
            for (const other of tabDefs) {
                other.panel.classList.toggle("active", other === def);
            }
            for (const otherButton of tabButtons) {
                otherButton.classList.toggle("active", otherButton === button);
            }
        });
        return button;
    });
    tabButtons[0].classList.add("active");
    inventoryPanel.classList.add("active");

    // Accordion header for the sidebar box: tabs when expanded, the active
    // tab label + "+" when collapsed (click re-opens).
    const sideToggle = el(
        "button",
        { type: "button", className: "card-icon-btn", title: "Expandir/colapsar" },
        "–",
    );
    const sideCollapsedLabel = el(
        "span",
        { className: "side-collapsed-label" },
        "Inventario",
    );
    const sideTabs = el("div", { className: "side-tabs" }, ...tabButtons);
    const sideHeader = el(
        "div",
        { className: "side-header" },
        sideCollapsedLabel,
        sideTabs,
        sideToggle,
    );

    const sidebar = el(
        "aside",
        { className: "play-sidebar" },
        sideHeader,
        el(
            "div",
            { className: "side-panels" },
            inventoryPanel,
            spellsPanel,
            socialPanel,
        ),
    );

    // ---------- Chat (collapsible, shares height with the sidebar) ----------
    const chatLog = el("div", { className: "chat-log" });
    const chatInput = el("input", {
        type: "text",
        placeholder: "Escribe un mensaje o comando...",
        maxlength: "160",
    }) as HTMLInputElement;
    const chatSend = el("button", { type: "submit" }, "Enviar");
    const chatForm = el(
        "form",
        { className: "chat-input-row" },
        chatInput,
        chatSend,
    );

    const chatToggle = el(
        "button",
        { type: "button", className: "card-icon-btn", title: "Expandir/colapsar" },
        "–",
    );
    const chatHeader = el(
        "div",
        { className: "side-header" },
        el("span", { className: "side-collapsed-label" }, "Chat"),
        chatToggle,
    );
    const chatBox = el(
        "div",
        { className: "chat-box" },
        chatHeader,
        chatLog,
        chatForm,
    );

    // Draggable splitter: divides the free height between sidebar and chat.
    const splitter = el("div", { className: "side-splitter" });

    const sideColumn = el(
        "div",
        { className: "play-side" },
        playerCard,
        sidebar,
        splitter,
        chatBox,
    );

    const playScreen = el(
        "div",
        { className: "play-screen" },
        floatStack,
        el("div", { className: "play-main" }, canvasWrap),
        sideColumn,
    );
    root.append(playScreen);

    // ---------- Accordion + splitter behavior ----------
    let sideFlex = 1;
    let chatFlex = 0.7;

    const syncFlex = () => {
        sidebar.style.flex = `${sideFlex} 1 0`;
        chatBox.style.flex = `${chatFlex} 1 0`;
    };
    const syncAccordions = () => {
        const sideCollapsed = sidebar.classList.contains("collapsed");
        const chatCollapsed = chatBox.classList.contains("collapsed");
        sideToggle.textContent = sideCollapsed ? "+" : "–";
        chatToggle.textContent = chatCollapsed ? "+" : "–";
        splitter.style.display =
            sideCollapsed || chatCollapsed ? "none" : "";
        if (sideCollapsed || chatCollapsed) {
            sidebar.style.flex = sideCollapsed ? "0 0 auto" : "1 1 0";
            chatBox.style.flex = chatCollapsed ? "0 0 auto" : "1 1 0";
        } else {
            syncFlex();
        }
    };

    sideToggle.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
        syncAccordions();
    });
    chatToggle.addEventListener("click", () => {
        chatBox.classList.toggle("collapsed");
        syncAccordions();
    });
    sideCollapsedLabel.addEventListener("click", () => {
        sidebar.classList.remove("collapsed");
        syncAccordions();
    });
    chatHeader.addEventListener("click", (event) => {
        if (event.target === chatToggle) return;
        if (chatBox.classList.contains("collapsed")) {
            chatBox.classList.remove("collapsed");
            syncAccordions();
        }
    });
    cardToggle.addEventListener("click", () => {
        const collapsed = playerCard.classList.toggle("collapsed");
        cardToggle.textContent = collapsed ? "+" : "–";
    });

    splitter.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const total =
            sidebar.getBoundingClientRect().height +
            chatBox.getBoundingClientRect().height;
        const startSide = sideFlex;
        const startChat = chatFlex;
        document.body.classList.add("side-resizing");
        const onMove = (move: MouseEvent) => {
            const delta = move.clientY - startY;
            if (total <= 0) return;
            const sum = startSide + startChat;
            const nextSide = Math.min(
                sum - 0.2,
                Math.max(0.2, startSide + (delta / total) * sum),
            );
            sideFlex = nextSide;
            chatFlex = sum - nextSide;
            syncFlex();
        };
        const onUp = () => {
            document.body.classList.remove("side-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // Keep the collapsed sidebar label in sync with the active tab.
    for (const [index, def] of tabDefs.entries()) {
        tabButtons[index].addEventListener("click", () => {
            sideCollapsedLabel.textContent = def.label;
        });
    }
    syncAccordions();

    if (config.messages.playWelcome) {
        const line = el(
            "div",
            { className: "line system" },
            config.messages.playWelcome,
        );
        chatLog.append(line);
    }

    const stageEl = loadingOverlay.querySelector(".stage") as HTMLElement;
    const detailEl = loadingOverlay.querySelector(".detail") as HTMLElement;
    const barEl = loadingOverlay.querySelector(
        ".loading-bar > div",
    ) as HTMLElement;

    const loading = createLoadingOverlay({
        root: loadingOverlay,
        stage: stageEl,
        detail: detailEl,
        bar: barEl,
    });

    const appendChat = (text: string, color?: string) => {
        const line = el("div", { className: "line" }, text);
        if (color) line.style.color = color;
        chatLog.append(line);
        while (chatLog.children.length > 100) {
            chatLog.firstChild?.remove();
        }
        chatLog.scrollTop = chatLog.scrollHeight;
    };

    let game: GameHandle | null = null;
    let destroyed = false;
    let lastHud: PlayerHudState | null = null;
    let selectedSlot: number | null = null;
    let inventoryCapObserver: ResizeObserver | null = null;

    const windows = createGameWindows({
        host: playScreen,
        getGame: () => game,
        getInventory: () => lastHud?.inventory ?? [],
        getCharacterId: () => lastHud?.id ?? null,
        getGold: () => lastHud?.gold ?? 0,
    });

    // ---------- HUD panel rendering ----------
    const statRow = (label: string, value: string) =>
        el(
            "div",
            { className: "stat-row" },
            el("span", { className: "stat-label" }, label),
            el("span", { className: "stat-value" }, value),
        );

    const renderInventory = (hud: PlayerHudState) => {
        inventoryGrid.replaceChildren();
        const bySlot = new Map(hud.inventory.map((item) => [item.slot, item]));
        for (let slot = 1; slot <= INVENTORY_SLOT_COUNT; slot++) {
            const item = bySlot.get(slot);
            const slotEl = el("div", {
                className: "inv-slot",
                "data-slot": String(slot),
            });
            if (!item) {
                inventoryGrid.append(slotEl);
                continue;
            }

            slotEl.classList.add("occupied");
            if (item.equipped) slotEl.classList.add("equipped");
            slotEl.title = `${item.name}${item.amount > 1 ? ` x${item.amount}` : ""}\nClick: ${EQUIPPABLE_OBJ_TYPES.has(item.objType) ? "equipar" : "usar"} · Click derecho: tirar`;

            const graphic = game?.resolveIconGraphic(item.grhIndex) ?? null;
            if (graphic) {
                const layout = inventoryIconLayout(graphic, ICON_SLOT_SIZE);
                const img = el("img", {
                    src: layout.url,
                    alt: item.name,
                    draggable: "false",
                }) as HTMLImageElement;
                img.style.left = `${layout.offsetX}px`;
                img.style.top = `${layout.offsetY}px`;
                img.style.transform = `scale(${layout.scale})`;
                const iconBox = el("div", { className: "inv-icon" }, img);
                iconBox.style.width = `${layout.boxWidth}px`;
                iconBox.style.height = `${layout.boxHeight}px`;
                slotEl.append(iconBox);
            } else {
                slotEl.append(
                    el("span", { className: "inv-fallback" }, item.name),
                );
            }

            if (item.amount > 1) {
                slotEl.append(
                    el("span", { className: "inv-amount" }, String(item.amount)),
                );
            }

            slotEl.addEventListener("click", () => {
                selectedSlot = item.slot;
                inventoryGrid
                    .querySelectorAll(".inv-slot.selected")
                    .forEach((s) => s.classList.remove("selected"));
                slotEl.classList.add("selected");
                if (!game) return;
                if (EQUIPPABLE_OBJ_TYPES.has(item.objType)) {
                    game.equipItem(item.slot);
                } else {
                    game.useItem(item.slot);
                }
            });
            slotEl.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                game?.dropItem(item.slot, 1);
            });

            inventoryGrid.append(slotEl);
        }

        // Slots are rebuilt on every HUD update: re-mark the selection.
        if (selectedSlot != null && bySlot.has(selectedSlot)) {
            inventoryGrid
                .querySelector(`.inv-slot[data-slot="${selectedSlot}"]`)
                ?.classList.add("selected");
        }
        layoutInventoryCap();
    };

    // Cap the inventory section to the height of its full grid (rows of
    // INVENTORY_COLUMNS slots) so it never claims more than its content
    // needs; the flex splitter can still compress it (it scrolls internally).
    const layoutInventoryCap = () => {
        const slot = inventoryGrid.querySelector(".inv-slot") as HTMLElement;
        if (!slot || slot.offsetWidth === 0) return;
        const gap = parseFloat(getComputedStyle(inventoryGrid).rowGap) || 0;
        const rows = Math.ceil(INVENTORY_SLOT_COUNT / INVENTORY_COLUMNS);
        const gridHeight = rows * slot.offsetHeight + (rows - 1) * gap;
        inventoryPanel.style.maxHeight = `${Math.ceil(gridHeight) + 16}px`;
        sidebar.style.maxHeight = `${Math.ceil(gridHeight) + 16 + sideHeader.offsetHeight}px`;
    };

    const renderSpells = (hud: PlayerHudState) => {
        spellsList.replaceChildren();
        if (hud.spells.length === 0) {
            spellsList.append(
                el("div", { className: "panel-empty" }, "No conoces hechizos."),
            );
            return;
        }
        for (const spell of hud.spells) {
            const lacksMana = (hud.mana ?? 0) < spell.manaRequired;
            const row = el(
                "button",
                {
                    type: "button",
                    className: "spell-row",
                    title: lacksMana
                        ? "Mana insuficiente"
                        : "Lanzar (luego click sobre el objetivo)",
                },
                el("span", { className: "spell-name" }, spell.name),
                el(
                    "span",
                    { className: "spell-mana" },
                    `Mana: ${spell.manaRequired}`,
                ),
            ) as HTMLButtonElement;
            row.disabled = lacksMana;
            row.addEventListener("click", () => game?.castSpell(spell));
            spellsList.append(row);
        }
    };

    const renderSocial = (hud: PlayerHudState) => {
        const memberRow = (
            member: { nameCharacter: string; map: number; online: boolean },
            extra?: string,
        ) =>
            statRow(
                `${member.nameCharacter}${extra ?? ""}`,
                member.online ? `mapa ${member.map}` : "offline",
            );
        const partyMembers = hud.partyMembers ?? [];
        const clanMembers = hud.clanMembers ?? [];
        socialList.replaceChildren(
            el("div", { className: "stat-label social-section" }, "Party"),
            ...(partyMembers.length
                ? partyMembers.map((m) => memberRow(m, m.isLeader ? " ★" : ""))
                : [statRow("Sin party", "")]),
            el("div", { className: "stat-label social-section" }, "Clan"),
            ...(clanMembers.length
                ? clanMembers.map((m) => memberRow(m))
                : [statRow("Sin clan", "")]),
        );
    };

    const flashClass = (target: HTMLElement, className: string) => {
        target.classList.remove(className);
        // force reflow so the animation restarts on rapid consecutive hits
        void target.offsetWidth;
        target.classList.add(className);
    };
    for (const [target, className] of [
        [playerCard, "hp-hit"],
        [playerCard, "level-up"],
    ] as const) {
        target.addEventListener("animationend", () =>
            target.classList.remove(className),
        );
    }

    const updateHud = (hud: PlayerHudState | null) => {
        if (!hud) return;
        const events = deriveHudEvents(lastHud, hud);
        if (events.hpDropped) flashClass(playerCard, "hp-hit");
        if (events.leveledUp) flashClass(playerCard, "level-up");
        if (hud.idHead != null && !portraitBox.classList.contains("has-image")) {
            renderPortrait(hud.idHead);
        }
        lastHud = hud;
        const setBar = (
            bar: typeof hpBar,
            value?: number,
            max?: number,
        ) => {
            const v = Math.max(0, Math.round(value ?? 0));
            const m = Math.max(0, Math.round(max ?? 0));
            bar.value.textContent = m ? `${v}/${m}` : `${v}`;
            bar.fill.style.width = m
                ? `${Math.min(100, (v / m) * 100)}%`
                : "0%";
        };
        setBar(hpBar, hud.hp, hud.maxHp);
        setBar(manaBar, hud.mana, hud.maxMana);
        goldValue.textContent = `${hud.gold ?? 0}`;
        goldStat.title = `Oro: ${hud.gold ?? 0}`;
        levelValue.textContent = `${hud.level ?? "--"}`;
        levelStat.title = `Nivel: ${hud.level ?? "--"}`;
        if (hud.pos) {
            posStat.textContent = `${hud.pos.x},${hud.pos.y} · mapa ${hud.map ?? "?"}`;
        }
        updateMapMarker(hud);
        if (hud.expNextLevel) {
            const pct = Math.min(
                100,
                Math.max(0, ((hud.exp ?? 0) / hud.expNextLevel) * 100),
            );
            xpFill.style.width = `${pct}%`;
        } else {
            xpFill.style.width = "0%";
        }
        renderInventory(hud);
        renderSpells(hud);
        renderSocial(hud);
    };

    inventoryCapObserver = new ResizeObserver(() => layoutInventoryCap());
    inventoryCapObserver.observe(inventoryGrid);

    // Keyboard shortcuts that act on the HUD (not handled by the engine's
    // own keyboardGameplay): use/equip/drop the selected inventory slot,
    // Enter focuses the chat. Skipped while typing in any editable field.
    const handlePlayKeydown = (event: KeyboardEvent) => {
        const target = event.target;
        const typing =
            target instanceof HTMLElement &&
            (target.isContentEditable ||
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT");
        if (typing) return;

        if (event.key === "Enter" && !event.repeat) {
            chatInput.focus();
            event.preventDefault();
            return;
        }

        if (!game || selectedSlot == null || event.repeat) return;
        const item = lastHud?.inventory.find((i) => i.slot === selectedSlot);
        if (!item) return;

        if (isHotkeyMatch(event, hotkeySettings.useItem)) {
            game.useItem(item.slot);
            event.preventDefault();
        } else if (isHotkeyMatch(event, hotkeySettings.equipItem)) {
            game.equipItem(item.slot);
            event.preventDefault();
        } else if (isHotkeyMatch(event, hotkeySettings.dropItem)) {
            game.dropItem(item.slot, 1);
            event.preventDefault();
        }
    };
    document.addEventListener("keydown", handlePlayKeydown);

    const cleanup = () => {
        destroyed = true;
        musicAudio?.pause();
        document.removeEventListener("keydown", handlePlayKeydown);
        inventoryCapObserver?.disconnect();
        windows.destroy();
        game?.destroy();
        game = null;
    };
    (root as any).__cleanup = cleanup;

    // ---------- Exit confirmation modal ----------
    const exitCancel = el(
        "button",
        { type: "button", className: "secondary" },
        "Cancelar",
    );
    const exitConfirm = el("button", { type: "button" }, "Salir");
    const exitModal = el(
        "div",
        { className: "exit-modal" },
        el(
            "div",
            { className: "exit-modal-panel" },
            el("div", { className: "exit-modal-title" }, "¿Salir del juego?"),
            el(
                "div",
                { className: "exit-modal-text" },
                "Volverás al menú de personajes.",
            ),
            el(
                "div",
                { className: "exit-modal-actions" },
                exitCancel,
                exitConfirm,
            ),
        ),
    );
    playScreen.append(exitModal);

    const closeExitModal = () => exitModal.classList.remove("open");
    exitButton.addEventListener("click", () =>
        exitModal.classList.add("open"),
    );
    exitCancel.addEventListener("click", closeExitModal);
    exitModal.addEventListener("click", (event) => {
        if (event.target === exitModal) closeExitModal();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeExitModal();
    });
    exitConfirm.addEventListener("click", () => {
        cleanup();
        navigate("/characters");
    });

    // ---------- Settings drawer (floating gear, bottom-left) ----------
    const storedVolume = Number(localStorage.getItem(VOLUME_STORAGE_KEY));
    let volume = Number.isFinite(storedVolume)
        ? Math.min(100, Math.max(0, storedVolume))
        : 70;
    let muted = localStorage.getItem(MUTED_STORAGE_KEY) === "1";
    let musicOn = localStorage.getItem(MUSIC_STORAGE_KEY) === "1";
    let cheatsheetVisible =
        localStorage.getItem(CHEATSHEET_STORAGE_KEY) !== "0";

    const volumeSlider = el("input", {
        type: "range",
        min: "0",
        max: "100",
        value: String(volume),
        className: "settings-slider",
    }) as HTMLInputElement;
    const muteToggle = el("input", { type: "checkbox" }) as HTMLInputElement;
    muteToggle.checked = muted;
    const musicToggle = el("input", { type: "checkbox" }) as HTMLInputElement;
    musicToggle.checked = musicOn;
    const cheatsheetButton = el(
        "button",
        { type: "button", className: "secondary settings-cheatsheet-btn" },
        "Ver cheatsheet",
    );

    const settingsDrawer = el(
        "div",
        { className: "settings-drawer" },
        el("div", { className: "exit-modal-title" }, "Opciones"),
        el(
            "label",
            { className: "settings-row" },
            el("span", {}, "Volumen"),
            volumeSlider,
        ),
        el(
            "label",
            { className: "settings-row" },
            el("span", {}, "Silenciar sonidos"),
            muteToggle,
        ),
        el(
            "label",
            { className: "settings-row" },
            el("span", {}, "Música"),
            musicToggle,
        ),
        cheatsheetButton,
    );

    const settingsButton = el("button", {
        type: "button",
        className: "settings-fab",
        title: "Opciones",
    });
    settingsButton.append(svgIcon("btn-icon", ICON_GEAR));
    playScreen.append(settingsDrawer, settingsButton);

    // Background music (site config), controlled from the drawer.
    const musicAudio = config.music.url ? new Audio(config.music.url) : null;
    if (musicAudio) musicAudio.loop = true;

    const applyAudioSettings = () => {
        const effective = muted ? 0 : volume / 100;
        game?.setMasterVolume(effective);
        if (musicAudio) {
            musicAudio.volume = effective * (config.music.volume || 1);
            if (musicOn && !muted) {
                void musicAudio.play().catch(() => {});
            } else {
                musicAudio.pause();
            }
        }
    };

    volumeSlider.addEventListener("input", () => {
        volume = Number(volumeSlider.value);
        localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
        applyAudioSettings();
    });
    muteToggle.addEventListener("change", () => {
        muted = muteToggle.checked;
        localStorage.setItem(MUTED_STORAGE_KEY, muted ? "1" : "0");
        applyAudioSettings();
    });
    musicToggle.addEventListener("change", () => {
        musicOn = musicToggle.checked;
        localStorage.setItem(MUSIC_STORAGE_KEY, musicOn ? "1" : "0");
        applyAudioSettings();
    });

    const syncCheatsheet = () => {
        cheatsheetCard.classList.toggle("hidden", !cheatsheetVisible);
        cheatsheetButton.textContent = cheatsheetVisible
            ? "Ocultar cheatsheet"
            : "Ver cheatsheet";
    };
    cheatsheetButton.addEventListener("click", () => {
        cheatsheetVisible = !cheatsheetVisible;
        localStorage.setItem(
            CHEATSHEET_STORAGE_KEY,
            cheatsheetVisible ? "1" : "0",
        );
        syncCheatsheet();
    });
    syncCheatsheet();

    const closeSettings = () => settingsDrawer.classList.remove("open");
    settingsButton.addEventListener("click", () => {
        settingsDrawer.classList.toggle("open");
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeSettings();
    });
    applyAudioSettings();

    chatForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const message = chatInput.value;
        if (!message.trim()) return;
        if (game?.sendChat(message)) {
            chatInput.value = "";
        } else {
            appendChat("No estas conectado al servidor.", "#f87171");
        }
    });

    fetchGameTicket()
        .then(({ ticket }) => {
            if (destroyed) return;
            game = startGame({
                container: canvasWrap,
                wsUrl: DEFAULT_WS_URL,
                ticket,
                mapNumber: character.map ?? 1,
                debug: debugEnabled,
                onLoading: (stage, progress, detail) => {
                    loading.progress(stage, progress, detail);
                },
                onLoadingDone: () => {
                    loading.complete();
                },
                onError: (message) => {
                    loading.error(message);
                },
                onHud: updateHud,
                onChat: (text, color) => appendChat(text, color),
                onPing: (ms) => {
                    if (!pingStat) return;
                    pingStat.textContent =
                        ms == null ? "Ping: -- ms" : `Ping: ${Math.round(ms)} ms`;
                },
                onFps: (fps) => {
                    if (!fpsStat) return;
                    fpsStat.textContent = `FPS: ${fps ?? "--"}`;
                },
                onDisconnect: (reason) => {
                    appendChat(reason ?? "Conexion cerrada.", "#f87171");
                },
                onTradeState: (state) => windows.setTradeState(state),
                onMarketState: (state) => windows.setMarketState(state),
                onRetosState: (state) => windows.setRetosState(state),
                onBailState: (state) => windows.setBailState(state),
                onCraftingState: (state) => windows.setCraftingState(state),
                onNotice: (notice) => showToast(notice.text, notice.durationMs),
            });
            applyAudioSettings();
        })
        .catch((error) => {
            showToast(
                error instanceof ApiError
                    ? error.message
                    : "No se pudo obtener el ticket de juego.",
            );
            navigate("/characters");
        });
}
