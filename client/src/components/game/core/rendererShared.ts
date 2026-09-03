// Module-scope helpers extracted verbatim from
// frontend/components/game/core/MapRendererCore.tsx (lines 91-130 and 250-653).
import {
    Container,
    Text,
    TextStyle,
    CanvasTextMetrics,
    Graphics,
} from "pixi.js";
import { MapTile } from "../../../types/game";
import { getTileAt } from "../../../utils/gameLoader";
import type { SoundPosition } from "../../../lib/sound";
import { Engine, type Character } from "../engine/Engine";

export type ResourceKind = "hp" | "mana";

export type ResourceChangeSample = {
    at: number;
    resource: ResourceKind;
    previous: number;
    current: number;
    max: number | null;
    percent: number | null;
};

export type ResourceReactionSample = ResourceChangeSample & {
    reactionMs: number;
    slot: number;
    itemId: number | null;
    itemName: string | null;
    trustedInputAgeMs: number | null;
    untrustedInputAgeMs: number | null;
};

export type SpellTargetSnapSample = {
    at: number;
    clickedTileX: number;
    clickedTileY: number;
    resolvedX: number;
    resolvedY: number;
    tileDistance: number;
    resolvedEntityId: number | null;
    resolvedEntityType: "player" | "npc" | "self" | "none";
    resolvedSource:
        | "pointer_entity"
        | "exact_tile_entity"
        | "self_pointer"
        | "raw_tile";
};

export type PerformanceSample = {
    fps: number | null;
    pingMs: number | null;
};

export type ActiveDialogMessage = {
    text: string;
    color?: string;
    timeoutId: number;
    variant: "bubble" | "floatingCombat";
    startedAt: number;
    durationMs: number;
};

export type ActiveCastBar = {
    startedAt: number;
    durationMs: number;
};

export type PendingTileState = {
    objInfo?: MapTile["objInfo"] | null;
    blocked?: MapTile["blocked"] | null;
};

export const FPS_TEXT_OFFSET_X = 10;
export const FPS_TEXT_OFFSET_Y = 8;
export const PING_TEXT_OFFSET_Y = 22;
export const SEGURO_TEXT_OFFSET_Y = 36;
export const CLAN_SEGURO_TEXT_OFFSET_Y = 50;
export const DEBUG_COMBAT_TEXT_OFFSET_Y = 50;
export const PROJECTILE_BASE_ANGLE_RADIANS = -Math.PI / 4;
export const PROJECTILE_MIN_DURATION_MS = 90;
export const PROJECTILE_MAX_DURATION_MS = 280;
export const PROJECTILE_PIXELS_PER_MS = 1.1;
export const DIALOG_MESSAGE_BASE_DURATION_MS = 4000;
export const DIALOG_MESSAGE_EXTRA_PER_CHARACTER_MS = 45;
export const DIALOG_MESSAGE_MAX_DURATION_MS = 8000;
export const DIALOG_BUBBLE_MAX_WIDTH = 180;
export const CAST_BAR_WIDTH = 40;
export const CAST_BAR_HEIGHT = 5;
export const DEFAULT_ENTITY_FX_DURATION_MS = 450;
export const PERSISTENT_ENTITY_FX_IDS = new Set([4, 5, 6, 16, 34]);
export const ENTITY_FX_ALPHA = 0.75;

export const getDialogMessageDuration = (text: string): number =>
    Math.min(
        DIALOG_MESSAGE_MAX_DURATION_MS,
        DIALOG_MESSAGE_BASE_DURATION_MS +
            text.trim().length * DIALOG_MESSAGE_EXTRA_PER_CHARACTER_MS,
    );

export const isCombatDialogMessage = (text: string, color?: string): boolean => {
    if ((color || "").trim().toLowerCase() !== "red") {
        return false;
    }

    const normalized = text.trim();
    if (!normalized) {
        return false;
    }

    if (/^[!¡]?(?:\d+)[!¡]?$/.test(normalized)) {
        return true;
    }

    return /^.?fallas.?$/i.test(normalized);
};

export const getGraphicImagePaths = (imageFile: string | number): string[] => [
    `/graphics/${imageFile}.png`,
    `/static/graphics/${imageFile}.png`,
];

export function shouldHideRemoteCharacterBody(
    character: Character | null | undefined,
    localUserId?: number,
    localPartyMemberIds?: ReadonlySet<string>,
): boolean {
    void localUserId;
    void localPartyMemberIds;

    return false;
}

