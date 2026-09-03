import {
    AnimatedSprite,
    Container,
    Graphics,
    Sprite,
    Text,
    TextStyle,
    Texture,
} from "pixi.js";
import type { RefObject } from "../vanilla";
import type {
    DirectionalGraphicData,
    HelmetData,
    GraphicData,
} from "../../../types/game";
import type {
    CharacterSnapshot,
    PlayerHudState,
} from "../../../lib/aowProtocol";
import { TILE_SIZE } from "../../../lib/viewport";
import {
    getCharacterCrowdControlProgress,
    type Engine,
    type Character,
} from "../engine/Engine";
import {
    getBodySpritePosition,
    getDebugPositionLabelPosition,
    getEquipmentSpritePosition,
    getHeadSpritePosition,
    getHelmetSpritePosition,
    getNameLabelPosition,
    type BodyRenderMetrics,
} from "./characterLayout";
import {
    CLAN_TAG_HIGHLIGHT_COLOR,
    createCharacterClanTextStyle,
    createCharacterNameTextStyle,
    setStyleIfChanged,
    setTextIfChanged,
    setVisibilityIfChanged,
} from "./textStyles";
import {
    getCharacterClanLabel,
    getCharacterNameLabel,
    getCharacterRenderAlpha,
    shouldHighlightClanTag,
    shouldHideRemoteCharacterName,
} from "./visibility";
import { getRowZIndex, Z_INDEX_LAYERS } from "./mapLayers";
import { getMapRowLayerContainer } from "./rowLayerContainers";

export function shouldRenderHead(
    engine: Engine,
    entity: Pick<Character, "idHead" | "idBody" | "isNpc" | "nameCharacter">,
): boolean {
    if (!entity.idHead || entity.idHead <= 0) {
        return false;
    }

    if (!entity.isNpc || !engine.npcsDB) {
        return true;
    }

    const matchingNpc = Object.values(engine.npcsDB).find(
        (npc) =>
            npc.name === entity.nameCharacter &&
            npc.idBody === entity.idBody &&
            npc.idHead === 0,
    );

    return !matchingNpc;
}

export function ensureCharacterBodyReady(
    engine: Engine,
    entity: Character,
    preloadGraphicIds: (engine: Engine, graphicIds: string[]) => Promise<void>,
): Promise<void> {
    if (!engine.bodiesDB || !engine.graphicsDB || engine.isDestroyed) {
        return Promise.resolve();
    }

    const bodyData = engine.bodiesDB[entity.idBody.toString()];
    if (!bodyData) {
        return Promise.resolve();
    }

    const graphicIds = [
        bodyData["1"],
        bodyData["2"],
        bodyData["3"],
        bodyData["4"],
    ]
        .filter((graphicId) => Number.isFinite(graphicId) && graphicId > 0)
        .map((graphicId) => String(graphicId));

    if (
        graphicIds.length === 0 ||
        graphicIds.every(
            (graphicId) =>
                engine.textureCache.has(graphicId) ||
                engine.animatedTextureCache.has(graphicId),
        )
    ) {
        return Promise.resolve();
    }

    return preloadGraphicIds(engine, graphicIds).then(() => {
        if (engine.isDestroyed) {
            return;
        }

        engine.requestCharacterRerender?.(entity.id);
    });
}

export function resolveBodyRenderState(
    engine: Engine,
    entity: Character,
    resolveNakedBodyIdFromHeadId: (headId: number) => number | null,
) {
    if (!engine.bodiesDB) {
        return null;
    }

    const actualBodyData = engine.bodiesDB[entity.idBody.toString()];
    const actualBodyGraphicId =
        actualBodyData?.[
            entity.heading.toString() as keyof typeof actualBodyData
        ];
    const hasActualBodyReady = Boolean(
        actualBodyGraphicId &&
        (engine.textureCache.has(actualBodyGraphicId.toString()) ||
            engine.animatedTextureCache.has(actualBodyGraphicId.toString())),
    );

    if (actualBodyData && hasActualBodyReady) {
        return {
            bodyData: actualBodyData,
            isFallback: false,
        };
    }

    const nakedBodyId = resolveNakedBodyIdFromHeadId(entity.idHead);
    const fallbackBodyData = nakedBodyId
        ? engine.bodiesDB[nakedBodyId.toString()]
        : null;

    if (fallbackBodyData) {
        return {
            bodyData: fallbackBodyData,
            isFallback: true,
        };
    }

    if (actualBodyData) {
        return {
            bodyData: actualBodyData,
            isFallback: false,
        };
    }

    return null;
}

type CharacterRendererDeps = {
    canUseEngineContainer: (
        engine: Engine,
        container: Container | null | undefined,
    ) => boolean;
    loadCharacterTextures: (
        engine: Engine,
        graphicId: number,
        graphicData: GraphicData,
    ) => Promise<Texture[] | null>;
    loadSingleTexture: (
        engine: Engine,
        graphicId: number,
        graphicData: GraphicData,
    ) => Promise<Texture | null>;
    resolveNakedBodyIdFromHeadId: (headId: number) => number | null;
    preloadGraphicIds: (engine: Engine, graphicIds: string[]) => Promise<void>;
    collectCharacterGraphicIds: (
        engine: Engine,
        snapshot: CharacterSnapshot,
        options?: { includeBody?: boolean },
    ) => string[];
    syncEntityFX: (engine: Engine, entityId: number) => Promise<void>;
    syncDialogBubble: (engine: Engine, entityId: number) => void;
    removeDialogBubbleFromContainer: (
        container: Container | null | undefined,
    ) => void;
    removeDialogBubbleFromOverlay: (engine: Engine, entityId: number) => void;
    unregisterContainerCullEntries: (
        engine: Engine,
        container: Container,
    ) => void;
    destroyDisplayObjectSafely: (
        displayObject: any,
        options?: { children?: boolean },
    ) => void;
    createDebugPositionLabel: (text: string) => Text;
    formatCharacterAnimationDebugLabel: (character: Character) => string;
    shouldHideRemoteCharacterBody: (
        entity: Character,
        localCharacterId: number | undefined,
        partyMemberIds: Set<string>,
    ) => boolean;
    playerHudRef: RefObject<PlayerHudState | null>;
    partyMemberIdsRef: RefObject<Set<string>>;
};

