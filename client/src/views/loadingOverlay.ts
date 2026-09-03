export interface LoadingOverlayElements {
    root: { style: { display: string } };
    stage: { textContent: string };
    detail: { textContent: string };
    bar: { style: { width: string } };
}

export interface LoadingOverlay {
    progress: (stage: string, percent: number, detail: string) => void;
    complete: () => void;
    error: (message: string) => void;
}

/**
 * Loading overlay state machine.
 *
 * Invariant: once an error is shown, the overlay must stay visible so the
 * user can read the message. `complete()` (fired by `setIsLoading(false)`)
 * only hides the overlay when no error was reported. This prevents the
 * black-screen regression where the bootstrap catch block showed the error
 * inside the overlay and immediately hid that same overlay.
 */
export function createLoadingOverlay(
    elements: LoadingOverlayElements,
): LoadingOverlay {
    let errored = false;

    return {
        progress(stage, percent, detail) {
            if (errored) return;
            elements.stage.textContent = stage;
            elements.detail.textContent = detail;
            elements.bar.style.width = `${Math.round(percent)}%`;
        },
        complete() {
            if (errored) return;
            elements.root.style.display = "none";
        },
        error(message) {
            errored = true;
            elements.root.style.display = "";
            elements.stage.textContent = "Error";
            elements.detail.textContent = message;
        },
    };
}
