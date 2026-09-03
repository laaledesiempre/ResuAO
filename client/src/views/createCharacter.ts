import { el, getSession, setSession } from "../ui";
import { createCharacter, ApiError } from "../api";
import {
    characterClassOptions,
    getBaseStats,
    getHeadIds,
    getRaceAppearance,
    raceOptions,
    type CharacterClassKey,
    type GenderKey,
    type RaceKey,
} from "../lib/characterCreation";
import {
    DISPLAY_NAME_MAX_LENGTH,
    getDisplayNameError,
} from "../lib/name-validation";
import {
    drawCharacterPreview,
    isRenderableHead,
    loadCreationDBs,
} from "../spritePreview";

export function renderCreateCharacter(
    root: HTMLElement,
    navigate: (path: string) => void,
): void {
    if (!getSession()) {
        navigate("/login");
        return;
    }

    let selectedClass: CharacterClassKey = "guerrero";
    let selectedRace: RaceKey = "humano";
    let selectedGender: GenderKey = "male";
    let selectedHeadIndex = 0;
    let dbs: Awaited<ReturnType<typeof loadCreationDBs>> | null = null;

    const nameInput = el("input", {
        type: "text",
        maxlength: String(DISPLAY_NAME_MAX_LENGTH),
    });
    const errorBox = el("div", { className: "form-error" });
    const previewCanvas = el("canvas", {
        className: "cc-preview-canvas",
        width: "224",
        height: "224",
    }) as HTMLCanvasElement;
    const headLabel = el("span", {}, "-");
    const statsBox = el("div", { className: "cc-stats" });
    const submitButton = el(
        "button",
        { type: "submit" },
        "Crear personaje",
    ) as HTMLButtonElement;

    const getAvailableHeadIds = (): number[] => {
        const headIds = getHeadIds(selectedRace, selectedGender);
        const loaded = dbs;
        if (!loaded) return headIds;
        return headIds.filter((id) =>
            isRenderableHead(id, loaded.headsDB, loaded.graphicsDB),
        );
    };

    const refresh = () => {
        const appearance = getRaceAppearance(selectedRace, selectedGender);
        const available = getAvailableHeadIds();
        if (selectedHeadIndex >= available.length) selectedHeadIndex = 0;
        const headId = available[selectedHeadIndex] ?? 0;
        headLabel.textContent = headId ? `Cabeza ${headId}` : "-";

        if (dbs && headId) {
            void drawCharacterPreview(
                previewCanvas,
                dbs.graphicsDB,
                dbs.bodiesDB,
                dbs.headsDB,
                appearance.bodyId,
                headId,
            );
        }

        const stats = getBaseStats(selectedClass, selectedRace);
        statsBox.textContent = "";
        const items: Array<[string, number]> = [
            ["HP", stats.vida],
            ["MP", stats.mana],
            ["Golpe", stats.golpeMax],
            ["Fue", stats.fuerza],
            ["Agi", stats.agilidad],
            ["Con", stats.constitucion],
            ["Int", stats.inteligencia],
            ["Car", stats.carisma],
        ];
        for (const [label, value] of items) {
            statsBox.append(
                el(
                    "div",
                    { className: "cc-stat" },
                    el("div", { className: "cc-stat-label" }, label),
                    el("div", { className: "cc-stat-value" }, String(value)),
                ),
            );
        }
    };

    const optionButton = (
        label: string,
        isActive: () => boolean,
        onClick: () => void,
    ): HTMLButtonElement => {
        const button = el(
            "button",
            { type: "button", className: "secondary" },
            label,
        ) as HTMLButtonElement;
        const sync = () => {
            button.style.borderColor = isActive() ? "var(--accent)" : "";
            button.style.color = isActive() ? "var(--text)" : "";
        };
        button.addEventListener("click", () => {
            onClick();
            syncAll();
            refresh();
        });
        syncFns.push(sync);
        return button;
    };

    const syncFns: Array<() => void> = [];
    const syncAll = () => syncFns.forEach((fn) => fn());

    const genderButtons = (
        [
            ["male", "Masculino"],
            ["female", "Femenino"],
        ] as const
    ).map(([key, label]) =>
        optionButton(
            label,
            () => selectedGender === key,
            () => {
                selectedGender = key;
                selectedHeadIndex = 0;
            },
        ),
    );

    const classButtons = characterClassOptions.map((option) =>
        optionButton(
            option.label,
            () => selectedClass === option.key,
            () => {
                selectedClass = option.key;
            },
        ),
    );

    const raceButtons = raceOptions.map((option) =>
        optionButton(
            option.label,
            () => selectedRace === option.key,
            () => {
                selectedRace = option.key;
                selectedHeadIndex = 0;
            },
        ),
    );

    const prevHead = el("button", { type: "button", className: "secondary" }, "<");
    const nextHead = el("button", { type: "button", className: "secondary" }, ">");
    const cycleHead = (delta: number) => {
        const total = getAvailableHeadIds().length;
        if (!total) return;
        selectedHeadIndex = (selectedHeadIndex + delta + total) % total;
        refresh();
    };
    prevHead.addEventListener("click", () => cycleHead(-1));
    nextHead.addEventListener("click", () => cycleHead(1));

    const form = el(
        "form",
        { className: "cc-form" },
        el(
            "div",
            { className: "cc-left" },
            el(
                "div",
                { className: "cc-preview-row" },
                prevHead,
                previewCanvas,
                nextHead,
            ),
            el("div", { className: "cc-head-label" }, headLabel),
            statsBox,
        ),
        el(
            "div",
            { className: "cc-right" },
            el(
                "div",
                { className: "form-field" },
                el("label", {}, "Nombre"),
                nameInput,
            ),
            el(
                "div",
                { className: "form-field" },
                el("label", {}, "Genero"),
                el("div", { className: "two-col" }, ...genderButtons),
            ),
            el(
                "div",
                { className: "form-field" },
                el("label", {}, "Clase"),
                el(
                    "div",
                    {
                        style: "display:grid; grid-template-columns:repeat(2,1fr); gap:8px;",
                    },
                    ...classButtons,
                ),
            ),
            el(
                "div",
                { className: "form-field" },
                el("label", {}, "Raza"),
                el(
                    "div",
                    {
                        style: "display:grid; grid-template-columns:repeat(3,1fr); gap:8px;",
                    },
                    ...raceButtons,
                ),
            ),
            errorBox,
            el("div", { className: "form-actions" }, submitButton),
            el(
                "div",
                { className: "form-footer" },
                el("a", { href: "#/characters" }, "Volver a personajes"),
            ),
        ),
    );

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        errorBox.textContent = "";

        const trimmedName = nameInput.value.trim();
        if (!trimmedName) {
            errorBox.textContent =
                "Necesitas escribir un nombre para tu personaje.";
            return;
        }
        const nameError = getDisplayNameError(trimmedName);
        if (nameError) {
            errorBox.textContent = nameError;
            return;
        }

        const available = getAvailableHeadIds();
        const headId = available[selectedHeadIndex] ?? available[0];
        if (!headId) {
            errorBox.textContent =
                "No hay una cabeza valida para esta combinacion.";
            return;
        }

        submitButton.disabled = true;
        createCharacter({
            name: trimmedName,
            class: selectedClass,
            race: selectedRace,
            gender: selectedGender,
            headId,
        })
            .then((session) => {
                setSession(session);
                navigate("/characters");
            })
            .catch((error) => {
                errorBox.textContent =
                    error instanceof ApiError
                        ? error.message
                        : "Error inesperado al crear el personaje";
            })
            .finally(() => {
                submitButton.disabled = false;
            });
    });

    root.append(
        el(
            "div",
            { className: "view-center cc-view" },
            el(
                "div",
                { className: "panel wide cc-panel" },
                el("h1", {}, "Crear personaje"),
                form,
            ),
        ),
    );

    refresh();
    loadCreationDBs()
        .then((loaded) => {
            dbs = loaded;
            refresh();
        })
        .catch((error) => {
            console.error("Error cargando assets de creacion:", error);
        });
}
