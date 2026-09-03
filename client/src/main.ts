import { fetchSession, fetchSiteConfig, ApiError } from "./api";
import { setSession, getSession, setSiteConfig, getSiteConfig, onSiteConfigChange } from "./ui";
import {
    applySiteConfigTheme,
    buildCustomFontCss,
    type SiteConfig,
} from "./lib/siteConfig";
import { renderLogin } from "./views/login";
import { renderRegister } from "./views/register";
import { renderCharacters } from "./views/characters";
import { renderCreateCharacter } from "./views/createCharacter";
import { renderPlay } from "./views/play";
import { renderAdmin } from "./views/admin";
import { renderForceChangePassword } from "./views/forceChangePassword";

type Navigate = (path: string) => void;

const appRoot = document.getElementById("app") as HTMLElement;

// ---------- Brand-driven global chrome ----------
// Keeps the custom @font-face style tag and the global background image in
// sync with the site config, at boot and whenever the config changes.
function applyBranding(config: SiteConfig): void {
    let fontStyle = document.getElementById("brand-fonts");
    const css = buildCustomFontCss(config);
    if (!fontStyle) {
        fontStyle = document.createElement("style");
        fontStyle.id = "brand-fonts";
        document.head.append(fontStyle);
    }
    fontStyle.textContent = css;

    if (config.loginBackgroundUrl) {
        document.documentElement.style.setProperty(
            "--brand-bg-image",
            `linear-gradient(rgba(10, 8, 5, 0.38), rgba(10, 8, 5, 0.58)), url("${config.loginBackgroundUrl}")`,
        );
    } else {
        document.documentElement.style.removeProperty("--brand-bg-image");
    }

    document.title = applySiteConfigTheme(config, document.documentElement);
}

applyBranding(getSiteConfig());
onSiteConfigChange(applyBranding);

function currentPath(): string {
    const hash = window.location.hash.replace(/^#/, "");
    return hash || "/login";
}

function render(): void {
    // run view cleanup (e.g. destroy the game session) before swapping views
    const cleanup = (appRoot as any).__cleanup as (() => void) | undefined;
    if (cleanup) {
        cleanup();
        (appRoot as any).__cleanup = undefined;
    }

    appRoot.textContent = "";
    const path = currentPath();

    // Forced password change: accounts flagged with must_change_password
    // cannot navigate anywhere else until they complete it.
    if (
        getSession()?.account?.must_change_password &&
        path !== "/change-password"
    ) {
        window.location.hash = "#/change-password";
        return;
    }

    const navigate: Navigate = (next) => {
        if (window.location.hash === `#${next}`) {
            render();
        } else {
            window.location.hash = `#${next}`;
        }
    };

    switch (path) {
        case "/login":
            renderLogin(appRoot, navigate);
            break;
        case "/register":
            renderRegister(appRoot, navigate);
            break;
        case "/characters":
            renderCharacters(appRoot, navigate);
            break;
        case "/create-character":
            renderCreateCharacter(appRoot, navigate);
            break;
        case "/change-password":
            if (!getSession()?.account?.must_change_password) {
                navigate(getSession() ? "/characters" : "/login");
            } else {
                renderForceChangePassword(appRoot, navigate);
            }
            break;
        case "/play":
            renderPlay(appRoot, navigate);
            break;
        case "/admin": {
            const session = getSession();
            if (!session?.account?.is_admin) {
                navigate(session ? "/characters" : "/login");
            } else {
                renderAdmin(appRoot, navigate);
            }
            break;
        }
        default:
            navigate(getSession() ? "/characters" : "/login");
            break;
    }
}

window.addEventListener("hashchange", render);

// Bootstrap: restore cookie session + load site branding BEFORE the first
// render, so a hard reload never paints default brand name/logo. Failures
// keep the defaults silently.
Promise.allSettled([fetchSession(), fetchSiteConfig()]).then(
    ([sessionResult, configResult]) => {
        if (sessionResult.status === "fulfilled") {
            setSession(sessionResult.value);
        } else {
            if (
                !(
                    sessionResult.reason instanceof ApiError &&
                    sessionResult.reason.status === 401
                )
            ) {
                console.warn(
                    "No se pudo restaurar la sesion:",
                    sessionResult.reason,
                );
            }
            setSession(null);
        }

        if (configResult.status === "fulfilled") {
            setSiteConfig(configResult.value);
        } else {
            console.warn(
                "No se pudo cargar la configuracion del sitio:",
                configResult.reason,
            );
        }

        if (!getSession() && currentPath() !== "/register") {
            window.location.hash = "#/login";
        }
        render();
    },
);
