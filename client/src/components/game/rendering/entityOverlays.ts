import { AnimatedSprite, Container, Graphics, Sprite, Text } from "pixi.js";
import type { SpellData } from "../../../types/game";
import { TILE_SIZE } from "../../../lib/viewport";
import type { Engine } from "../engine/Engine";
import { createSpellProjectileVisual } from "./effectsRenderer";
import {
    getDialogLabelPosition,
    type BodyRenderMetrics,
} from "./characterLayout";
import {
    getEntityFXRowContainer,
    syncDisplayObjectToEntityFXRow,
} from "./rowLayerContainers";

type ActiveDialogMessage = {
    text: string;
    color?: string;
    timeoutId: number;
    variant: "bubble" | "floatingCombat";
    startedAt: number;
    durationMs: number;
};

type ActiveCastBar = {
    startedAt: number;
    durationMs: number;
};

type CreateEntityOverlaysOptions = {
    getActiveDialogMessages: () => Map<number, ActiveDialogMessage>;
    getActiveCastBars: () => Map<number, ActiveCastBar>;
    getEngine: () => Engine | null;
    destroyDisplayObjectSafely: (
        displayObject: any,
        options?: { children?: boolean },
    ) => void;
    canUseEngineContainer: (
        engine: Engine,
        container: Container | null | undefined,
    ) => boolean;
    loadTextures: (engine: Engine, graphicIds: string[]) => Promise<void>;
    createCastBar: () => Container;
    createDialogBubble: (text: string, color?: string) => Container;
    createFloatingCombatText: (text: string, color?: string) => Text;
    isCombatDialogMessage: (text: string, color?: string) => boolean;
    getDialogMessageDuration: (text: string) => number;
    getEntityContainer: (engine: Engine, entityId: number) => Container | null;
    getPersistentEntityFxIds: () => Set<number>;
    defaultEntityFxDurationMs: number;
    entityFxAlpha: number;
    projectileBaseAngleRadians: number;
    projectileMinDurationMs: number;
    projectileMaxDurationMs: number;
    projectilePixelsPerMs: number;
};

