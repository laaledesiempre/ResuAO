import { el, getSession, getSiteConfig, setSession, showToast } from "../ui";
import { logout, selectCharacter, ApiError } from "../api";

export function renderCharacters(
    root: HTMLElement,
    navigate: (path: string) => void,
): void {
    const session = getSession();
    if (!session) {
        navigate("/login");
        return;
    }

    let selectedId = session.selectedCharacterId;

    const playButton = el(
        "button",
        { type: "button" },
        "Jugar",
    ) as HTMLButtonElement;
    playButton.disabled = !selectedId;

    const grid = el("div", { className: "char-grid" });

    const renderCards = () => {
        grid.textContent = "";
        const current = getSession();
        if (!current) return;

        if (current.characters.length === 0) {
            grid.append(
                el(
                    "div",
                    { className: "char-meta" },
                    "Todavia no tienes personajes. Crea uno para empezar.",
                ),
            );
        }

        for (const character of current.characters) {
            const card = el(
                "div",
                {
                    className: `char-card${character._id === selectedId ? " selected" : ""}`,
                },
                el("div", { className: "char-name" }, character.name),
                el(
                    "div",
                    { className: "char-meta" },
                    `Nivel ${character.level} - ${character.className}`,
                ),
                el("div", { className: "char-meta" }, character.raceName),
            );

            card.addEventListener("click", () => {
                selectCharacter(character._id)
                    .then((nextSession) => {
                        setSession(nextSession);
                        selectedId = nextSession.selectedCharacterId;
                        playButton.disabled = !selectedId;
                        renderCards();
                    })
                    .catch((error) => {
                        showToast(
                            error instanceof ApiError
                                ? error.message
                                : "No se pudo seleccionar el personaje.",
                        );
                    });
            });

            grid.append(card);
        }
    };

    renderCards();

    playButton.addEventListener("click", () => {
        if (getSession()?.selectedCharacterId) {
            navigate("/play");
        }
    });

    const logoutButton = el(
        "button",
        { type: "button", className: "secondary" },
        "Cerrar sesion",
    );
    logoutButton.addEventListener("click", () => {
        logout()
            .catch(() => undefined)
            .finally(() => {
                setSession(null);
                navigate("/login");
            });
    });

    const createButton = el(
        "button",
        { type: "button", className: "secondary" },
        "Crear personaje",
    );
    createButton.addEventListener("click", () => navigate("/create-character"));

    const adminButton = session.account.is_admin
        ? el(
              "button",
              { type: "button", className: "secondary" },
              "Administracion",
          )
        : null;
    adminButton?.addEventListener("click", () => navigate("/admin"));

    root.append(
        el(
            "div",
            { className: "floating-brand" },
            getSiteConfig().brandName,
        ),
        el(
            "div",
            { className: "floating-account" },
            session.account.name,
        ),
        el(
            "div",
            { className: "view-center" },
            el(
                "div",
                { className: "panel wide" },
                el("h1", {}, "Tus personajes"),
                el("h2", {}, getSiteConfig().texts.welcome),
                grid,
                el(
                    "div",
                    { className: "form-actions" },
                    playButton,
                    createButton,
                    adminButton,
                    logoutButton,
                ),
            ),
        ),
    );
}