type CharacterDisplayStorageKey =
    | "bodySprite"
    | "headSprite"
    | "helmetSprite"
    | "weaponSprite"
    | "shieldSprite"
    | "nameLabel"
    | "clanLabel"
    | "debugPositionLabel"
    | "crowdControlBarBg"
    | "crowdControlBarFill"
    | "healthBarBg"
    | "healthBarFill"
    | "botHealthBarBg"
    | "botHealthBarFill"
    | "botHealthLabel"
    | "botManaBarBg"
    | "botManaBarFill"
    | "botManaLabel";

type CharacterDisplayContainer = Container & {
    bodySprite?: AnimatedSprite;
    headSprite?: Sprite;
    helmetSprite?: Sprite;
    weaponSprite?: AnimatedSprite;
    shieldSprite?: AnimatedSprite;
    nameLabel?: Text;
    clanLabel?: Text;
    debugPositionLabel?: Text;
    crowdControlBarBg?: Graphics;
    crowdControlBarFill?: Graphics;
    healthBarBg?: Graphics;
    healthBarFill?: Graphics;
    botHealthBarBg?: Graphics;
    botHealthBarFill?: Graphics;
    botHealthLabel?: Text;
    botManaBarBg?: Graphics;
    botManaBarFill?: Graphics;
    botManaLabel?: Text;
    bodyMetrics?: BodyRenderMetrics;
};

const BOT_RESOURCE_LABEL_STYLE = new TextStyle({
    fontFamily: "Verdana",
    fontSize: 9,
    lineHeight: 9,
    fontWeight: "700",
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 2 },
    align: "center",
});

function getCharacterStatusBarLayout(
    bodyMetrics: BodyRenderMetrics,
    entity: Character,
    options: {
        showClanLabel?: boolean;
    },
) {
    const barWidth = 50;
    const barHeight = 6;
    const centerX = entity.isNpc
        ? TILE_SIZE / 2
        : bodyMetrics.x + bodyMetrics.width / 2;
    const barX = Math.round(centerX - barWidth / 2);
    const nameplateY = getNameLabelPosition(bodyMetrics).y;
    const baseBarY = entity.isNpc
        ? Math.round(bodyMetrics.y + bodyMetrics.height + 4)
        : Math.round(nameplateY + (options.showClanLabel ? 30 : 17));

    return {
        barWidth,
        barHeight,
        barX,
        baseBarY,
    };
}

function shouldShowCrowdControlBar(
    entity: Character,
    options: {
        hideBody: boolean;
        showNameplate?: boolean;
    },
): boolean {
    return Boolean(
        !options.hideBody &&
        !entity.dead &&
        (entity.inmovilizado || entity.paralizado),
    );
}

function drawStyledStatusBar(
    background: Graphics,
    fill: Graphics,
    options: {
        x: number;
        y: number;
        width: number;
        height: number;
        progress: number;
        trackColor: number;
        fillColor: number;
    },
) {
    const fillPadding = 1;
    const innerWidth = Math.max(0, options.width - fillPadding * 2);
    const innerHeight = Math.max(0, options.height - fillPadding * 2);
    const fillWidth = Math.round(innerWidth * options.progress);

    background.scale.set(1, 1);
    fill.scale.set(1, 1);

    background.clear();
    background
        .roundRect(0, 0, options.width, options.height, 4)
        .fill({ color: 0x08111f, alpha: 0.96 })
        .stroke({ color: 0x000000, alpha: 0.5, width: 1 });
    background
        .roundRect(fillPadding, fillPadding, innerWidth, innerHeight, 3)
        .fill({ color: options.trackColor, alpha: 0.9 });
    background.position.set(options.x, options.y);

    fill.clear();

    if (fillWidth > 0) {
        fill.roundRect(
            fillPadding,
            fillPadding,
            fillWidth,
            innerHeight,
            3,
        ).fill({
            color: options.fillColor,
            alpha: 0.98,
        });

        if (fillWidth > 4 && innerHeight > 2) {
            fill.roundRect(
                fillPadding + 1,
                fillPadding + 1,
                fillWidth - 2,
                1,
                1,
            ).fill({
                color: 0xffffff,
                alpha: 0.18,
            });
        }
    }

    fill.position.set(options.x, options.y);
}

function ensureGraphicsCharacterChild(
    container: CharacterDisplayContainer,
    key: CharacterDisplayStorageKey,
    tag: string,
): Graphics {
    let graphic = getStoredCharacterChild<Graphics>(container, key, tag);

    if (!graphic) {
        graphic = new Graphics();
        (graphic as any)[tag] = true;
        container.addChild(graphic);
        (container as any)[key] = graphic;
    } else if (graphic.parent !== container) {
        container.addChild(graphic);
    }

    graphic.visible = true;
    graphic.alpha = 1;
    return graphic;
}

function ensureCrowdControlBar(
    container: CharacterDisplayContainer,
    bodyMetrics: BodyRenderMetrics,
    entity: Character,
    options: {
        hideBody: boolean;
        showNameplate?: boolean;
        showClanLabel?: boolean;
    },
    destroyDisplayObjectSafely: CharacterRendererDeps["destroyDisplayObjectSafely"],
): void {
    const progress = getCharacterCrowdControlProgress(entity, Date.now());
    const shouldShow =
        shouldShowCrowdControlBar(entity, options) && progress > 0;

    if (!shouldShow) {
        removeStoredCharacterChild(
            container,
            "crowdControlBarBg",
            "isCrowdControlBarBg",
            destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "crowdControlBarFill",
            "isCrowdControlBarFill",
            destroyDisplayObjectSafely,
        );
        return;
    }

    const { barWidth, barHeight, barX, baseBarY } = getCharacterStatusBarLayout(
        bodyMetrics,
        entity,
        options,
    );

    const background = ensureGraphicsCharacterChild(
        container,
        "crowdControlBarBg",
        "isCrowdControlBarBg",
    );
    background.zIndex = 0.55;

    const fill = ensureGraphicsCharacterChild(
        container,
        "crowdControlBarFill",
        "isCrowdControlBarFill",
    );
    drawStyledStatusBar(background, fill, {
        x: barX,
        y: baseBarY,
        width: barWidth,
        height: barHeight,
        progress,
        trackColor: 0x3a2a06,
        fillColor: 0xfacc15,
    });
    fill.zIndex = 0.56;
}

