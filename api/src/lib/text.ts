export const DISPLAY_NAME_MAX_LENGTH = 15;

const DISPLAY_NAME_REGEX = /^[A-Za-z ]+$/;

export function isValidDisplayName(value: string): boolean {
  return DISPLAY_NAME_REGEX.test(value);
}

export function sanitizeName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