export const STEP_SOUNDS = {
    bosque: [201, 69],
    nieve: [199, 200],
    caballo: [70, 71],
    dungeon: [23, 24],
    desierto: [197, 198],
    piso: [23, 24],
    agua: [50, 50],
} as const;

export const MIN_STEP_SOUND_INTERVAL_MS = 70;

export type StepTerrain = keyof typeof STEP_SOUNDS;

export function isCharacterInmovilizado(movementRestriction?: number): boolean {
    return movementRestriction === 1;
}

export function isCharacterParalizado(movementRestriction?: number): boolean {
    return movementRestriction === 2;
}

export function resolveEntitySoundPosition(
    engine: Engine,
    entityId?: number,
): SoundPosition | undefined {
    if (entityId == null) {
        return;
    }

    const entity =
        entityId === engine.user?.id
            ? engine.user
            : engine.personajes[entityId];

    if (!entity) {
        return;
    }

    return {
        map: entity.map,
        x: entity.pos.x,
        y: entity.pos.y,
    };
}

export function getTileTerrainFileNumber(
    engine: Engine,
    mapNumber: number,
    x: number,
    y: number,
): number {
    if (!engine.mapData || !engine.graphicsDB) {
        return 0;
    }

    const tile = getTileAt(engine.mapData, mapNumber, x, y);
    const layer1 = tile?.graphics?.["1"];

    if (!layer1) {
        return 0;
    }

    return Number(engine.graphicsDB[layer1.toString()]?.numFile ?? 0);
}

export function resolveStepTerrain(engine: Engine, character: Character): StepTerrain {
    if (character.navegando) {
        return "agua";
    }

    const tile = engine.mapData
        ? getTileAt(
              engine.mapData,
              character.map,
              character.pos.x,
              character.pos.y,
          )
        : undefined;
    const terrainFileNum = getTileTerrainFileNumber(
        engine,
        character.map,
        character.pos.x,
        character.pos.y,
    );
    const layer2 = Number(tile?.graphics?.["2"] ?? 0);

    if (
        (terrainFileNum >= 6000 && terrainFileNum <= 6004) ||
        (terrainFileNum >= 550 && terrainFileNum <= 552) ||
        (terrainFileNum >= 6018 && terrainFileNum <= 6020)
    ) {
        return "bosque";
    }

    if (
        (terrainFileNum >= 7501 && terrainFileNum <= 7507) ||
        terrainFileNum === 7500 ||
        terrainFileNum === 7508 ||
        terrainFileNum === 1533 ||
        terrainFileNum === 2508
    ) {
        return "dungeon";
    }

    if (terrainFileNum >= 5000 && terrainFileNum <= 5004) {
        return "nieve";
    }

    if (
        (terrainFileNum >= 6018 && terrainFileNum <= 6021) ||
        terrainFileNum === 186 ||
        terrainFileNum === 8007
    ) {
        return "desierto";
    }

    if (terrainFileNum === 20 && layer2 === 0) {
        return "agua";
    }

    return "piso";
}

export function resolveStepSoundId(
    engine: Engine,
    character: Character,
    nextStepVariant: 0 | 1,
): any {
    return STEP_SOUNDS[resolveStepTerrain(engine, character)][nextStepVariant];
}

/**
 * Create debug grid to show tile boundaries
 */
export function isContainerActive(
    container: Container | null | undefined,
): container is Container {
    return Boolean(
        container && !(container as { destroyed?: boolean }).destroyed,
    );
}

export function canUseEngineContainer(
    engine: Engine,
    container: Container | null | undefined,
): container is Container {
    return (
        !engine.isDestroyed &&
        Boolean(engine.app) &&
        isContainerActive(container)
    );
}

export function formatDebugPositionLabel(position: { x: number; y: number }): string {
    return `(${position.x}, ${position.y})`;
}

export function formatCharacterAnimationDebugLabel(character: Character): string {
    const frameCounter = Number.isFinite(character.frameCounter)
        ? character.frameCounter
        : 1;

    return [
        formatDebugPositionLabel(character.pos),
        `mov:${character.moving ? "1" : "0"} fc:${frameCounter.toFixed(2)}`,
        `idle:${
            typeof character.animationIdleStartedAt === "number"
                ? "hold"
                : "none"
        }`,
    ].join("\n");
}