function ensureHealthBar(
    container: CharacterDisplayContainer,
    bodyMetrics: BodyRenderMetrics,
    entity: Character,
    options: {
        hideBody: boolean;
        showNameplate?: boolean;
        showClanLabel?: boolean;
        showHealthBar: boolean;
    },
    destroyDisplayObjectSafely: CharacterRendererDeps["destroyDisplayObjectSafely"],
): void {
    const maxHp = Number(entity.maxHp ?? 0);
    const currentHp = Number(entity.hp ?? entity.tHp ?? 0);
    const progress =
        maxHp > 0 ? Math.max(0, Math.min(1, currentHp / maxHp)) : 0;
    const shouldShow =
        options.showHealthBar &&
        entity.isNpc &&
        !options.hideBody &&
        !entity.dead &&
        maxHp > 0;

    if (!shouldShow) {
        removeStoredCharacterChild(
            container,
            "healthBarBg",
            "isHealthBarBg",
            destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "healthBarFill",
            "isHealthBarFill",
            destroyDisplayObjectSafely,
        );
        return;
    }

    const { barWidth, barHeight, barX, baseBarY } = getCharacterStatusBarLayout(
        bodyMetrics,
        entity,
        options,
    );
    const barY =
        baseBarY +
        (shouldShowCrowdControlBar(entity, options) ? barHeight + 3 : 0);
    const fillColor = 0xef4444;

    const background = ensureGraphicsCharacterChild(
        container,
        "healthBarBg",
        "isHealthBarBg",
    );
    background.zIndex = 0.53;

    const fill = ensureGraphicsCharacterChild(
        container,
        "healthBarFill",
        "isHealthBarFill",
    );
    drawStyledStatusBar(background, fill, {
        x: barX,
        y: barY,
        width: barWidth,
        height: barHeight,
        progress,
        trackColor: 0x3f0f17,
        fillColor,
    });
    fill.zIndex = 0.54;
}

function ensureAdminSummonedBotVitals(
    container: CharacterDisplayContainer,
    bodyMetrics: BodyRenderMetrics,
    entity: Character,
    options: {
        hideBody: boolean;
    },
    destroyDisplayObjectSafely: CharacterRendererDeps["destroyDisplayObjectSafely"],
): void {
    const shouldShow = Boolean(
        entity.adminSummonedBot && !options.hideBody && !entity.dead,
    );

    if (!shouldShow) {
        removeStoredCharacterChild(
            container,
            "botHealthBarBg",
            "isBotHealthBarBg",
            destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "botHealthBarFill",
            "isBotHealthBarFill",
            destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "botHealthLabel",
            "isBotHealthLabel",
            destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "botManaBarBg",
            "isBotManaBarBg",
            destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "botManaBarFill",
            "isBotManaBarFill",
            destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "botManaLabel",
            "isBotManaLabel",
            destroyDisplayObjectSafely,
        );
        return;
    }

    const barWidth = 58;
    const barHeight = 8;
    const { barX, baseBarY } = getCharacterStatusBarLayout(
        bodyMetrics,
        entity,
        {
            showClanLabel: Boolean(getCharacterClanLabel(entity)),
        },
    );
    const firstBarY = baseBarY;
    const secondBarY = firstBarY + barHeight + 4;
    const currentHp = Number(entity.hp ?? entity.tHp ?? 0);
    const maxHp = Number(entity.maxHp ?? 0);
    const currentMana = Number(entity.mana ?? entity.tMana ?? 0);
    const maxMana = Number(entity.maxMana ?? 0);
    const hpProgress =
        maxHp > 0 ? Math.max(0, Math.min(1, currentHp / maxHp)) : 0;
    const manaProgress =
        maxMana > 0 ? Math.max(0, Math.min(1, currentMana / maxMana)) : 0;

    const healthBackground = ensureGraphicsCharacterChild(
        container,
        "botHealthBarBg",
        "isBotHealthBarBg",
    );
    const healthFill = ensureGraphicsCharacterChild(
        container,
        "botHealthBarFill",
        "isBotHealthBarFill",
    );
    drawStyledStatusBar(healthBackground, healthFill, {
        x: barX,
        y: firstBarY,
        width: barWidth,
        height: barHeight,
        progress: hpProgress,
        trackColor: 0x3f0f17,
        fillColor: 0xef4444,
    });
    healthBackground.zIndex = 0.53;
    healthFill.zIndex = 0.54;

    const healthLabel = ensureTextCharacterChild(
        container,
        "botHealthLabel",
        "isBotHealthLabel",
        () => new Text({ text: "", style: BOT_RESOURCE_LABEL_STYLE }),
    );
    setTextIfChanged(healthLabel, `${currentHp}/${maxHp}`);
    healthLabel.style = BOT_RESOURCE_LABEL_STYLE;
    healthLabel.x = Math.round(barX + (barWidth - healthLabel.width) / 2);
    healthLabel.y = Math.round(firstBarY - 1);
    healthLabel.zIndex = 0.55;

    const manaBackground = ensureGraphicsCharacterChild(
        container,
        "botManaBarBg",
        "isBotManaBarBg",
    );
    const manaFill = ensureGraphicsCharacterChild(
        container,
        "botManaBarFill",
        "isBotManaBarFill",
    );
    drawStyledStatusBar(manaBackground, manaFill, {
        x: barX,
        y: secondBarY,
        width: barWidth,
        height: barHeight,
        progress: manaProgress,
        trackColor: 0x172554,
        fillColor: 0x3b82f6,
    });
    manaBackground.zIndex = 0.56;
    manaFill.zIndex = 0.57;

    const manaLabel = ensureTextCharacterChild(
        container,
        "botManaLabel",
        "isBotManaLabel",
        () => new Text({ text: "", style: BOT_RESOURCE_LABEL_STYLE }),
    );
    setTextIfChanged(manaLabel, `${currentMana}/${maxMana}`);
    manaLabel.style = BOT_RESOURCE_LABEL_STYLE;
    manaLabel.x = Math.round(barX + (barWidth - manaLabel.width) / 2);
    manaLabel.y = Math.round(secondBarY - 1);
    manaLabel.zIndex = 0.58;
}

function getStoredCharacterChild<
    T extends AnimatedSprite | Sprite | Text | Graphics,
>(
    container: CharacterDisplayContainer,
    key: CharacterDisplayStorageKey,
    tag: string,
): T | undefined {
    const storedChild = container[key] as T | undefined;

    if (storedChild && !storedChild.destroyed) {
        return storedChild;
    }

    const child = container.children.find((candidate) =>
        Boolean((candidate as any)[tag]),
    ) as T | undefined;

    if (child) {
        (container as any)[key] = child;
    }

    return child;
}

