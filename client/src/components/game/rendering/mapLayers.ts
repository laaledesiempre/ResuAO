export const Z_INDEX_ROW_MULTIPLIER = 10;

export const Z_INDEX_LAYERS = {
    FLOOR: 0,
    BELOW: 2,
    OBJECT: 3,
    CHARACTER: 5,
    ABOVE: 7,
    ROOF: 9,
};

export const getRowZIndex = (row: number, layerOffset: number): number =>
    row * Z_INDEX_ROW_MULTIPLIER + layerOffset;
