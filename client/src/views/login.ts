import { el, getSiteConfig, setSession } from "../ui";
import { login, ApiError } from "../api";
import type { SiteConfig } from "../lib/siteConfig";

// Discrete floating music player (bottom-right). Browsers block autoplay
// with sound, so when autoplay is configured we start on the first
// pointerdown anywhere; if play() still fails, we stay paused.
function mountMusicPlayer(root: HTMLElement, config: SiteConfig): void {
    if (!config.music.url) return;

    const audio = new Audio(config.music.url);
    audio.volume = config.music.volume;
    audio.loop = true;

    const button = el(
        "button",
        {
            type: "button",
            className: "music-player-btn",
            title: "Reproducir musica",
        },
        "♪",
    ) as HTMLButtonElement;

    const sync = () => {
        const playing = !audio.paused;
        button.classList.toggle("playing", playing);
        button.title = playing ? "Pausar musica" : "Reproducir musica";
    };

    button.addEventListener("click", () => {
        if (audio.paused) {
            void audio.play().catch(() => sync());
        } else {
            audio.pause();
        }
        sync();
    });

    root.append(el("div", { className: "music-player" }, button));

    if (config.music.autoplay) {
        const startOnce = () => {
            document.removeEventListener("pointerdown", startOnce);
            void audio.play().then(sync).catch(() => sync());
        };
        document.addEventListener("pointerdown", startOnce);
    }
}

export function renderLogin(
    root: HTMLElement,
    navigate: (path: string) => void,
): void {
    const config = getSiteConfig();
    const identifierInput = el("input", {
        type: "text",
        autocomplete: "username",
        placeholder: "Usuario o email",
    });
    const passwordInput = el("input", {
        type: "password",
        autocomplete: "current-password",
        placeholder: "Contrasena",
    });
    const errorBox = el("div", { className: "form-error" });
    const submitButton = el(
        "button",
        { type: "submit" },
        "Iniciar sesion",
    ) as HTMLButtonElement;

    const form = el(
        "form",
        {},
        config.logoUrl
            ? el("img", {
                  className: "login-logo",
                  src: config.logoUrl,
                  alt: config.brandName,
              })
            : null,
        el("h1", {}, config.texts.loginTitle || config.brandName),
        el("h2", {}, config.texts.loginSubtitle),
        el("div", { className: "login-tagline" }, config.tagline),
        config.messages.loginNotice
            ? el("div", { className: "login-notice" }, config.messages.loginNotice)
            : null,
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Usuario o email"),
            identifierInput,
        ),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Contrasena"),
            passwordInput,
        ),
        errorBox,
        el("div", { className: "form-actions" }, submitButton),
        el(
            "div",
            { className: "form-footer" },
            "No tienes cuenta? ",
            el("a", { href: "#/register" }, "Crear cuenta"),
        ),
        config.texts.footer
            ? el("div", { className: "brand-footer" }, config.texts.footer)
            : null,
    );

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        errorBox.textContent = "";
        submitButton.disabled = true;

        login({
            identifier: identifierInput.value.trim(),
            password: passwordInput.value,
        })
            .then((session) => {
                setSession(session);
                navigate("/characters");
            })
            .catch((error) => {
                errorBox.textContent =
                    error instanceof ApiError
                        ? error.message
                        : "No se pudo conectar con el servidor.";
            })
            .finally(() => {
                submitButton.disabled = false;
            });
    });

    const viewAttrs: Record<string, string> = { className: "view-center" };

    root.append(
        el(
            "div",
            viewAttrs,
            el("div", { className: "panel" }, form),
        ),
    );

    mountMusicPlayer(root, config);
}