function removeStoredCharacterChild(
    container: CharacterDisplayContainer,
    key: CharacterDisplayStorageKey,
    tag: string,
    destroyDisplayObjectSafely: CharacterRendererDeps["destroyDisplayObjectSafely"],
): void {
    const child = getStoredCharacterChild(container, key, tag);

    if (!child) {
        return;
    }

    if (child.parent === container) {
        container.removeChild(child);
    }

    destroyDisplayObjectSafely(child as any);
    delete (container as any)[key];
}

function ensureAnimatedCharacterChild(
    container: CharacterDisplayContainer,
    key: CharacterDisplayStorageKey,
    tag: string,
    textures: Texture[],
): AnimatedSprite {
    let sprite = getStoredCharacterChild<AnimatedSprite>(container, key, tag);

    if (!sprite) {
        sprite = new AnimatedSprite(textures);
        sprite.stop();
        (sprite as any)[tag] = true;
        container.addChild(sprite);
        (container as any)[key] = sprite;
    } else if (sprite.parent !== container) {
        container.addChild(sprite);
    }

    sprite.textures = textures;
    sprite.currentFrame = 0;
    sprite.texture = textures[0];
    sprite.alpha = 1;
    sprite.visible = true;
    return sprite;
}

function ensureSpriteCharacterChild(
    container: CharacterDisplayContainer,
    key: CharacterDisplayStorageKey,
    tag: string,
    texture: Texture,
): Sprite {
    let sprite = getStoredCharacterChild<Sprite>(container, key, tag);

    if (!sprite) {
        sprite = new Sprite(texture);
        (sprite as any)[tag] = true;
        container.addChild(sprite);
        (container as any)[key] = sprite;
    } else {
        sprite.texture = texture;
        if (sprite.parent !== container) {
            container.addChild(sprite);
        }
    }

    sprite.alpha = 1;
    sprite.visible = true;
    return sprite;
}

function ensureTextCharacterChild(
    container: CharacterDisplayContainer,
    key: CharacterDisplayStorageKey,
    tag: string,
    createLabel: () => Text,
): Text {
    let label = getStoredCharacterChild<Text>(container, key, tag);

    if (!label) {
        label = createLabel();
        (label as any)[tag] = true;
        container.addChild(label);
        (container as any)[key] = label;
    } else if (label.parent !== container) {
        container.addChild(label);
    }

    return label;
}

