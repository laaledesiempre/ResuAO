const DISPLAY_NAME_MAX_LENGTH = 15;
const DISPLAY_NAME_REGEX = /^[A-Za-z ]+$/;

export { DISPLAY_NAME_MAX_LENGTH };

export function getDisplayNameError(value: string): string | null {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
        return null;
    }

    if (trimmedValue.length < 3) {
        return "El nombre debe tener al menos 3 caracteres.";
    }

    if (trimmedValue.length > DISPLAY_NAME_MAX_LENGTH) {
        return `El nombre debe tener como maximo ${DISPLAY_NAME_MAX_LENGTH} caracteres.`;
    }

    if (!DISPLAY_NAME_REGEX.test(trimmedValue)) {
        return "El nombre solo puede contener letras de la A a la Z y espacios.";
    }

    return null;
}
