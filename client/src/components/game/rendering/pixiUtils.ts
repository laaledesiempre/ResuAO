import {
    AnimatedSprite,
    Container,
    Rectangle,
    Sprite,
    Text,
    Texture,
} from "pixi.js";

export interface CullEntry {
    displayObject: Sprite | AnimatedSprite | Text;
    bounds: Rectangle;
    kind: "scene" | "roof" | "npc";
    bucketKeys: string[];
}

type CullEngine = {
    activeCullEntries: Set<CullEntry>;
    cullBuckets: Map<string, Set<CullEntry>>;
    cullEntriesByDisplayObject: Map<Sprite | AnimatedSprite | Text, CullEntry>;
    cullingDirty: boolean;
};

export const CULL_BUCKET_SIZE = 256;

export function getTextureDimensions(
    displayObject: Sprite | AnimatedSprite | Text,
): { width: number; height: number } {
    if (
        displayObject instanceof AnimatedSprite &&
        displayObject.textures.length > 0
    ) {
        const firstTexture = displayObject.textures[0] as Texture;

        return {
            width: firstTexture.width,
            height: firstTexture.height,
        };
    }

    return {
        width: displayObject.width,
        height: displayObject.height,
    };
}

export function registerCullEntry(
    engine: CullEngine,
    displayObject: Sprite | AnimatedSprite | Text,
    kind: CullEntry["kind"],
): void {
    unregisterCullEntry(engine, displayObject);

    const { width, height } = getTextureDimensions(displayObject);
    const bounds = new Rectangle(
        displayObject.x,
        displayObject.y,
        width,
        height,
    );
    const minBucketX = Math.floor(bounds.x / CULL_BUCKET_SIZE);
    const maxBucketX = Math.floor(
        (bounds.x + Math.max(bounds.width - 1, 0)) / CULL_BUCKET_SIZE,
    );
    const minBucketY = Math.floor(bounds.y / CULL_BUCKET_SIZE);
    const maxBucketY = Math.floor(
        (bounds.y + Math.max(bounds.height - 1, 0)) / CULL_BUCKET_SIZE,
    );
    const bucketKeys: string[] = [];

    for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
            bucketKeys.push(`${bucketX},${bucketY}`);
        }
    }

    displayObject.cullable = true;
    displayObject.visible = false;
    const entry: CullEntry = {
        displayObject,
        kind,
        bounds,
        bucketKeys,
    };

    engine.cullEntriesByDisplayObject.set(displayObject, entry);

    for (const bucketKey of bucketKeys) {
        const bucketEntries =
            engine.cullBuckets.get(bucketKey) ?? new Set<CullEntry>();
        bucketEntries.add(entry);
        engine.cullBuckets.set(bucketKey, bucketEntries);
    }

    engine.cullingDirty = true;
}

export function unregisterCullEntry(
    engine: CullEngine,
    displayObject: Sprite | AnimatedSprite | Text,
): void {
    const entry = engine.cullEntriesByDisplayObject.get(displayObject);

    if (!entry) {
        return;
    }

    engine.cullEntriesByDisplayObject.delete(displayObject);
    engine.activeCullEntries.delete(entry);

    for (const bucketKey of entry.bucketKeys) {
        const bucketEntries = engine.cullBuckets.get(bucketKey);

        if (!bucketEntries) {
            continue;
        }

        bucketEntries.delete(entry);

        if (bucketEntries.size === 0) {
            engine.cullBuckets.delete(bucketKey);
        }
    }

    engine.cullingDirty = true;
}

export function unregisterContainerCullEntries(
    engine: CullEngine,
    container: Container,
): void {
    for (const child of container.children) {
        const drawableChild = child as unknown;

        if (child instanceof Container) {
            unregisterContainerCullEntries(engine, child);
            continue;
        }

        if (
            drawableChild instanceof Sprite ||
            drawableChild instanceof AnimatedSprite ||
            drawableChild instanceof Text
        ) {
            unregisterCullEntry(engine, drawableChild);
        }
    }
}

const pendingDisplayObjectDestroys: Array<{
    displayObject: {
        destroyed?: boolean;
        destroy: (...args: any[]) => void;
    };
    options?: any;
}> = [];

const queuedDisplayObjectDestroys = new WeakSet<object>();
let destroyQueueFrameId: number | null = null;

function flushPendingDisplayObjectDestroys(): void {
    destroyQueueFrameId = null;

    const getNow =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
            ? () => performance.now()
            : () => Date.now();

    const frameStart = getNow();

    while (pendingDisplayObjectDestroys.length > 0) {
        const nextDestroy = pendingDisplayObjectDestroys.shift();

        if (!nextDestroy) {
            break;
        }

        queuedDisplayObjectDestroys.delete(nextDestroy.displayObject as object);

        if (!nextDestroy.displayObject.destroyed) {
            nextDestroy.displayObject.destroy(nextDestroy.options);
        }

        if (getNow() - frameStart >= 4) {
            break;
        }
    }

    if (
        pendingDisplayObjectDestroys.length > 0 &&
        typeof window !== "undefined"
    ) {
        destroyQueueFrameId = window.requestAnimationFrame(
            flushPendingDisplayObjectDestroys,
        );
    }
}

export function destroyDisplayObjectSafely(
    displayObject: {
        destroyed?: boolean;
        destroy: (...args: any[]) => void;
    },
    options?: any,
): void {
    if (displayObject.destroyed) {
        return;
    }

    if (typeof window === "undefined") {
        displayObject.destroy(options);
        return;
    }

    if (queuedDisplayObjectDestroys.has(displayObject as object)) {
        return;
    }

    queuedDisplayObjectDestroys.add(displayObject as object);
    pendingDisplayObjectDestroys.push({ displayObject, options });

    if (destroyQueueFrameId === null) {
        destroyQueueFrameId = window.requestAnimationFrame(
            flushPendingDisplayObjectDestroys,
        );
    }
}