export async function renderRemoteCharacter(
    engine: Engine,
    entity: Character | null | undefined,
    deps: CharacterRendererDeps,
): Promise<void> {
    if (
        !entity ||
        !deps.canUseEngineContainer(engine, engine.mapContainer) ||
        !engine.bodiesDB ||
        !engine.headsDB ||
        !engine.graphicsDB ||
        entity.tthoney ||
        entity.id === engine.user?.id
    ) {
        return;
    }

    const renderRequestId =
        (engine.remoteEntityRenderRequestIds.get(entity.id) ?? 0) + 1;
    engine.remoteEntityRenderRequestIds.set(entity.id, renderRequestId);
    const isStaleRender = () =>
        engine.remoteEntityRenderRequestIds.get(entity.id) !== renderRequestId;

    const previousContainer = engine.remoteEntities.get(entity.id) as
        | CharacterDisplayContainer
        | undefined;

    const bodyRenderState = resolveBodyRenderState(
        engine,
        entity,
        deps.resolveNakedBodyIdFromHeadId,
    );
    const bodyData = bodyRenderState?.bodyData;
    if (!bodyData) return;

    const shouldAbortRender = () =>
        engine.isDestroyed ||
        isStaleRender() ||
        !deps.canUseEngineContainer(engine, engine.mapContainer);

    const direction = entity.heading.toString();

    const weaponData = entity.idWeapon
        ? engine.weaponsDB?.[entity.idWeapon.toString()]
        : undefined;
    const shieldData = entity.idShield
        ? engine.shieldsDB?.[entity.idShield.toString()]
        : undefined;
    const helmetData = entity.idHelmet
        ? engine.helmetsDB?.[entity.idHelmet.toString()]
        : undefined;

    if (bodyRenderState?.isFallback) {
        void ensureCharacterBodyReady(
            engine,
            entity,
            deps.preloadGraphicIds,
        ).catch((error) => {
            console.warn(
                `Failed to load body ${entity.idBody} in background:`,
                error,
            );
        });
    }

    const bodyGraphicId = bodyData[direction as keyof typeof bodyData];
    const bodyGraphicData = engine.graphicsDB[bodyGraphicId.toString()];
    if (!bodyGraphicData) return;

    let weaponTextures: Texture[] | undefined;
    let shieldTextures: Texture[] | undefined;
    let headTexture: Texture | undefined;
    let helmetTexture: Texture | undefined;

    let bodyTextures = engine.animatedTextureCache.get(
        bodyGraphicId.toString(),
    );
    if (!bodyTextures) {
        const loadedTextures = await deps.loadCharacterTextures(
            engine,
            bodyGraphicId,
            bodyGraphicData,
        );
        if (shouldAbortRender()) return;
        if (loadedTextures) {
            bodyTextures = loadedTextures;
            engine.animatedTextureCache.set(
                bodyGraphicId.toString(),
                loadedTextures,
            );
        }
    }
    if (shouldAbortRender()) return;
    if (!bodyTextures || bodyTextures.length === 0) return;

    if (weaponData) {
        const weaponGraphicId =
            weaponData[direction as keyof DirectionalGraphicData];
        const weaponGraphicData = engine.graphicsDB[weaponGraphicId.toString()];
        if (weaponGraphicData) {
            weaponTextures = engine.animatedTextureCache.get(
                weaponGraphicId.toString(),
            );
            if (!weaponTextures) {
                const loadedTextures = await deps.loadCharacterTextures(
                    engine,
                    weaponGraphicId,
                    weaponGraphicData,
                );
                if (shouldAbortRender()) return;
                if (loadedTextures) {
                    weaponTextures = loadedTextures;
                    engine.animatedTextureCache.set(
                        weaponGraphicId.toString(),
                        loadedTextures,
                    );
                }
            }

            if (shouldAbortRender()) return;
        }
    }

    if (shieldData) {
        const shieldGraphicId =
            shieldData[direction as keyof DirectionalGraphicData];
        const shieldGraphicData = engine.graphicsDB[shieldGraphicId.toString()];
        if (shieldGraphicData) {
            shieldTextures = engine.animatedTextureCache.get(
                shieldGraphicId.toString(),
            );
            if (!shieldTextures) {
                const loadedTextures = await deps.loadCharacterTextures(
                    engine,
                    shieldGraphicId,
                    shieldGraphicData,
                );
                if (shouldAbortRender()) return;
                if (loadedTextures) {
                    shieldTextures = loadedTextures;
                    engine.animatedTextureCache.set(
                        shieldGraphicId.toString(),
                        loadedTextures,
                    );
                }
            }

            if (shouldAbortRender()) return;
        }
    }

    const headData = shouldRenderHead(engine, entity)
        ? engine.headsDB[entity.idHead.toString()]
        : undefined;
    if (headData && entity.idHead > 0) {
        const headGraphicId = headData[direction as keyof typeof headData];
        if (headGraphicId > 0) {
            headTexture = engine.textureCache.get(headGraphicId.toString());
            if (!headTexture) {
                const headGraphicData =
                    engine.graphicsDB[headGraphicId.toString()];
                if (headGraphicData) {
                    const loadedTexture = await deps.loadSingleTexture(
                        engine,
                        headGraphicId,
                        headGraphicData,
                    );
                    if (shouldAbortRender()) return;
                    if (loadedTexture) {
                        headTexture = loadedTexture;
                        engine.textureCache.set(
                            headGraphicId.toString(),
                            loadedTexture,
                        );
                    }
                }
            }

            if (shouldAbortRender()) return;
        }
    }

    if (helmetData && (entity.idHelmet ?? 0) > 0) {
        const helmetGraphicId = helmetData[direction as keyof HelmetData];
        if (helmetGraphicId > 0) {
            helmetTexture = engine.textureCache.get(helmetGraphicId.toString());
            if (!helmetTexture) {
                const helmetGraphicData =
                    engine.graphicsDB[helmetGraphicId.toString()];
                if (helmetGraphicData) {
                    const loadedTexture = await deps.loadSingleTexture(
                        engine,
                        helmetGraphicId,
                        helmetGraphicData,
                    );
                    if (shouldAbortRender()) return;
                    if (loadedTexture) {
                        helmetTexture = loadedTexture;
                        engine.textureCache.set(
                            helmetGraphicId.toString(),
                            loadedTexture,
                        );
                    }
                }
            }

            if (shouldAbortRender()) return;
        }
    }

    if (shouldAbortRender()) {
        return;
    }

    const container = (previousContainer ??
        new Container()) as CharacterDisplayContainer;
    if (!previousContainer) {
        container.sortableChildren = true;
    }

    container.alpha = getCharacterRenderAlpha(entity, engine.runtimeTiming, {
        localPartyMemberIds: deps.partyMemberIdsRef.current,
        localClanTag: engine.user?.clan,
        isAdminViewer: deps.playerHudRef.current?.privileges === 1,
    });
    container.x = Math.round(
        (entity.pos.x - 1) * TILE_SIZE + entity.moveOffsetX,
    );
    container.y = Math.round(
        (entity.pos.y - 1) * TILE_SIZE + entity.moveOffsetY,
    );
    container.zIndex = getRowZIndex(
        entity.pos.y - (entity.addtoUserPos?.y ?? 0),
        Z_INDEX_LAYERS.CHARACTER,
    );

    const bodySprite = ensureAnimatedCharacterChild(
        container,
        "bodySprite",
        "isRemoteBody",
        bodyTextures,
    );
    const bodyPosition = getBodySpritePosition(bodyTextures[0]);
    bodySprite.x = bodyPosition.x;
    bodySprite.y = bodyPosition.y;
    bodySprite.zIndex = 0.2;
    const bodyMetrics: BodyRenderMetrics = {
        x: bodySprite.x,
        y: bodySprite.y,
        width: bodyTextures[0].width,
        height: bodyTextures[0].height,
    };
    (bodySprite as any).renderMetrics = bodyMetrics;
    container.bodyMetrics = bodyMetrics;

    const hideBody = deps.shouldHideRemoteCharacterBody(
        entity,
        engine.user?.id,
        deps.partyMemberIdsRef.current,
    );
    bodySprite.visible = !hideBody;

    if (weaponTextures && weaponTextures.length > 0) {
        const weaponSprite = ensureAnimatedCharacterChild(
            container,
            "weaponSprite",
            "isRemoteWeapon",
            weaponTextures,
        );
        const weaponPosition = getEquipmentSpritePosition(
            "weapon",
            weaponTextures[0],
        );
        weaponSprite.x = Math.round(weaponPosition.x);
        weaponSprite.y = Math.round(weaponPosition.y);
        weaponSprite.zIndex = 0.4;
        weaponSprite.visible = !hideBody;
    } else {
        removeStoredCharacterChild(
            container,
            "weaponSprite",
            "isRemoteWeapon",
            deps.destroyDisplayObjectSafely,
        );
    }

    if (shieldTextures && shieldTextures.length > 0) {
        const shieldSprite = ensureAnimatedCharacterChild(
            container,
            "shieldSprite",
            "isRemoteShield",
            shieldTextures,
        );
        const shieldPosition = getEquipmentSpritePosition(
            "shield",
            shieldTextures[0],
        );
        shieldSprite.x = Math.round(shieldPosition.x);
        shieldSprite.y = Math.round(shieldPosition.y);
        shieldSprite.zIndex = 0.5;
        shieldSprite.visible = !hideBody;
    } else {
        removeStoredCharacterChild(
            container,
            "shieldSprite",
            "isRemoteShield",
            deps.destroyDisplayObjectSafely,
        );
    }

    if (headTexture) {
        const headSprite = ensureSpriteCharacterChild(
            container,
            "headSprite",
            "isRemoteHead",
            headTexture,
        );
        const headPosition = getHeadSpritePosition(
            bodyMetrics,
            bodyData,
            headTexture,
        );
        headSprite.x = Math.round(headPosition.x);
        headSprite.y = Math.round(headPosition.y);
        headSprite.zIndex = 0.1;
        headSprite.visible = !hideBody;
    } else {
        removeStoredCharacterChild(
            container,
            "headSprite",
            "isRemoteHead",
            deps.destroyDisplayObjectSafely,
        );
    }

    if (helmetTexture && helmetData) {
        const helmetSprite = ensureSpriteCharacterChild(
            container,
            "helmetSprite",
            "isRemoteHelmet",
            helmetTexture,
        );
        const helmetPosition = getHelmetSpritePosition(
            bodyMetrics,
            bodyData,
            helmetTexture,
            helmetData,
        );
        helmetSprite.x = Math.round(helmetPosition.x);
        helmetSprite.y = Math.round(helmetPosition.y);
        helmetSprite.zIndex = 0.3;
        helmetSprite.visible = !hideBody;
    } else {
        removeStoredCharacterChild(
            container,
            "helmetSprite",
            "isRemoteHelmet",
            deps.destroyDisplayObjectSafely,
        );
    }

    const shouldShowRemoteName =
        !hideBody &&
        !shouldHideRemoteCharacterName(
            entity,
            deps.partyMemberIdsRef.current,
            engine.user?.clan,
            deps.playerHudRef.current?.privileges === 1,
        );

    const clanLabelText = !entity.isNpc ? getCharacterClanLabel(entity) : null;

    if (!entity.isNpc) {
        const labelPosition = getNameLabelPosition(bodyMetrics);
        const nameLabel = ensureTextCharacterChild(
            container,
            "nameLabel",
            "isRemoteName",
            () => {
                const label = new Text({
                    text: getCharacterNameLabel(entity),
                    style: createCharacterNameTextStyle(
                        entity.color || 0xffffff,
                    ),
                });
                label.anchor.set(0.5, 0);
                return label;
            },
        );
        setTextIfChanged(nameLabel, getCharacterNameLabel(entity));
        nameLabel.style = createCharacterNameTextStyle(
            entity.color || 0xffffff,
        );
        nameLabel.x = Math.round(labelPosition.x);
        nameLabel.y = Math.round(labelPosition.y);
        nameLabel.zIndex = 0.6;
        setVisibilityIfChanged(nameLabel, shouldShowRemoteName);

        if (clanLabelText) {
            const clanLabel = ensureTextCharacterChild(
                container,
                "clanLabel",
                "isRemoteClan",
                () => {
                    const label = new Text({
                        text: clanLabelText,
                        style: createCharacterClanTextStyle(
                            entity.color || 0xffffff,
                        ),
                    });
                    label.anchor.set(0.5, 0);
                    return label;
                },
            );
            setTextIfChanged(clanLabel, clanLabelText);
            setStyleIfChanged(
                clanLabel,
                createCharacterClanTextStyle(
                    shouldHighlightClanTag(
                        entity,
                        engine.user?.clan,
                        deps.playerHudRef.current,
                    )
                        ? CLAN_TAG_HIGHLIGHT_COLOR
                        : entity.color || 0xffffff,
                ),
            );
            clanLabel.x = Math.round(labelPosition.x);
            clanLabel.y = Math.round(labelPosition.y + 13);
            clanLabel.zIndex = 0.6;
            setVisibilityIfChanged(clanLabel, shouldShowRemoteName);
        } else {
            removeStoredCharacterChild(
                container,
                "clanLabel",
                "isRemoteClan",
                deps.destroyDisplayObjectSafely,
            );
        }
    } else {
        removeStoredCharacterChild(
            container,
            "nameLabel",
            "isRemoteName",
            deps.destroyDisplayObjectSafely,
        );
        removeStoredCharacterChild(
            container,
            "clanLabel",
            "isRemoteClan",
            deps.destroyDisplayObjectSafely,
        );
    }

    ensureCrowdControlBar(
        container,
        bodyMetrics,
        entity,
        {
            hideBody,
            showNameplate: entity.isNpc ? undefined : true,
            showClanLabel: entity.isNpc ? undefined : Boolean(clanLabelText),
        },
        deps.destroyDisplayObjectSafely,
    );
    ensureAdminSummonedBotVitals(
        container,
        bodyMetrics,
        entity,
        {
            hideBody,
        },
        deps.destroyDisplayObjectSafely,
    );
    ensureHealthBar(
        container,
        bodyMetrics,
        entity,
        {
            hideBody,
            showNameplate: entity.isNpc ? undefined : shouldShowRemoteName,
            showClanLabel: entity.isNpc
                ? undefined
                : Boolean(clanLabelText && shouldShowRemoteName),
            showHealthBar:
                !entity.adminSummonedBot &&
                engine.healthBarEntityIds.has(entity.id),
        },
        deps.destroyDisplayObjectSafely,
    );

    const debugPositionLabel = ensureTextCharacterChild(
        container,
        "debugPositionLabel",
        "isDebugPosition",
        () => deps.createDebugPositionLabel("") as Text,
    );
    const debugLabelPosition = getDebugPositionLabelPosition(bodyMetrics);
    debugPositionLabel.x = Math.round(debugLabelPosition.x);
    debugPositionLabel.y = Math.round(debugLabelPosition.y);
    debugPositionLabel.zIndex = 0.7;
    setVisibilityIfChanged(debugPositionLabel, engine.isDebugMode && !hideBody);
    if (engine.isDebugMode && !hideBody) {
        setTextIfChanged(
            debugPositionLabel,
            deps.formatCharacterAnimationDebugLabel(entity),
        );
    }

    const characterLayerContainer = getMapRowLayerContainer(
        engine,
        entity.pos.y - (entity.addtoUserPos?.y ?? 0),
        "character",
    );
    if (!characterLayerContainer) {
        return;
    }

    deps.removeDialogBubbleFromContainer(container);
    deps.removeDialogBubbleFromOverlay(engine, entity.id);
    if (container.parent !== characterLayerContainer) {
        characterLayerContainer.addChild(container);
    }
    engine.remoteEntities.set(entity.id, container);
    await deps.syncEntityFX(engine, entity.id);
    deps.syncDialogBubble(engine, entity.id);
}

