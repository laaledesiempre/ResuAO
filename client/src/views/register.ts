import { el, getSiteConfig, setSession } from "../ui";
import { register, ApiError } from "../api";
import { registrationFormRules } from "../lib/registration";

export function renderRegister(
    root: HTMLElement,
    navigate: (path: string) => void,
): void {
    const config = getSiteConfig();
    const rules = registrationFormRules(config.registration);

    if (!rules.registrationOpen) {
        root.append(
            el(
                "div",
                { className: "view-center" },
                el(
                    "div",
                    { className: "panel" },
                    el("h1", {}, config.brandName),
                    el("h2", {}, "Registro"),
                    el(
                        "div",
                        { className: "login-notice" },
                        "El registro de cuentas esta deshabilitado.",
                    ),
                    el(
                        "div",
                        { className: "form-footer" },
                        el("a", { href: "#/login" }, "Ir a iniciar sesion"),
                    ),
                ),
            ),
        );
        return;
    }

    const emailLabel = rules.emailRequired ? "Email" : "Email (opcional)";
    const nameInput = el("input", {
        type: "text",
        autocomplete: "username",
        placeholder: "Nombre de cuenta",
    });
    const emailInput = el("input", {
        type: "email",
        autocomplete: "email",
        placeholder: "correo@ejemplo.com",
    });
    const passwordInput = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: "Contrasena",
    });
    const confirmInput = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: "Repetir contrasena",
    });
    const errorBox = el("div", { className: "form-error" });
    const submitButton = el(
        "button",
        { type: "submit" },
        "Crear cuenta",
    ) as HTMLButtonElement;

    const form = el(
        "form",
        {},
        el("h1", {}, config.brandName),
        el("h2", {}, "Crea tu cuenta"),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Nombre de cuenta"),
            nameInput,
        ),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, emailLabel),
            emailInput,
        ),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Contrasena"),
            passwordInput,
        ),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Confirmar contrasena"),
            confirmInput,
        ),
        errorBox,
        el("div", { className: "form-actions" }, submitButton),
        el(
            "div",
            { className: "form-footer" },
            "Ya tienes cuenta? ",
            el("a", { href: "#/login" }, "Iniciar sesion"),
        ),
    );

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        errorBox.textContent = "";

        if (passwordInput.value !== confirmInput.value) {
            errorBox.textContent = "Las contrasenas no coinciden.";
            return;
        }

        submitButton.disabled = true;

        register({
            name: nameInput.value.trim(),
            email: emailInput.value.trim(),
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

    root.append(
        el(
            "div",
            { className: "view-center" },
            el("div", { className: "panel" }, form),
        ),
    );
}