export function createEntityOverlays(options: CreateEntityOverlaysOptions) {
    const removeDialogBubbleFromContainer = (
        container: Container | null | undefined,
    ) => {
        if (!container) {
            return;
        }

        const dialogBubble = container.children.find(
            (child) => (child as any).isDialogBubble,
        );

        if (!dialogBubble) {
            return;
        }

        container.removeChild(dialogBubble);
        options.destroyDisplayObjectSafely(dialogBubble as any, {
            children: true,
        });
    };

    const removeDialogBubbleFromOverlay = (
        engine: Engine,
        entityId: number,
    ) => {
        const overlay = engine.dialogOverlayContainer;
        if (!overlay) {
            return;
        }

        const dialogBubble = overlay.children.find(
            (child) => (child as any).dialogEntityId === entityId,
        );

        if (!dialogBubble) {
            return;
        }

        overlay.removeChild(dialogBubble);
        options.destroyDisplayObjectSafely(dialogBubble as any, {
            children: true,
        });
    };

    const removeCastBarFromOverlay = (engine: Engine, entityId: number) => {
        const overlay = engine.dialogOverlayContainer;
        if (!overlay) {
            return;
        }

        const castBar = overlay.children.find(
            (child) => (child as any).castBarEntityId === entityId,
        );

        if (!castBar) {
            return;
        }

        overlay.removeChild(castBar);
        options.destroyDisplayObjectSafely(castBar as any, { children: true });
    };

    const positionCastBar = (
        engine: Engine,
        entityId: number,
        castBar: Container,
    ): boolean => {
        const container = options.getEntityContainer(engine, entityId);

        if (!container) {
            return false;
        }

        const bodySprite = ((container as any).bodySprite ??
            container.children.find((child) =>
                Boolean((child as any).renderMetrics),
            )) as Container["children"][number] | undefined;
        const bodyMetrics = (bodySprite as any)?.renderMetrics as
            | BodyRenderMetrics
            | undefined;

        if (!bodyMetrics) {
            return false;
        }

        const anchor = getDialogLabelPosition(bodyMetrics);
        castBar.x = Math.round(container.x + anchor.x);
        castBar.y = Math.round(container.y + anchor.y + 20);
        castBar.zIndex = Number(container.zIndex ?? 0) + 0.95;
        return true;
    };

    const syncCastBar = (engine: Engine, entityId: number) => {
        const overlay = engine.dialogOverlayContainer;
        if (!overlay) {
            return;
        }

        removeCastBarFromOverlay(engine, entityId);

        const castBarState = options.getActiveCastBars().get(entityId);
        if (!castBarState) {
            return;
        }

        const castBar = options.createCastBar();
        if (!positionCastBar(engine, entityId, castBar)) {
            castBar.destroy({ children: true });
            return;
        }

        const elapsed = Math.max(0, performance.now() - castBarState.startedAt);
        const progress = Math.max(0, 1 - elapsed / castBarState.durationMs);
        const fill = (castBar as any).castBarFill as Graphics | undefined;
        if (fill) {
            fill.scale.x = progress;
        }

        (castBar as any).castBarEntityId = entityId;
        overlay.addChild(castBar);
    };

    const clearEntityFX = (
        engine: Engine,
        entityId: number,
        fxOptions?: { clearStoredGraphic?: boolean },
    ) => {
        const activeEffect = engine.entityEffects.get(entityId);
        if (activeEffect) {
            if (activeEffect instanceof AnimatedSprite) {
                engine.animatedSpriteFrameCounters.delete(activeEffect);
            }

            if (activeEffect.parent) {
                activeEffect.parent.removeChild(activeEffect);
            }

            options.destroyDisplayObjectSafely(activeEffect as any);
            engine.entityEffects.delete(entityId);
        }

        const timeoutId = engine.entityEffectTimeouts.get(entityId);
        if (typeof timeoutId === "number") {
            window.clearTimeout(timeoutId);
            engine.entityEffectTimeouts.delete(entityId);
        }

        if (fxOptions?.clearStoredGraphic !== false) {
            engine.entityEffectGraphicIds.delete(entityId);
            engine.entityEffectStartedAt.delete(entityId);
            engine.entityEffectExpiresAt.delete(entityId);
        }
    };

    const positionEntityFX = (engine: Engine, entityId: number): boolean => {
        const overlay = engine.entityFXOverlayContainer;
        const container = options.getEntityContainer(engine, entityId);
        const effectSprite = engine.entityEffects.get(entityId);

        if (!overlay || !container || !effectSprite) {
            return false;
        }

        const offsetX = Number((effectSprite as any).entityFXOffsetX ?? 0);
        const offsetY = Number((effectSprite as any).entityFXOffsetY ?? 0);
        effectSprite.x = Math.round(container.x + offsetX);
        effectSprite.y = Math.round(container.y + offsetY);

        if (
            !getEntityFXRowContainer(
                engine,
                Math.floor(effectSprite.y / TILE_SIZE) + 1,
            )
        ) {
            return false;
        }

        syncDisplayObjectToEntityFXRow(engine, effectSprite.y, effectSprite);

        return true;
    };

    const renderEntityFX = async (
        engine: Engine,
        entityId: number,
        graphicId: number,
    ) => {
        if (graphicId <= 0) {
            clearEntityFX(engine, entityId);
            return;
        }

        const storedGraphicId = engine.entityEffectGraphicIds.get(entityId);
        const storedStartedAt = engine.entityEffectStartedAt.get(entityId);
        const storedExpiresAt = engine.entityEffectExpiresAt.get(entityId);

        const container = options.getEntityContainer(engine, entityId);
        if (
            !options.canUseEngineContainer(engine, container) ||
            !options.canUseEngineContainer(
                engine,
                engine.entityFXOverlayContainer,
            ) ||
            !engine.graphicsDB ||
            !engine.fxsDB
        ) {
            return;
        }

        const activeEffect = engine.entityEffects.get(entityId);
        if (
            activeEffect &&
            !(activeEffect as any).destroyed &&
            storedGraphicId === graphicId &&
            activeEffect.parent
        ) {
            positionEntityFX(engine, entityId);
            return;
        }

        engine.entityEffectGraphicIds.set(entityId, graphicId);

        clearEntityFX(engine, entityId, { clearStoredGraphic: false });

        const effectData = engine.fxsDB[graphicId.toString()];
        if (!effectData) {
            return;
        }

        const graphicKey = effectData.grh.toString();
        if (
            !engine.textureCache.has(graphicKey) &&
            !engine.animatedTextureCache.has(graphicKey)
        ) {
            await options.loadTextures(engine, [graphicKey]);
            const currentContainer = options.getEntityContainer(
                engine,
                entityId,
            );
            if (
                !options.canUseEngineContainer(engine, currentContainer) ||
                !options.canUseEngineContainer(
                    engine,
                    engine.entityFXOverlayContainer,
                ) ||
                currentContainer !== container
            ) {
                return;
            }
        }

        const graphicData = engine.graphicsDB[graphicKey];
        if (!graphicData) {
            return;
        }

        const effectFrameSpeed = graphicData.speed || 500;
        const effectTimeoutDuration = Math.max(
            options.defaultEntityFxDurationMs,
            effectFrameSpeed * Math.max(graphicData.numFrames, 1),
        );
        const now = Date.now();
        const isPersistentEffect = options
            .getPersistentEntityFxIds()
            .has(graphicId);
        const startedAt =
            storedGraphicId === graphicId && typeof storedStartedAt === "number"
                ? storedStartedAt
                : now;
        const expiresAt =
            storedGraphicId === graphicId && typeof storedExpiresAt === "number"
                ? storedExpiresAt
                : now + effectTimeoutDuration;
        const durationMs = Math.max(0, expiresAt - now);

        if (durationMs <= 0) {
            clearEntityFX(engine, entityId);
            return;
        }

        let effectSprite: Sprite | AnimatedSprite | null = null;

        if (graphicData.numFrames > 1) {
            const frameTextures = engine.animatedTextureCache.get(graphicKey);
            if (!frameTextures || frameTextures.length === 0) {
                return;
            }

            const animatedSprite = new AnimatedSprite(frameTextures);
            animatedSprite.stop();
            animatedSprite.alpha = options.entityFxAlpha;
            animatedSprite.visible = true;
            const elapsedMs = Math.max(0, now - startedAt);
            const frameCounter = isPersistentEffect
                ? 0.1 + ((elapsedMs / effectFrameSpeed) % graphicData.numFrames)
                : Math.min(
                      graphicData.numFrames,
                      0.1 + elapsedMs / effectFrameSpeed,
                  );
            const frameNumber = Math.ceil(frameCounter);
            const frameIndex = Math.max(
                0,
                Math.min(frameNumber - 1, frameTextures.length - 1),
            );

            animatedSprite.currentFrame = frameIndex;
            (animatedSprite as any).frameCounter = frameCounter;
            engine.animatedSpriteFrameCounters.set(animatedSprite, {
                graphicId: graphicKey,
                graphicData,
                loop: isPersistentEffect,
            });
            effectSprite = animatedSprite;
        } else {
            const texture = engine.textureCache.get(graphicKey);
            if (!texture) {
                return;
            }

            effectSprite = new Sprite(texture);
        }

        effectSprite.alpha = options.entityFxAlpha;
        (effectSprite as any).entityFXOffsetX = effectData.offsetX;
        (effectSprite as any).entityFXOffsetY = effectData.offsetY;
        (effectSprite as any).isEntityFX = true;
        (effectSprite as any).entityId = entityId;
        engine.entityEffects.set(entityId, effectSprite);
        engine.entityEffectStartedAt.set(entityId, startedAt);
        positionEntityFX(engine, entityId);

        if (isPersistentEffect) {
            engine.entityEffectExpiresAt.delete(entityId);
            return;
        }

        engine.entityEffectExpiresAt.set(entityId, expiresAt);

        const timeoutId = window.setTimeout(() => {
            const activeGraphicId = engine.entityEffectGraphicIds.get(entityId);
            if (activeGraphicId !== graphicId) {
                return;
            }

            clearEntityFX(engine, entityId);
        }, durationMs);

        engine.entityEffectTimeouts.set(entityId, timeoutId);
    };

    const syncEntityFX = async (engine: Engine, entityId: number) => {
        const graphicId = engine.entityEffectGraphicIds.get(entityId);
        if (!graphicId) {
            return;
        }

        await renderEntityFX(engine, entityId, graphicId);
    };

    const renderProjectileVisual = async (
        engine: Engine,
        startPos: { x: number; y: number },
        endPos: { x: number; y: number },
        graphicId: number,
    ) => {
        const overlay = engine.entityFXOverlayContainer;
        if (
            graphicId <= 0 ||
            !overlay ||
            !engine.graphicsDB ||
            engine.isDestroyed
        ) {
            return;
        }

        const graphicKey = graphicId.toString();
        if (
            !engine.textureCache.has(graphicKey) &&
            !engine.animatedTextureCache.has(graphicKey)
        ) {
            await options.loadTextures(engine, [graphicKey]);
            if (engine.isDestroyed || !engine.entityFXOverlayContainer) {
                return;
            }
        }

        const graphicData = engine.graphicsDB[graphicKey];
        if (!graphicData) {
            return;
        }

        let projectileSprite: Sprite | AnimatedSprite | null = null;
        if (graphicData.numFrames > 1) {
            const frameTextures = engine.animatedTextureCache.get(graphicKey);
            if (!frameTextures || frameTextures.length === 0) {
                return;
            }

            const animatedSprite = new AnimatedSprite(frameTextures);
            animatedSprite.stop();
            animatedSprite.currentFrame = 0;
            engine.animatedSpriteFrameCounters.set(animatedSprite, {
                graphicId: graphicKey,
                graphicData,
                loop: true,
            });
            projectileSprite = animatedSprite;
        } else {
            const texture = engine.textureCache.get(graphicKey);
            if (!texture) {
                return;
            }

            projectileSprite = new Sprite(texture);
        }

        const startWorldX = (startPos.x - 1) * TILE_SIZE + TILE_SIZE / 2;
        const startWorldY = (startPos.y - 1) * TILE_SIZE + TILE_SIZE / 2;
        const endWorldX = (endPos.x - 1) * TILE_SIZE + TILE_SIZE / 2;
        const endWorldY = (endPos.y - 1) * TILE_SIZE + TILE_SIZE / 2;
        const distancePixels = Math.hypot(
            endWorldX - startWorldX,
            endWorldY - startWorldY,
        );
        const durationMs = Math.max(
            options.projectileMinDurationMs,
            Math.min(
                options.projectileMaxDurationMs,
                distancePixels / options.projectilePixelsPerMs,
            ),
        );
        const rotation =
            Math.atan2(endWorldY - startWorldY, endWorldX - startWorldX) -
            options.projectileBaseAngleRadians;

        projectileSprite.anchor.set(0.5);
        projectileSprite.rotation = rotation;
        projectileSprite.x = Math.round(startWorldX);
        projectileSprite.y = Math.round(startWorldY);
        const targetContainer = getEntityFXRowContainer(
            engine,
            Math.floor(startWorldY / TILE_SIZE) + 1,
        );

        if (!targetContainer) {
            options.destroyDisplayObjectSafely(projectileSprite as any);
            return;
        }

        targetContainer.addChild(projectileSprite);

        const projectileId = engine.nextProjectileVisualId++;
        engine.projectileVisuals.set(projectileId, {
            id: projectileId,
            sprite: projectileSprite,
            startedAt: performance.now(),
            durationMs,
            startWorldX,
            startWorldY,
            endWorldX,
            endWorldY,
        });
    };

    const renderSpellProjectileVisual = (
        engine: Engine,
        startPos: { x: number; y: number },
        endPos: { x: number; y: number },
        spellData: SpellData | null | undefined,
    ) => {
        const overlay = engine.entityFXOverlayContainer;
        if (!overlay || engine.isDestroyed) {
            return;
        }

        const startWorldX = (startPos.x - 1) * TILE_SIZE + TILE_SIZE / 2;
        const startWorldY = (startPos.y - 1) * TILE_SIZE + TILE_SIZE / 2;
        const endWorldX = (endPos.x - 1) * TILE_SIZE + TILE_SIZE / 2;
        const endWorldY = (endPos.y - 1) * TILE_SIZE + TILE_SIZE / 2;
        const distancePixels = Math.hypot(
            endWorldX - startWorldX,
            endWorldY - startWorldY,
        );

        if (distancePixels < 8) {
            return;
        }

        const durationMs = Math.max(
            options.projectileMinDurationMs,
            Math.min(
                options.projectileMaxDurationMs,
                distancePixels / options.projectilePixelsPerMs,
            ),
        );
        const rotation = Math.atan2(
            endWorldY - startWorldY,
            endWorldX - startWorldX,
        );
        const { container, updateVisual, cleanupVisual } =
            createSpellProjectileVisual(
                (worldY) =>
                    getEntityFXRowContainer(
                        engine,
                        Math.floor(worldY / TILE_SIZE) + 1,
                    ) ?? overlay,
                rotation,
                spellData,
            );

        container.x = Math.round(startWorldX);
        container.y = Math.round(startWorldY);
        const targetContainer = getEntityFXRowContainer(
            engine,
            Math.floor(startWorldY / TILE_SIZE) + 1,
        );

        if (!targetContainer) {
            cleanupVisual();
            options.destroyDisplayObjectSafely(container as any, {
                children: true,
            });
            return;
        }

        targetContainer.addChild(container);

        const projectileId = engine.nextProjectileVisualId++;
        engine.projectileVisuals.set(projectileId, {
            id: projectileId,
            sprite: container,
            startedAt: performance.now(),
            durationMs,
            startWorldX,
            startWorldY,
            endWorldX,
            endWorldY,
            updateVisual,
            cleanupVisual,
        });
    };

    const positionDialogBubble = (
        engine: Engine,
        entityId: number,
        bubble: Container | Text,
        dialog?: ActiveDialogMessage,
    ): boolean => {
        const container = options.getEntityContainer(engine, entityId);

        if (!container) {
            return false;
        }

        const bodySprite = ((container as any).bodySprite ??
            container.children.find(
                (child) =>
                    (child as any).isPlayerBody || (child as any).isRemoteBody,
            )) as AnimatedSprite | undefined;
        const bodyMetrics = bodySprite
            ? ((bodySprite as any).renderMetrics as BodyRenderMetrics)
            : (((container as any).bodyMetrics as
                  | BodyRenderMetrics
                  | undefined) ?? undefined);

        if (!bodyMetrics) {
            return false;
        }

        const bubblePosition = getDialogLabelPosition(bodyMetrics);
        let offsetY = 0;

        if (dialog?.variant === "floatingCombat") {
            const elapsed = Math.max(0, performance.now() - dialog.startedAt);
            const progress = Math.min(
                1,
                elapsed / Math.max(1, dialog.durationMs),
            );
            const easedProgress = 1 - (1 - progress) * (1 - progress);
            offsetY = 25 - easedProgress * 10;
            bubble.alpha = 1 - easedProgress * 0.25;
            bubble.scale.set(1 + (1 - progress) * 0.03);
        } else {
            bubble.alpha = 1;
            bubble.scale.set(1);
        }

        bubble.x = Math.round(container.x + bubblePosition.x);
        bubble.y = Math.round(container.y + bubblePosition.y + offsetY);
        return true;
    };

    const syncDialogBubble = (engine: Engine, entityId: number) => {
        const dialog = options.getActiveDialogMessages().get(entityId);
        const overlay = engine.dialogOverlayContainer;
        if (!overlay) {
            return;
        }

        removeDialogBubbleFromOverlay(engine, entityId);

        if (!dialog) {
            return;
        }

        const bubble =
            dialog.variant === "floatingCombat"
                ? options.createFloatingCombatText(dialog.text, dialog.color)
                : options.createDialogBubble(dialog.text, dialog.color);

        if (!positionDialogBubble(engine, entityId, bubble, dialog)) {
            bubble.destroy({ children: true });
            return;
        }

        (bubble as any).dialogEntityId = entityId;
        overlay.addChild(bubble);
    };

    const showDialogBubble = (
        entityId: number,
        text: string,
        color?: string,
    ) => {
        const engine = options.getEngine();
        const activeDialogMessages = options.getActiveDialogMessages();
        const previousDialog = activeDialogMessages.get(entityId);

        if (text.trim().length === 0) {
            if (previousDialog) {
                window.clearTimeout(previousDialog.timeoutId);
                activeDialogMessages.delete(entityId);
            }

            if (engine) {
                syncDialogBubble(engine, entityId);
            }

            return;
        }

        if (previousDialog) {
            window.clearTimeout(previousDialog.timeoutId);
        }

        const startedAt = performance.now();
        const variant = options.isCombatDialogMessage(text, color)
            ? "floatingCombat"
            : "bubble";
        const durationMs =
            variant === "floatingCombat"
                ? 500
                : options.getDialogMessageDuration(text);
        const timeoutId = window.setTimeout(() => {
            activeDialogMessages.delete(entityId);

            if (engine) {
                syncDialogBubble(engine, entityId);
            }
        }, durationMs);

        activeDialogMessages.set(entityId, {
            text,
            color,
            timeoutId,
            variant,
            startedAt,
            durationMs,
        });

        if (engine) {
            syncDialogBubble(engine, entityId);
        }
    };

    const updateActiveDialogBubblePositions = (engine: Engine) => {
        const overlay = engine.dialogOverlayContainer;
        if (!overlay) {
            return;
        }

        for (const bubble of overlay.children) {
            const entityId = (bubble as any).dialogEntityId;
            if (typeof entityId !== "number") {
                continue;
            }

            positionDialogBubble(
                engine,
                entityId,
                bubble as Container,
                options.getActiveDialogMessages().get(entityId),
            );
        }
    };

    const updateActiveCastBarPositions = (engine: Engine) => {
        const overlay = engine.dialogOverlayContainer;
        if (!overlay) {
            return;
        }

        for (const [entityId, castBarState] of options.getActiveCastBars()) {
            const castBar = overlay.children.find(
                (child) => (child as any).castBarEntityId === entityId,
            ) as Container | undefined;

            if (!castBar) {
                syncCastBar(engine, entityId);
                continue;
            }

            if (!positionCastBar(engine, entityId, castBar)) {
                removeCastBarFromOverlay(engine, entityId);
                continue;
            }

            const elapsed = Math.max(
                0,
                performance.now() - castBarState.startedAt,
            );
            const progress = Math.max(0, 1 - elapsed / castBarState.durationMs);
            const fill = (castBar as any).castBarFill as Graphics | undefined;
            if (fill) {
                fill.scale.x = progress;
            }
        }
    };

    const updateEntityFXPositions = (engine: Engine) => {
        for (const entityId of engine.entityEffects.keys()) {
            positionEntityFX(engine, entityId);
        }
    };

    const clearAllDialogMessages = () => {
        for (const dialog of options.getActiveDialogMessages().values()) {
            window.clearTimeout(dialog.timeoutId);
        }

        options.getActiveDialogMessages().clear();
    };

    const clearAllCastBars = () => {
        options.getActiveCastBars().clear();
    };

    return {
        clearAllCastBars,
        clearAllDialogMessages,
        clearEntityFX,
        removeCastBarFromOverlay,
        removeDialogBubbleFromContainer,
        removeDialogBubbleFromOverlay,
        renderEntityFX,
        renderProjectileVisual,
        renderSpellProjectileVisual,
        showDialogBubble,
        syncCastBar,
        syncDialogBubble,
        syncEntityFX,
        updateActiveCastBarPositions,
        updateActiveDialogBubblePositions,
        updateEntityFXPositions,
    };
}