export async function renderLocalPlayer(
    engine: Engine,
    deps: Omit<CharacterRendererDeps, "collectCharacterGraphicIds">,
): Promise<void> {
    if (
        !deps.canUseEngineContainer(engine, engine.playerContainer) ||
        !engine.user ||
        !engine.bodiesDB ||
        !engine.headsDB ||
        !engine.graphicsDB ||
        !engine.app
    ) {
        return;
    }

    const direction = engine.user.heading.toString();
    const renderRequestId = ((engine as any).playerRenderRequestId ?? 0) + 1;
    (engine as any).playerRenderRequestId = renderRequestId;
    (engine.playerContainer as any).lastDirection = direction;

    const isStaleRender = () =>
        (engine as any).playerRenderRequestId !== renderRequestId ||
        !deps.canUseEngineContainer(engine, engine.playerContainer);

    const bodyRenderState = resolveBodyRenderState(
        engine,
        engine.user,
        deps.resolveNakedBodyIdFromHeadId,
    );
    const bodyData = bodyRenderState?.bodyData;
    const headData = shouldRenderHead(engine, engine.user)
        ? engine.headsDB[engine.user.idHead.toString()]
        : undefined;
    const weaponData = engine.user.idWeapon
        ? engine.weaponsDB?.[engine.user.idWeapon.toString()]
        : undefined;
    const shieldData = engine.user.idShield
        ? engine.shieldsDB?.[engine.user.idShield.toString()]
        : undefined;
    const helmetData = engine.user.idHelmet
        ? engine.helmetsDB?.[engine.user.idHelmet.toString()]
        : undefined;

    if (!bodyData) {
        console.warn(`Body ${engine.user.idBody} not found`);
        return;
    }

    if (bodyRenderState?.isFallback) {
        void ensureCharacterBodyReady(
            engine,
            engine.user,
            deps.preloadGraphicIds,
        ).catch((error) => {
            console.warn("Failed to load local body in background:", error);
        });
    }

    const bodyGraphicId = bodyData[direction as keyof typeof bodyData];
    const bodyGraphicData = engine.graphicsDB[bodyGraphicId.toString()];

    if (!bodyGraphicData) {
        console.warn(
            `Body graphic data not found for direction ${direction}, bodyGraphicId: ${bodyGraphicId}`,
        );
        return;
    }

    let bodyTextures = engine.animatedTextureCache.get(
        bodyGraphicId.toString(),
    );
    if (!bodyTextures) {
        const loadedTextures = await deps.loadCharacterTextures(
            engine,
            bodyGraphicId,
            bodyGraphicData,
        );
        if (isStaleRender()) return;
        if (loadedTextures) {
            bodyTextures = loadedTextures;
            engine.animatedTextureCache.set(
                bodyGraphicId.toString(),
                bodyTextures,
            );
        }
    }

    if (!bodyTextures || bodyTextures.length === 0) {
        console.warn(
            `No body textures found for bodyGraphicId: ${bodyGraphicId}`,
        );
        return;
    }

    if (isStaleRender()) {
        return;
    }

    let weaponTextures: Texture[] | undefined;
    let shieldTextures: Texture[] | undefined;
    let headTexture: Texture | undefined;
    let helmetTexture: Texture | undefined;

    if (weaponData) {
        const weaponGraphicId =
            weaponData[direction as keyof DirectionalGraphicData];
        const weaponGraphicData = engine.graphicsDB[weaponGraphicId.toString()];

        if (weaponGraphicData) {
            weaponTextures = engine.animatedTextureCache.get(
                weaponGraphicId.toString(),
            );
            if (!weaponTextures) {
                const loadedTextures = await deps.loadCharacterTextures(
                    engine,
                    weaponGraphicId,
                    weaponGraphicData,
                );
                if (isStaleRender()) return;
                if (loadedTextures) {
                    weaponTextures = loadedTextures;
                    engine.animatedTextureCache.set(
                        weaponGraphicId.toString(),
                        loadedTextures,
                    );
                }
            }
        }
    }

    if (shieldData) {
        const shieldGraphicId =
            shieldData[direction as keyof DirectionalGraphicData];
        const shieldGraphicData = engine.graphicsDB[shieldGraphicId.toString()];

        if (shieldGraphicData) {
            shieldTextures = engine.animatedTextureCache.get(
                shieldGraphicId.toString(),
            );
            if (!shieldTextures) {
                const loadedTextures = await deps.loadCharacterTextures(
                    engine,
                    shieldGraphicId,
                    shieldGraphicData,
                );
                if (isStaleRender()) return;
                if (loadedTextures) {
                    shieldTextures = loadedTextures;
                    engine.animatedTextureCache.set(
                        shieldGraphicId.toString(),
                        loadedTextures,
                    );
                }
            }
        }
    }

    if (headData && engine.user.idHead > 0) {
        const headGraphicId = headData[direction as keyof typeof headData];
        if (headGraphicId > 0) {
            headTexture = engine.textureCache.get(headGraphicId.toString());
            if (!headTexture) {
                const headGraphicData =
                    engine.graphicsDB[headGraphicId.toString()];
                if (headGraphicData) {
                    const loadedTexture = await deps.loadSingleTexture(
                        engine,
                        headGraphicId,
                        headGraphicData,
                    );
                    if (isStaleRender()) return;
                    if (loadedTexture) {
                        headTexture = loadedTexture;
                        engine.textureCache.set(
                            headGraphicId.toString(),
                            headTexture,
                        );
                    }
                }
            }
        }
    }

    if (helmetData && (engine.user.idHelmet ?? 0) > 0) {
        const helmetGraphicId = helmetData[direction as keyof HelmetData];
        if (helmetGraphicId > 0) {
            helmetTexture = engine.textureCache.get(helmetGraphicId.toString());
            if (!helmetTexture) {
                const helmetGraphicData =
                    engine.graphicsDB[helmetGraphicId.toString()];
                if (helmetGraphicData) {
                    const loadedTexture = await deps.loadSingleTexture(
                        engine,
                        helmetGraphicId,
                        helmetGraphicData,
                    );
                    if (isStaleRender()) return;
                    if (loadedTexture) {
                        helmetTexture = loadedTexture;
                        engine.textureCache.set(
                            helmetGraphicId.toString(),
                            helmetTexture,
                        );
                    }
                }
            }
        }
    }

    if (isStaleRender()) {
        return;
    }

    const playerContainer = engine.playerContainer;
    if (!playerContainer) {
        return;
    }

    const container = playerContainer as CharacterDisplayContainer;
    const bodySprite = ensureAnimatedCharacterChild(
        container,
        "bodySprite",
        "isPlayerBody",
        bodyTextures,
    );
    const bodyPosition = getBodySpritePosition(bodyTextures[0]);
    bodySprite.x = bodyPosition.x;
    bodySprite.y = bodyPosition.y;
    bodySprite.zIndex = 0.2;
    bodySprite.alpha = 1;
    bodySprite.visible = true;
    (bodySprite as any).bodyOffsetX = -bodyPosition.x;
    (bodySprite as any).bodyOffsetY = -bodyPosition.y;
    const bodyMetrics: BodyRenderMetrics = {
        x: bodySprite.x,
        y: bodySprite.y,
        width: bodyTextures[0].width,
        height: bodyTextures[0].height,
    };
    (bodySprite as any).renderMetrics = bodyMetrics;
    container.bodyMetrics = bodyMetrics;

    if (weaponTextures && weaponTextures.length > 0) {
        const weaponSprite = ensureAnimatedCharacterChild(
            container,
            "weaponSprite",
            "isPlayerWeapon",
            weaponTextures,
        );
        const weaponPosition = getEquipmentSpritePosition(
            "weapon",
            weaponTextures[0],
        );
        weaponSprite.x = Math.round(weaponPosition.x);
        weaponSprite.y = Math.round(weaponPosition.y);
        weaponSprite.zIndex = 0.4;
    } else {
        removeStoredCharacterChild(
            container,
            "weaponSprite",
            "isPlayerWeapon",
            deps.destroyDisplayObjectSafely,
        );
    }

    if (shieldTextures && shieldTextures.length > 0) {
        const shieldSprite = ensureAnimatedCharacterChild(
            container,
            "shieldSprite",
            "isPlayerShield",
            shieldTextures,
        );
        const shieldPosition = getEquipmentSpritePosition(
            "shield",
            shieldTextures[0],
        );
        shieldSprite.x = Math.round(shieldPosition.x);
        shieldSprite.y = Math.round(shieldPosition.y);
        shieldSprite.zIndex = 0.5;
    } else {
        removeStoredCharacterChild(
            container,
            "shieldSprite",
            "isPlayerShield",
            deps.destroyDisplayObjectSafely,
        );
    }

    if (headTexture) {
        const headSprite = ensureSpriteCharacterChild(
            container,
            "headSprite",
            "isPlayerHead",
            headTexture,
        );
        const headPosition = getHeadSpritePosition(
            bodyMetrics,
            bodyData,
            headTexture,
        );
        headSprite.x = Math.round(headPosition.x);
        headSprite.y = Math.round(headPosition.y);
        headSprite.zIndex = 0.1;
    } else {
        removeStoredCharacterChild(
            container,
            "headSprite",
            "isPlayerHead",
            deps.destroyDisplayObjectSafely,
        );
    }

    if (helmetTexture && helmetData) {
        const helmetSprite = ensureSpriteCharacterChild(
            container,
            "helmetSprite",
            "isPlayerHelmet",
            helmetTexture,
        );
        const helmetPosition = getHelmetSpritePosition(
            bodyMetrics,
            bodyData,
            helmetTexture,
            helmetData,
        );
        helmetSprite.x = Math.round(helmetPosition.x);
        helmetSprite.y = Math.round(helmetPosition.y);
        helmetSprite.zIndex = 0.3;
    } else {
        removeStoredCharacterChild(
            container,
            "helmetSprite",
            "isPlayerHelmet",
            deps.destroyDisplayObjectSafely,
        );
    }

    const namePosition = getNameLabelPosition(bodyMetrics);
    const nameLabel = ensureTextCharacterChild(
        container,
        "nameLabel",
        "isPlayerName",
        () => {
            const label = new Text({
                text: getCharacterNameLabel(engine.user),
                style: createCharacterNameTextStyle(
                    engine.user!.color || 0xffffff,
                ),
            });
            label.anchor.set(0.5, 0);
            return label;
        },
    );
    setTextIfChanged(nameLabel, getCharacterNameLabel(engine.user));
    nameLabel.style = createCharacterNameTextStyle(
        engine.user.color || 0xffffff,
    );
    nameLabel.x = Math.round(namePosition.x);
    nameLabel.y = Math.round(namePosition.y);
    nameLabel.zIndex = 0.6;
    setVisibilityIfChanged(nameLabel, true);

    const playerClanLabelText = getCharacterClanLabel(engine.user);
    if (playerClanLabelText) {
        const clanLabel = ensureTextCharacterChild(
            container,
            "clanLabel",
            "isPlayerClan",
            () => {
                const label = new Text({
                    text: playerClanLabelText,
                    style: createCharacterClanTextStyle(
                        engine.user!.color || 0xffffff,
                    ),
                });
                label.anchor.set(0.5, 0);
                return label;
            },
        );
        setTextIfChanged(clanLabel, playerClanLabelText);
        setStyleIfChanged(
            clanLabel,
            createCharacterClanTextStyle(
                shouldHighlightClanTag(
                    engine.user,
                    engine.user?.clan,
                    deps.playerHudRef.current,
                )
                    ? CLAN_TAG_HIGHLIGHT_COLOR
                    : engine.user.color || 0xffffff,
            ),
        );
        clanLabel.x = Math.round(namePosition.x);
        clanLabel.y = Math.round(namePosition.y + 13);
        clanLabel.zIndex = 0.6;
        setVisibilityIfChanged(clanLabel, true);
    } else {
        removeStoredCharacterChild(
            container,
            "clanLabel",
            "isPlayerClan",
            deps.destroyDisplayObjectSafely,
        );
    }

    ensureCrowdControlBar(
        container,
        bodyMetrics,
        engine.user,
        {
            hideBody: false,
            showNameplate: true,
            showClanLabel: Boolean(playerClanLabelText),
        },
        deps.destroyDisplayObjectSafely,
    );

    const debugPositionLabel = ensureTextCharacterChild(
        container,
        "debugPositionLabel",
        "isDebugPosition",
        () => deps.createDebugPositionLabel("") as Text,
    );
    const debugLabelPosition = getDebugPositionLabelPosition(bodyMetrics);
    debugPositionLabel.x = Math.round(debugLabelPosition.x);
    debugPositionLabel.y = Math.round(debugLabelPosition.y);
    debugPositionLabel.zIndex = 0.7;
    setVisibilityIfChanged(debugPositionLabel, engine.isDebugMode);
    if (engine.isDebugMode) {
        setTextIfChanged(
            debugPositionLabel,
            deps.formatCharacterAnimationDebugLabel(engine.user),
        );
    }

    deps.removeDialogBubbleFromContainer(container);

    playerContainer.alpha = getCharacterRenderAlpha(
        engine.user,
        engine.runtimeTiming,
        { isLocalCharacter: true, localClanTag: engine.user?.clan },
    );

    await deps.syncEntityFX(engine, engine.user.id);
    deps.syncDialogBubble(engine, engine.user.id);

    (playerContainer as any).bodySprite = bodySprite;
    (playerContainer as any).lastDirection = direction;
    engine.updatePlayerSprite();
}
