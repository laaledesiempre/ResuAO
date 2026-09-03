import { el, getSession, getSiteConfig, setSiteConfig, showToast } from "../ui";
import {
    saveSiteConfig,
    uploadBrandAsset,
    fetchAdminAccounts,
    createAdminAccount,
    updateAdminAccount,
    resetAdminAccountPassword,
    deleteAdminAccount,
    ApiError,
    type AdminAccount,
} from "../api";
import { applySiteConfigTheme, type SiteConfig } from "../lib/siteConfig";
import {
    parseThemeJson,
    themeFilename,
    validateSiteConfigDraft,
} from "../lib/adminTheme";

type Navigate = (path: string) => void;

function cloneConfig(config: SiteConfig): SiteConfig {
    return {
        ...config,
        colors: { ...config.colors },
        texts: { ...config.texts },
        debug: { ...config.debug },
        fonts: { ...config.fonts },
        music: { ...config.music },
        messages: { ...config.messages, serverWelcome: [...config.messages.serverWelcome] },
        registration: { ...config.registration },
    };
}

export function renderAdmin(root: HTMLElement, navigate: Navigate): void {
    const session = getSession();
    if (!session?.account?.is_admin) {
        navigate(session ? "/characters" : "/login");
        return;
    }
    const selfId = session.account._id;

    // Draft holds the current (possibly unsaved) form values.
    let draft = cloneConfig(getSiteConfig());

    const errorBox = el("div", { className: "form-error" });

    // ---------- form field builders ----------

    function textField(
        label: string,
        get: () => string,
        set: (value: string) => void,
    ): { row: HTMLElement; input: HTMLInputElement } {
        const input = el("input", { type: "text", value: get() });
        input.addEventListener("input", () => {
            set(input.value);
            refreshPreview();
        });
        const row = el(
            "div",
            { className: "form-field" },
            el("label", {}, label),
            input,
        );
        return { row, input };
    }

    // A "Subir archivo" button wired to POST /api/admin/upload; the resolved
    // URL is handed back via onUploaded. Disabled while uploading.
    function uploadButton(
        accept: string,
        onUploaded: (url: string) => void,
    ): HTMLElement {
        const fileInput = el("input", {
            type: "file",
            accept,
            style: "display:none",
        });
        const button = el(
            "button",
            { type: "button", className: "secondary admin-upload-btn" },
            "Subir archivo",
        ) as HTMLButtonElement;
        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            fileInput.value = "";
            if (!file) return;
            button.disabled = true;
            button.textContent = "Subiendo...";
            uploadBrandAsset(file)
                .then(({ url }) => {
                    onUploaded(url);
                    showToast("Archivo subido");
                })
                .catch((error: unknown) => {
                    showToast(
                        error instanceof ApiError
                            ? error.message
                            : "No se pudo subir el archivo.",
                    );
                })
                .finally(() => {
                    button.disabled = false;
                    button.textContent = "Subir archivo";
                });
        });
        button.addEventListener("click", () => fileInput.click());
        return el("span", { className: "admin-upload" }, button, fileInput);
    }

    function urlField(
        label: string,
        get: () => string,
        set: (value: string) => void,
        uploadAccept?: string,
    ): { row: HTMLElement; input: HTMLInputElement; thumb: HTMLImageElement } {
        const thumb = el("img", {
            className: "admin-thumb",
            alt: `${label} (vista previa)`,
            style: "display:none",
        });
        // Font/music URLs are not images: hide the thumb if it can't load.
        thumb.addEventListener("error", () => {
            thumb.style.display = "none";
        });
        const field = textField(label, get, (value) => {
            set(value);
            thumb.src = value;
            thumb.style.display = value ? "block" : "none";
        });
        if (uploadAccept) {
            field.row.append(
                uploadButton(uploadAccept, (url) => {
                    field.input.value = url;
                    field.input.dispatchEvent(new Event("input"));
                }),
            );
        }
        field.row.append(thumb);
        return { ...field, thumb };
    }

    function checkboxField(
        label: string,
        get: () => boolean,
        set: (value: boolean) => void,
    ): { row: HTMLElement; input: HTMLInputElement } {
        const input = el("input", { type: "checkbox" });
        if (get()) input.setAttribute("checked", "");
        input.addEventListener("change", () => {
            set(input.checked);
            refreshPreview();
        });
        const row = el(
            "label",
            { className: "admin-checkbox" },
            input,
            ` ${label}`,
        );
        return { row, input };
    }

    function colorField(
        label: string,
        key: keyof SiteConfig["colors"],
    ): { row: HTMLElement; text: HTMLInputElement; swatch: HTMLInputElement } {
        const swatch = el("input", {
            type: "color",
            value: draft.colors[key],
            title: label,
        });
        const text = el("input", {
            type: "text",
            className: "admin-color-text",
            value: draft.colors[key],
            maxlength: "7",
            spellcheck: "false",
        });
        swatch.addEventListener("input", () => {
            text.value = swatch.value;
            draft.colors[key] = swatch.value;
            refreshPreview();
        });
        text.addEventListener("input", () => {
            draft.colors[key] = text.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(text.value.trim())) {
                swatch.value = text.value.trim();
            }
            refreshPreview();
        });
        const row = el(
            "div",
            { className: "admin-color-row" },
            el("label", {}, label),
            swatch,
            text,
        );
        return { row, text, swatch };
    }

    // ---------- sections ----------

    const brandName = textField(
        "Nombre de la marca",
        () => draft.brandName,
        (v) => (draft.brandName = v),
    );
    const tagline = textField(
        "Tagline",
        () => draft.tagline,
        (v) => (draft.tagline = v),
    );
    const logoUrl = urlField(
        "URL del logo",
        () => draft.logoUrl ?? "",
        (v) => (draft.logoUrl = v || null),
        "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg",
    );

    const loginBackgroundUrl = urlField(
        "Fondo de la pantalla de login (URL)",
        () => draft.loginBackgroundUrl ?? "",
        (v) => (draft.loginBackgroundUrl = v || null),
        "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg",
    );

    const FONT_ACCEPT = ".woff,.woff2,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf";
    const fontDisplayUrl = urlField(
        "Fuente de titulos (URL)",
        () => draft.fonts.displayUrl ?? "",
        (v) => (draft.fonts.displayUrl = v || null),
        FONT_ACCEPT,
    );
    const fontBodyUrl = urlField(
        "Fuente de texto (URL)",
        () => draft.fonts.bodyUrl ?? "",
        (v) => (draft.fonts.bodyUrl = v || null),
        FONT_ACCEPT,
    );

    const musicUrl = urlField(
        "URL de la musica",
        () => draft.music.url ?? "",
        (v) => (draft.music.url = v || null),
        "audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav",
    );
    const musicAutoplay = checkboxField(
        "Reproducir automaticamente",
        () => draft.music.autoplay,
        (v) => (draft.music.autoplay = v),
    );
    const musicVolume = el("input", {
        type: "range",
        min: "0",
        max: "1",
        step: "0.05",
        value: String(draft.music.volume),
    });
    musicVolume.addEventListener("input", () => {
        draft.music.volume = Number(musicVolume.value);
    });

    // "Probar" toggles a shared Audio element for the music URL.
    let musicAudio: HTMLAudioElement | null = null;
    const musicTestButton = el(
        "button",
        { type: "button", className: "secondary" },
        "Probar",
    ) as HTMLButtonElement;
    musicTestButton.addEventListener("click", () => {
        if (musicAudio && !musicAudio.paused) {
            musicAudio.pause();
            musicAudio.currentTime = 0;
            musicTestButton.textContent = "Probar";
            return;
        }
        if (!draft.music.url) {
            showToast("Configura una URL de musica primero.");
            return;
        }
        musicAudio?.pause();
        musicAudio = new Audio(draft.music.url);
        musicAudio.volume = draft.music.volume;
        musicAudio
            .play()
            .then(() => {
                musicTestButton.textContent = "Detener";
            })
            .catch(() => {
                showToast("No se pudo reproducir la musica.");
                musicTestButton.textContent = "Probar";
            });
    });

    const loginNotice = el(
        "textarea",
        { rows: "3", className: "admin-textarea" },
        draft.messages.loginNotice,
    );
    loginNotice.addEventListener("input", () => {
        draft.messages.loginNotice = loginNotice.value;
        refreshPreview();
    });
    const loginNoticeRow = el(
        "div",
        { className: "form-field" },
        el("label", {}, "Aviso en la pantalla de login"),
        loginNotice,
    );
    const playWelcome = textField(
        "Mensaje de bienvenida al entrar al juego",
        () => draft.messages.playWelcome,
        (v) => (draft.messages.playWelcome = v),
    );

    // Consola del juego al conectar: una linea por mensaje.
    const serverWelcome = el(
        "textarea",
        { rows: "4", className: "admin-textarea" },
        draft.messages.serverWelcome.join("\n"),
    ) as HTMLTextAreaElement;
    serverWelcome.addEventListener("input", () => {
        draft.messages.serverWelcome = serverWelcome.value
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    });
    const serverWelcomeRow = el(
        "div",
        { className: "form-field" },
        el("label", {}, "Mensajes de bienvenida del servidor (uno por linea)"),
        serverWelcome,
    );

    const registrationEnabled = checkboxField(
        "Permitir crear cuentas",
        () => draft.registration.enabled,
        (v) => (draft.registration.enabled = v),
    );
    const registrationRequireEmail = checkboxField(
        "Requerir email",
        () => draft.registration.requireEmail,
        (v) => (draft.registration.requireEmail = v),
    );

    const loginTitle = textField(
        "Titulo del login",
        () => draft.texts.loginTitle,
        (v) => (draft.texts.loginTitle = v),
    );
    const loginSubtitle = textField(
        "Subtitulo del login",
        () => draft.texts.loginSubtitle,
        (v) => (draft.texts.loginSubtitle = v),
    );
    const welcome = textField(
        "Texto de bienvenida",
        () => draft.texts.welcome,
        (v) => (draft.texts.welcome = v),
    );
    const footer = textField(
        "Pie de pagina",
        () => draft.texts.footer,
        (v) => (draft.texts.footer = v),
    );

    const colorFields = [
        colorField("Acento", "accent"),
        colorField("Acento (hover)", "accentHover"),
        colorField("Fondo", "bg"),
        colorField("Panel", "panel"),
        colorField("Texto", "text"),
    ];

    const fpsCheckbox = checkboxField(
        "Mostrar FPS/Ping en el juego",
        () => draft.debug.showFpsPing,
        (v) => (draft.debug.showFpsPing = v),
    );

    function section(title: string, ...children: Array<Node | string>): HTMLElement {
        return el(
            "fieldset",
            { className: "admin-section" },
            el("legend", {}, title),
            ...children,
        );
    }

    // ---------- live preview ----------

    const previewBox = el("div", { className: "admin-preview-box" });
    // Scoped @font-face for the draft font URLs (only affects the preview).
    const previewFontStyle = el("style", {});

    function refreshPreview(): void {
        const fontBlocks: string[] = [];
        if (draft.fonts.displayUrl) {
            fontBlocks.push(
                `@font-face { font-family: "AdminPreviewDisplay"; src: url("${draft.fonts.displayUrl}"); font-display: swap; }`,
            );
        }
        if (draft.fonts.bodyUrl) {
            fontBlocks.push(
                `@font-face { font-family: "AdminPreviewBody"; src: url("${draft.fonts.bodyUrl}"); font-display: swap; }`,
            );
        }
        previewFontStyle.textContent = fontBlocks.join("\n");

        applySiteConfigTheme(draft, previewBox);
        const previewStyle =
            `background: var(--brand-bg); color: var(--brand-text);` +
            (draft.loginBackgroundUrl
                ? ` background-image: linear-gradient(rgba(13,10,7,0.72), rgba(13,10,7,0.72)), url("${draft.loginBackgroundUrl}"); background-size: cover; background-position: center;`
                : "");
        previewBox.setAttribute("style", previewStyle);
        previewBox.textContent = "";
        const titleFamily = draft.fonts.displayUrl
            ? ' font-family: "AdminPreviewDisplay", Cinzel, Georgia, serif;'
            : "";
        const bodyFamily = draft.fonts.bodyUrl
            ? ' font-family: "AdminPreviewBody", "IM Fell English", Georgia, serif;'
            : "";
        previewBox.append(
            el(
                "div",
                {
                    className: "admin-preview-login",
                    style:
                        "background: var(--brand-panel); border-color: var(--brand-accent);" +
                        bodyFamily,
                },
                draft.logoUrl
                    ? el("img", {
                          className: "login-logo",
                          src: draft.logoUrl,
                          alt: draft.brandName,
                      })
                    : null,
                el(
                    "h1",
                    { style: "color: var(--brand-accent);" + titleFamily },
                    draft.texts.loginTitle || draft.brandName,
                ),
                el("h2", {}, draft.texts.loginSubtitle),
                el("div", { className: "login-tagline" }, draft.tagline),
                draft.messages.loginNotice
                    ? el(
                          "div",
                          { className: "admin-preview-notice" },
                          draft.messages.loginNotice,
                      )
                    : null,
                el("input", {
                    type: "text",
                    placeholder: "Usuario o email",
                    disabled: "true",
                }),
                el(
                    "button",
                    { type: "button", disabled: "true" },
                    "Iniciar sesion",
                ),
                draft.texts.footer
                    ? el(
                          "div",
                          { className: "admin-preview-footer" },
                          draft.texts.footer,
                      )
                    : null,
            ),
        );
    }

    // ---------- actions ----------

    const saveButton = el(
        "button",
        { type: "button" },
        "Guardar",
    ) as HTMLButtonElement;
    saveButton.addEventListener("click", () => {
        errorBox.textContent = "";
        const validationError = validateSiteConfigDraft(draft);
        if (validationError) {
            errorBox.textContent = validationError;
            return;
        }
        saveButton.disabled = true;
        saveSiteConfig(cloneConfig(draft))
            .then((saved) => {
                setSiteConfig(saved);
                draft = cloneConfig(saved);
                document.title = applySiteConfigTheme(saved, document.documentElement);
                loadDraft(saved);
                showToast("Configuracion guardada");
            })
            .catch((error) => {
                errorBox.textContent =
                    error instanceof ApiError
                        ? error.message
                        : "No se pudo guardar la configuracion.";
            })
            .finally(() => {
                saveButton.disabled = false;
            });
    });

    const downloadButton = el(
        "button",
        { type: "button", className: "secondary" },
        "Descargar assets",
    );
    downloadButton.addEventListener("click", () => {
        const json = JSON.stringify(draft, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = el("a", {
            href: url,
            download: themeFilename(draft.brandName),
        });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    });

    const importInput = el("input", {
        type: "file",
        accept: "application/json,.json",
        style: "display:none",
    });
    importInput.addEventListener("change", () => {
        const file = importInput.files?.[0];
        importInput.value = "";
        if (!file) return;
        file.text()
            .then((text) => {
                const imported = parseThemeJson(text);
                draft = imported;
                loadDraft(imported);
                errorBox.textContent = "";
                showToast("Tema importado");
            })
            .catch((error: unknown) => {
                errorBox.textContent =
                    error instanceof Error
                        ? error.message
                        : "No se pudo importar el tema.";
            });
    });
    const importButton = el(
        "button",
        { type: "button", className: "secondary" },
        "Importar",
    );
    importButton.addEventListener("click", () => importInput.click());

    const discardButton = el(
        "button",
        { type: "button", className: "secondary" },
        "Descartar cambios",
    );
    discardButton.addEventListener("click", () => {
        draft = cloneConfig(getSiteConfig());
        loadDraft(draft);
        errorBox.textContent = "";
    });

    const backButton = el(
        "button",
        { type: "button", className: "secondary" },
        "Volver",
    );
    backButton.addEventListener("click", () => navigate("/characters"));

    // Loads a config into every field + preview (import / discard / after save).
    function loadDraft(config: SiteConfig): void {
        brandName.input.value = config.brandName;
        tagline.input.value = config.tagline;
        logoUrl.input.value = config.logoUrl ?? "";
        logoUrl.thumb.src = config.logoUrl ?? "";
        logoUrl.thumb.style.display = config.logoUrl ? "block" : "none";
        loginBackgroundUrl.input.value = config.loginBackgroundUrl ?? "";
        loginBackgroundUrl.thumb.src = config.loginBackgroundUrl ?? "";
        loginBackgroundUrl.thumb.style.display = config.loginBackgroundUrl
            ? "block"
            : "none";
        fontDisplayUrl.input.value = config.fonts.displayUrl ?? "";
        fontBodyUrl.input.value = config.fonts.bodyUrl ?? "";
        musicUrl.input.value = config.music.url ?? "";
        musicAutoplay.input.checked = config.music.autoplay;
        musicVolume.value = String(config.music.volume);
        loginNotice.value = config.messages.loginNotice;
        playWelcome.input.value = config.messages.playWelcome;
        serverWelcome.value = config.messages.serverWelcome.join("\n");
        registrationEnabled.input.checked = config.registration.enabled;
        registrationRequireEmail.input.checked =
            config.registration.requireEmail;
        loginTitle.input.value = config.texts.loginTitle;
        loginSubtitle.input.value = config.texts.loginSubtitle;
        welcome.input.value = config.texts.welcome;
        footer.input.value = config.texts.footer;
        const keys: Array<keyof SiteConfig["colors"]> = [
            "accent",
            "accentHover",
            "bg",
            "panel",
            "text",
        ];
        colorFields.forEach((field, index) => {
            const value = config.colors[keys[index]];
            field.text.value = value;
            if (/^#[0-9a-fA-F]{6}$/.test(value)) field.swatch.value = value;
        });
        fpsCheckbox.input.checked = config.debug.showFpsPing;
        refreshPreview();
    }

    // ---------- cuentas ----------

    const accountsError = el("div", { className: "form-error" });
    const accountsBody = el("tbody", {});
    const accountsSearch = el("input", {
        type: "search",
        placeholder: "Buscar por nombre o email",
    });

    function confirmButton(
        label: string,
        action: () => void,
    ): HTMLButtonElement {
        const button = el(
            "button",
            { type: "button", className: "secondary admin-account-btn" },
            label,
        ) as HTMLButtonElement;
        let armed = false;
        let timer = 0;
        const disarm = () => {
            armed = false;
            button.classList.remove("danger-confirm");
            button.textContent = label;
        };
        button.addEventListener("click", () => {
            if (!armed) {
                armed = true;
                button.classList.add("danger-confirm");
                button.textContent = "Confirmar?";
                timer = window.setTimeout(disarm, 3000);
                return;
            }
            window.clearTimeout(timer);
            disarm();
            action();
        });
        return button;
    }

    // ---------- reset password modal (reusa el estilo .exit-modal) ----------
    const resetTitle = el("div", { className: "exit-modal-title" }, "");
    const resetInput = el("input", {
        type: "password",
        placeholder: "Nueva contraseña temporal",
        autocomplete: "new-password",
    }) as HTMLInputElement;
    const resetError = el("div", { className: "form-error" });
    const resetCancel = el(
        "button",
        { type: "button", className: "secondary" },
        "Cancelar",
    ) as HTMLButtonElement;
    const resetConfirm = el(
        "button",
        { type: "button" },
        "Restablecer",
    ) as HTMLButtonElement;
    const resetModal = el(
        "div",
        { className: "exit-modal", role: "dialog", "aria-modal": "true" },
        el(
            "div",
            { className: "exit-modal-panel" },
            resetTitle,
            el(
                "div",
                { className: "exit-modal-text" },
                "La cuenta debera cambiarla en su proximo login.",
            ),
            resetInput,
            resetError,
            el(
                "div",
                { className: "exit-modal-actions" },
                resetCancel,
                resetConfirm,
            ),
        ),
    );
    let resetTarget: AdminAccount | null = null;
    const closeResetModal = () => {
        resetTarget = null;
        resetModal.classList.remove("open");
    };
    const openResetModal = (account: AdminAccount) => {
        resetTarget = account;
        resetTitle.textContent = `Restablecer contraseña de ${account.name}`;
        resetInput.value = "";
        resetError.textContent = "";
        resetModal.classList.add("open");
        resetInput.focus();
    };
    resetCancel.addEventListener("click", closeResetModal);
    resetModal.addEventListener("click", (event) => {
        if (event.target === resetModal) closeResetModal();
    });
    resetConfirm.addEventListener("click", () => {
        if (!resetTarget) return;
        const newPassword = resetInput.value;
        if (newPassword.length < 8) {
            resetError.textContent = "Minimo 8 caracteres.";
            return;
        }
        resetConfirm.disabled = true;
        resetError.textContent = "";
        resetAdminAccountPassword(resetTarget.id, newPassword)
            .then(() => {
                showToast("Contraseña restablecida");
                closeResetModal();
            })
            .catch((error: unknown) => {
                resetError.textContent =
                    error instanceof ApiError
                        ? error.message
                        : "No se pudo restablecer la contraseña.";
            })
            .finally(() => {
                resetConfirm.disabled = false;
            });
    });

    // ---------- create account modal (reusa el estilo .exit-modal) ----------
    const createName = el("input", {
        type: "text",
        placeholder: "Nombre de usuario",
        autocomplete: "off",
    }) as HTMLInputElement;
    const createEmail = el("input", {
        type: "email",
        placeholder: "Email",
        autocomplete: "off",
    }) as HTMLInputElement;
    const createPassword = el("input", {
        type: "password",
        placeholder: "Contraseña temporal",
        autocomplete: "new-password",
    }) as HTMLInputElement;
    const createAdmin = el("input", { type: "checkbox" }) as HTMLInputElement;
    const createError = el("div", { className: "form-error" });
    const createCancel = el(
        "button",
        { type: "button", className: "secondary" },
        "Cancelar",
    ) as HTMLButtonElement;
    const createConfirm = el(
        "button",
        { type: "button" },
        "Crear cuenta",
    ) as HTMLButtonElement;
    const createModal = el(
        "div",
        { className: "exit-modal", role: "dialog", "aria-modal": "true" },
        el(
            "div",
            { className: "exit-modal-panel" },
            el("div", { className: "exit-modal-title" }, "Crear cuenta"),
            el(
                "div",
                { className: "exit-modal-text" },
                "La cuenta debera cambiar la contraseña en su primer login.",
            ),
            createName,
            createEmail,
            createPassword,
            el(
                "label",
                { className: "admin-create-admin-flag" },
                createAdmin,
                " Es administrador",
            ),
            createError,
            el(
                "div",
                { className: "exit-modal-actions" },
                createCancel,
                createConfirm,
            ),
        ),
    );
    const closeCreateModal = () => {
        createModal.classList.remove("open");
    };
    const openCreateModal = () => {
        createName.value = "";
        createEmail.value = "";
        createPassword.value = "";
        createAdmin.checked = false;
        createError.textContent = "";
        createModal.classList.add("open");
        createName.focus();
    };
    createCancel.addEventListener("click", closeCreateModal);
    createModal.addEventListener("click", (event) => {
        if (event.target === createModal) closeCreateModal();
    });
    createConfirm.addEventListener("click", () => {
        const name = createName.value.trim();
        const email = createEmail.value.trim();
        const password = createPassword.value;
        if (!name || !email) {
            createError.textContent = "Nombre y email son obligatorios.";
            return;
        }
        if (password.length < 8) {
            createError.textContent = "Contraseña: minimo 8 caracteres.";
            return;
        }
        createConfirm.disabled = true;
        createError.textContent = "";
        createAdminAccount({
            name,
            email,
            password,
            is_admin: createAdmin.checked,
        })
            .then(() => {
                showToast("Cuenta creada");
                closeCreateModal();
                loadAccounts();
            })
            .catch((error: unknown) => {
                createError.textContent =
                    error instanceof ApiError
                        ? error.message
                        : "No se pudo crear la cuenta.";
            })
            .finally(() => {
                createConfirm.disabled = false;
            });
    });

    function renderAccounts(accounts: AdminAccount[]): void {
        accountsBody.textContent = "";
        if (!accounts.length) {
            accountsBody.append(
                el(
                    "tr",
                    {},
                    el(
                        "td",
                        { colspan: "5", className: "admin-accounts-empty" },
                        "Sin resultados",
                    ),
                ),
            );
            return;
        }
        for (const account of accounts) {
            const isSelf = account.id === selfId;
            const disabled = Boolean(account.disabled_at);
            const cells: HTMLElement[] = [
                el("td", {}, account.name),
                el("td", {}, account.email || "-"),
                el("td", {}, account.is_admin ? "Si" : "No"),
                el(
                    "td",
                    { className: disabled ? "admin-account-disabled" : "" },
                    disabled ? "Deshabilitada" : "Activa",
                ),
            ];
            let actionsCell: HTMLElement;
            if (isSelf) {
                actionsCell = el(
                    "td",
                    { className: "admin-accounts-self" },
                    "Tu cuenta",
                );
            } else {
                const runPatch = (patch: {
                    disabled?: boolean;
                    is_admin?: boolean;
                }) => {
                    accountsError.textContent = "";
                    updateAdminAccount(account.id, patch)
                        .then(() => {
                            showToast("Cuenta actualizada");
                            loadAccounts();
                        })
                        .catch((error: unknown) => {
                            accountsError.textContent =
                                error instanceof ApiError
                                    ? error.message
                                    : "No se pudo actualizar la cuenta.";
                        });
                };
                actionsCell = el(
                    "td",
                    { className: "admin-accounts-actions" },
                    confirmButton(
                        account.is_admin ? "Quitar admin" : "Hacer admin",
                        () => runPatch({ is_admin: !account.is_admin }),
                    ),
                    confirmButton(
                        disabled ? "Habilitar" : "Deshabilitar",
                        () => runPatch({ disabled: !disabled }),
                    ),
                    (() => {
                        const resetButton = el(
                            "button",
                            {
                                type: "button",
                                className: "secondary admin-account-btn",
                            },
                            "Reset password",
                        ) as HTMLButtonElement;
                        resetButton.addEventListener("click", () =>
                            openResetModal(account),
                        );
                        return resetButton;
                    })(),
                    confirmButton("Eliminar", () => {
                        accountsError.textContent = "";
                        deleteAdminAccount(account.id)
                            .then(() => {
                                showToast("Cuenta eliminada");
                                loadAccounts();
                            })
                            .catch((error: unknown) => {
                                accountsError.textContent =
                                    error instanceof ApiError
                                        ? error.message
                                        : "No se pudo eliminar la cuenta.";
                            });
                    }),
                );
            }
            accountsBody.append(el("tr", {}, ...cells, actionsCell));
        }
    }

    function loadAccounts(): void {
        fetchAdminAccounts(accountsSearch.value.trim())
            .then(renderAccounts)
            .catch((error: unknown) => {
                accountsError.textContent =
                    error instanceof ApiError
                        ? error.message
                        : "No se pudieron cargar las cuentas.";
            });
    }

    let searchTimer = 0;
    accountsSearch.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(loadAccounts, 300);
    });
    loadAccounts();

    // ---------- layout ----------

    refreshPreview();

    // ---------- layout: central panel with a section sidebar ----------
    // Pages: Branding (identidad visual), Instancia (registro/debug),
    // Cuentas (gestión de usuarios). Actions row is shared by config pages.
    const pageBranding = el(
        "div",
        { className: "admin-page", "data-page": "branding" },
        el(
            "div",
            { className: "admin-columns" },
            el(
                "div",
                { className: "admin-form" },
                section("Branding", brandName.row, tagline.row),
                section("Imagenes", logoUrl.row, loginBackgroundUrl.row),
                section("Fuentes", fontDisplayUrl.row, fontBodyUrl.row),
                section(
                    "Musica",
                    musicUrl.row,
                    musicAutoplay.row,
                    el(
                        "div",
                        { className: "form-field" },
                        el("label", {}, "Volumen"),
                        el(
                            "div",
                            { className: "admin-volume-row" },
                            musicVolume,
                            musicTestButton,
                        ),
                    ),
                ),
                section("Mensajes", loginNoticeRow, playWelcome.row),
                section(
                    "Textos",
                    loginTitle.row,
                    loginSubtitle.row,
                    welcome.row,
                    footer.row,
                ),
                section("Colores", ...colorFields.map((field) => field.row)),
            ),
            el(
                "div",
                { className: "admin-preview" },
                el("div", { className: "admin-preview-title" }, "Vista previa"),
                previewBox,
                previewFontStyle,
            ),
        ),
    );

    const pageInstancia = el(
        "div",
        { className: "admin-page", "data-page": "instancia" },
        el(
            "div",
            { className: "admin-form" },
            section(
                "Registro",
                registrationEnabled.row,
                registrationRequireEmail.row,
                el(
                    "div",
                    { className: "admin-hint" },
                    "El servidor aplica estas reglas al registrar cuentas.",
                ),
            ),
            section(
                "Mensajes del servidor",
                serverWelcomeRow,
                el(
                    "div",
                    { className: "admin-hint" },
                    "Se muestran en la consola del juego al conectar. Vacio usa los mensajes por defecto.",
                ),
            ),
            section("Debug", fpsCheckbox.row),
        ),
    );

    const pageCuentas = el(
        "div",
        { className: "admin-page", "data-page": "cuentas" },
        el(
            "div",
            { className: "admin-accounts-toolbar" },
            el(
                "div",
                { className: "form-field admin-accounts-search" },
                accountsSearch,
            ),
            (() => {
                const createButton = el(
                    "button",
                    { type: "button", className: "secondary" },
                    "Crear cuenta",
                ) as HTMLButtonElement;
                createButton.addEventListener("click", openCreateModal);
                return createButton;
            })(),
        ),
        accountsError,
        el(
            "div",
            { className: "admin-accounts-table-wrap" },
            el(
                "table",
                { className: "admin-accounts-table" },
                el(
                    "thead",
                    {},
                    el(
                        "tr",
                        {},
                        el("th", {}, "Nombre"),
                        el("th", {}, "Email"),
                        el("th", {}, "Admin"),
                        el("th", {}, "Estado"),
                        el("th", {}, "Acciones"),
                    ),
                ),
                accountsBody,
            ),
        ),
        resetModal,
        createModal,
    );

    const pages: Array<{ id: string; label: string; page: HTMLElement }> = [
        { id: "branding", label: "Branding", page: pageBranding },
        { id: "instancia", label: "Instancia", page: pageInstancia },
        { id: "cuentas", label: "Cuentas", page: pageCuentas },
    ];

    const configActions = el(
        "div",
        { className: "form-actions admin-actions" },
        saveButton,
        el(
            "div",
            { className: "admin-actions-row" },
            downloadButton,
            importButton,
            discardButton,
        ),
    );

    const navButtons = pages.map((def) => {
        const button = el(
            "button",
            { type: "button", className: "admin-nav-btn" },
            def.label,
        );
        button.addEventListener("click", () => {
            for (const other of pages) {
                other.page.classList.toggle("active", other === def);
            }
            for (const otherButton of navButtons) {
                otherButton.classList.toggle("active", otherButton === button);
            }
            // Save/import actions only make sense on config pages.
            configActions.style.display =
                def.id === "cuentas" ? "none" : "";
        });
        return button;
    });
    navButtons[0].classList.add("active");
    pageBranding.classList.add("active");

    root.append(
        el("div", { className: "admin-brand" }, getSiteConfig().brandName),
        el(
            "div",
            { className: "admin-view" },
            el(
                "div",
                { className: "admin-stack" },
                el(
                    "div",
                    { className: "panel wide admin-panel" },
                    el("h1", {}, "Administracion"),
                    el(
                        "div",
                        { className: "admin-body" },
                        el(
                            "nav",
                            { className: "admin-nav" },
                            ...navButtons,
                            backButton,
                        ),
                        el(
                            "div",
                            { className: "admin-content" },
                            pageBranding,
                            pageInstancia,
                            pageCuentas,
                            errorBox,
                            configActions,
                            importInput,
                        ),
                    ),
                ),
            ),
        ),
    );
}
