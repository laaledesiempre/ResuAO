const spanishNumberFormatter = new Intl.NumberFormat("es-AR");

export function formatNumber(value: number | bigint): string {
    return spanishNumberFormatter.format(value);
}