export function createDebugPositionLabel(text: string): Text {
    const label = new Text({
        text,
        style: new TextStyle({
            fontFamily: "Courier New",
            fontSize: 10,
            fill: 0x86efac,
            stroke: { color: 0x000000, width: 2 },
        }),
    });
    label.anchor.set(0.5, 0);
    (label as any).isDebugPosition = true;
    return label;
}

export function setDebugPositionLabelsVisibility(
    container: Container,
    visible: boolean,
): void {
    for (const child of container.children) {
        if ((child as any).isDebugPosition) {
            child.visible = visible;
        }

        if (child instanceof Container) {
            setDebugPositionLabelsVisibility(child, visible);
        }
    }
}

export function createDialogBubble(text: string, color?: string): Container {
    const bubble = new Container();
    const labelStyleOptions = {
        fontFamily: "Georgia",
        fontSize: 12,
        fill: color || 0xffffff,
        align: "center" as const,
    };
    const singleLineMetrics = CanvasTextMetrics.measureText(
        text,
        new TextStyle(labelStyleOptions),
    );
    const label = new Text({
        text,
        style: new TextStyle({
            ...labelStyleOptions,
            wordWrap: singleLineMetrics.width > DIALOG_BUBBLE_MAX_WIDTH,
            wordWrapWidth: DIALOG_BUBBLE_MAX_WIDTH,
        }),
    });
    const background = new Graphics();
    const paddingX = 6;
    const paddingY = 4;
    const tailWidth = 10;
    const tailHeight = 8;
    const radius = 10;
    const labelBounds = label.getLocalBounds();
    const bubbleWidth = Math.max(
        tailWidth + paddingX * 2,
        labelBounds.width + paddingX * 2,
    );
    const bubbleHeight = Math.max(18, labelBounds.height + paddingY * 2);

    background
        .roundRect(
            -bubbleWidth / 2,
            -bubbleHeight,
            bubbleWidth,
            bubbleHeight,
            radius,
        )
        .fill({ color: 0x111827, alpha: 0.9 })
        .stroke({ color: 0xfde68a, alpha: 0.7, width: 1 })
        .poly([-tailWidth / 2, 0, 0, tailHeight, tailWidth / 2, 0])
        .fill({ color: 0x111827, alpha: 0.9 })
        .stroke({ color: 0xfde68a, alpha: 0.7, width: 1 });

    label.anchor.set(0.5, 1);
    label.x = 0;
    label.y = -paddingY;

    bubble.addChild(background);
    bubble.addChild(label);
    bubble.zIndex = 0.85;
    (bubble as any).isDialogBubble = true;

    return bubble;
}

export function createCastBar(): Container {
    const bar = new Container();
    const background = new Graphics();
    const fill = new Graphics();

    background
        .roundRect(
            -CAST_BAR_WIDTH / 2,
            -CAST_BAR_HEIGHT,
            CAST_BAR_WIDTH,
            CAST_BAR_HEIGHT,
            3,
        )
        .fill({ color: 0x111827, alpha: 0.92 })
        .stroke({ color: 0xfde68a, alpha: 0.9, width: 1 });

    fill.roundRect(
        0,
        -CAST_BAR_HEIGHT,
        CAST_BAR_WIDTH,
        CAST_BAR_HEIGHT,
        3,
    ).fill({ color: 0xf59e0b, alpha: 0.95 });

    fill.position.set(-CAST_BAR_WIDTH / 2, 0);

    bar.addChild(background);
    bar.addChild(fill);
    bar.zIndex = 0.84;
    (bar as any).isCastBar = true;
    (bar as any).castBarFill = fill;

    return bar;
}

export function createFloatingCombatText(text: string, color?: string): Text {
    const label = new Text({
        text,
        style: new TextStyle({
            fontFamily: "Verdana",
            fontSize: 12,
            fontWeight: "700",
            fill: color || 0xcc1b1b,
            align: "center",
            // stroke: { color: 0x5a0000, width: 1.5 },
            dropShadow: {
                alpha: 1,
                angle: Math.PI / 5,
                blur: 0,
                color: 0x000000,
                distance: 1,
            },
        }),
    });

    label.anchor.set(0.5, 1);
    label.zIndex = 0.9;
    (label as any).isDialogBubble = true;
    (label as any).dialogVariant = "floatingCombat";

    return label;
}
