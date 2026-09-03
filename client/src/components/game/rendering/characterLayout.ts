import { AnimatedSprite, Texture } from "pixi.js";

export type BodyRenderMetrics = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export function getBodySpritePosition(texture: Texture): {
    x: number;
    y: number;
} {
    return {
        x: 16 - Math.floor((texture.width * 16) / 32),
        y: 32 - Math.floor((texture.height * 32) / 32),
    };
}

export function getBottomAnchoredGraphicPosition(
    width: number,
    height: number,
): { x: number; y: number } {
    return {
        x: 16 - Math.floor((width * 16) / 32),
        y: 32 - Math.floor((height * 16) / 16),
    };
}

export function getHeadSpritePosition(
    bodyMetrics: BodyRenderMetrics,
    bodyData: { headOffsetX?: number; headOffsetY?: number },
    headTexture: Texture,
): { x: number; y: number } {
    return {
        x:
            bodyMetrics.x +
            bodyMetrics.width / 2 -
            headTexture.width / 2 +
            (bodyData.headOffsetX || 0),
        y:
            bodyMetrics.y +
            bodyMetrics.height -
            50 +
            (bodyData.headOffsetY || 0),
    };
}

export function getEquipmentSpritePosition(
    kind: "weapon" | "shield",
    texture: Texture,
): { x: number; y: number } {
    return {
        x: 16 - Math.floor((texture.width * 16) / 32),
        y:
            (kind === "weapon" ? 28 : 32) -
            Math.floor((texture.height * 32) / 32),
    };
}

export function updateAnimatedCharacterLayer(
    sprite: AnimatedSprite | undefined,
    frameCounter: number,
): void {
    if (!sprite || sprite.textures.length === 0) {
        return;
    }

    const frameIndex = Math.max(
        0,
        Math.min(Math.ceil(frameCounter) - 1, sprite.textures.length - 1),
    );

    if (sprite.currentFrame !== frameIndex) {
        sprite.currentFrame = frameIndex;
        const texture = sprite.textures[frameIndex];
        if (texture instanceof Texture) {
            sprite.texture = texture;
        }
    }
}

export function getHelmetSpritePosition(
    bodyMetrics: BodyRenderMetrics,
    bodyData: { headOffsetX?: number; headOffsetY?: number },
    helmetTexture: Texture,
    helmetData: { offsetX?: number; offsetY?: number },
): { x: number; y: number } {
    const basePosition = getHeadSpritePosition(
        bodyMetrics,
        bodyData,
        helmetTexture,
    );

    return {
        x: basePosition.x + (helmetData.offsetX || 0),
        y: basePosition.y + (helmetData.offsetY || 0),
    };
}

export function getNameLabelPosition(bodyMetrics: BodyRenderMetrics): {
    x: number;
    y: number;
} {
    return {
        x: bodyMetrics.x + bodyMetrics.width / 2,
        y: bodyMetrics.y + bodyMetrics.height + 2,
    };
}

export function getDebugPositionLabelPosition(bodyMetrics: BodyRenderMetrics): {
    x: number;
    y: number;
} {
    return {
        x: bodyMetrics.x + bodyMetrics.width / 2,
        y: bodyMetrics.y + bodyMetrics.height + 16,
    };
}

export function getDialogLabelPosition(bodyMetrics: BodyRenderMetrics): {
    x: number;
    y: number;
} {
    return {
        x: bodyMetrics.x + bodyMetrics.width / 2,
        y: bodyMetrics.y - 34,
    };
}
