import { Text, TextStyle } from "pixi.js";

export const CLAN_TAG_HIGHLIGHT_COLOR = 0xe0b84f;

const characterClanTextStyleCache = new Map<string, TextStyle>();
const hudStatusTextStyleCache = new Map<string, TextStyle>();

const getTextStyleCacheKey = (color: string | number) =>
    `${typeof color}:${String(color)}`;

export const createCharacterNameTextStyle = (color: string | number) =>
    new TextStyle({
        fontFamily: "Verdana",
        align: "center",
        fontSize: 12,
        lineHeight: 13,
        fontWeight: "700",
        fill: color,
        dropShadow: {
            alpha: 1,
            angle: Math.PI / 5,
            blur: 0,
            color: 0x000000,
            distance: 1,
        },
    });

export const createCharacterClanTextStyle = (color: string | number) => {
    const cacheKey = getTextStyleCacheKey(color);
    const cachedStyle = characterClanTextStyleCache.get(cacheKey);

    if (cachedStyle) {
        return cachedStyle;
    }

    const style = new TextStyle({
        fontFamily: "Verdana",
        align: "center",
        fontSize: 12,
        lineHeight: 13,
        fontWeight: "700",
        fill: color,
        dropShadow: {
            alpha: 1,
            angle: Math.PI / 5,
            blur: 0,
            color: 0x000000,
            distance: 1,
        },
    });

    characterClanTextStyleCache.set(cacheKey, style);

    return style;
};

export const getHudStatusTextStyle = (color: number) => {
    const cacheKey = getTextStyleCacheKey(color);
    const cachedStyle = hudStatusTextStyleCache.get(cacheKey);

    if (cachedStyle) {
        return cachedStyle;
    }

    const style = new TextStyle({
        fontFamily: "Arial",
        fontSize: 11,
        fontWeight: "bold",
        fill: color,
        stroke: { color: 0x000000, width: 1.5 },
    });

    hudStatusTextStyleCache.set(cacheKey, style);

    return style;
};

export const setTextIfChanged = (label: Text, nextText: string) => {
    if (label.text !== nextText) {
        label.text = nextText;
    }
};

export const setVisibilityIfChanged = (label: Text, nextVisible: boolean) => {
    if (label.visible !== nextVisible) {
        label.visible = nextVisible;
    }
};

export const setStyleIfChanged = (label: Text, nextStyle: TextStyle) => {
    if (label.style !== nextStyle) {
        label.style = nextStyle;
    }
};
