import { el, setSession } from "../ui";
import { changePassword, ApiError } from "../api";

// Forced password change (must_change_password). Rendered as a blocking
// screen with no cancel/close affordance: the router refuses to navigate
// away until the account clears the flag (see main.ts).
export function renderForceChangePassword(
    root: HTMLElement,
    navigate: (path: string) => void,
): void {
    const currentInput = el("input", {
        type: "password",
        autocomplete: "current-password",
        placeholder: "Contrasena actual",
    });
    const newInput = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: "Nueva contrasena",
    });
    const confirmInput = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: "Repeti la nueva contrasena",
    });
    const errorBox = el("div", { className: "form-error" });
    const submitButton = el(
        "button",
        { type: "submit" },
        "Cambiar contrasena",
    ) as HTMLButtonElement;

    const form = el(
        "form",
        {},
        el("h1", {}, "Cambia tu contrasena"),
        el(
            "h2",
            {},
            "Por seguridad tenes que elegir una contrasena nueva para continuar.",
        ),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Contrasena actual"),
            currentInput,
        ),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Nueva contrasena"),
            newInput,
        ),
        el(
            "div",
            { className: "form-field" },
            el("label", {}, "Confirmar nueva contrasena"),
            confirmInput,
        ),
        errorBox,
        el("div", { className: "form-actions" }, submitButton),
    );

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        errorBox.textContent = "";

        if (newInput.value !== confirmInput.value) {
            errorBox.textContent = "Las contrasenas nuevas no coinciden.";
            return;
        }

        submitButton.disabled = true;

        changePassword({
            currentPassword: currentInput.value,
            newPassword: newInput.value,
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
