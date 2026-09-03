// Minimal 2D-canvas sprite preview for character creation.
// Replicates the front-facing body+head composition from
// frontend/components/CharacterSpritePreview.tsx without PixiJS.
import type {
    BodiesDB,
    DirectionalGraphicData,
    GraphicData,
    GraphicsDB,
    HeadsDB,
} from "./types/game";
import {
    bodySpritePosition,
    computeSpriteFraming,
    headSpritePosition,
    type SpriteRect,
} from "./lib/spriteFraming";

const FRONT_DIRECTION = "2";
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(file: string | number): Promise<HTMLImageElement> {
    const key = String(file);
    const cached = imageCache.get(key);
    if (cached) return cached;

    const promise = new Promise<HTMLImageElement>((resolvePromise, reject) => {
        const candidates = [
            `/graphics/${file}.png`,
            `/static/graphics/${file}.png`,
        ];
        const image = new Image();
        let index = 0;
        image.onload = () => resolvePromise(image);
        image.onerror = () => {
            index += 1;
            if (index < candidates.length) {
                image.src = candidates[index];
            } else {
                reject(new Error(`No se pudo cargar el grafico ${file}`));
            }
        };
        image.src = candidates[0];
    });

    imageCache.set(key, promise);
    return promise;
}

function resolveGraphicFrame(
    graphicsDB: GraphicsDB,
    graphicId: number,
): GraphicData | null {
    const graphic = graphicsDB[graphicId.toString()];
    if (!graphic) return null;

    if (graphic.numFile && graphic.numFrames <= 1) {
        return graphic;
    }

    const frameId =
        (graphic.numFrames > 1 ? graphic.frames?.["1"] : undefined) ??
        graphic.frames?.[FRONT_DIRECTION] ??
        graphic.frames?.["1"] ??
        Object.values(graphic.frames ?? {})[0];

    if (!frameId) return null;
    return graphicsDB[frameId.toString()] ?? null;
}

export function isRenderableHead(
    headId: number,
    headsDB: HeadsDB,
    graphicsDB: GraphicsDB,
): boolean {
    const headData = headsDB[headId.toString()];
    if (!headData) return false;
    const graphicId = headData[FRONT_DIRECTION as keyof DirectionalGraphicData];
    if (!graphicId) return false;
    return Boolean(resolveGraphicFrame(graphicsDB, graphicId));
}

export async function drawCharacterPreview(
    canvas: HTMLCanvasElement,
    graphicsDB: GraphicsDB,
    bodiesDB: BodiesDB,
    headsDB: HeadsDB,
    bodyId: number,
    headId: number,
): Promise<boolean> {
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bodyData = bodiesDB[bodyId.toString()];
    const bodyGraphicId =
        bodyData?.[FRONT_DIRECTION as keyof DirectionalGraphicData];
    if (!bodyGraphicId) return false;
    const bodyGraphic = resolveGraphicFrame(graphicsDB, bodyGraphicId);
    if (!bodyGraphic) return false;

    // Resolve everything in unscaled sprite space first, then fit the union
    // of body+head to the canvas. Anchoring to a fixed 32px grid (the old
    // approach) pushed tall bodies above the canvas top and cut the head off.
    const bodyPos = bodySpritePosition(bodyGraphic.width, bodyGraphic.height);
    const rects: SpriteRect[] = [
        { ...bodyPos, width: bodyGraphic.width, height: bodyGraphic.height },
    ];

    const headData = headsDB[headId.toString()];
    const headGraphicId =
        headData?.[FRONT_DIRECTION as keyof DirectionalGraphicData];
    const headGraphic = headGraphicId
        ? resolveGraphicFrame(graphicsDB, headGraphicId)
        : null;
    let headPos: { x: number; y: number } | null = null;
    if (headGraphic) {
        headPos = headSpritePosition(
            bodyPos,
            bodyGraphic.width,
            bodyGraphic.height,
            headGraphic.width,
            bodyData?.headOffsetX ?? 0,
            bodyData?.headOffsetY ?? 0,
        );
        rects.push({
            ...headPos,
            width: headGraphic.width,
            height: headGraphic.height,
        });
    }

    const framing = computeSpriteFraming(
        rects,
        canvas.width,
        canvas.height,
        2,
    );
    const draw = (
        graphic: GraphicData,
        image: HTMLImageElement,
        pos: { x: number; y: number },
    ) => {
        ctx.drawImage(
            image,
            graphic.sX,
            graphic.sY,
            graphic.width,
            graphic.height,
            Math.round(framing.offsetX + pos.x * framing.scale),
            Math.round(framing.offsetY + pos.y * framing.scale),
            Math.ceil(graphic.width * framing.scale),
            Math.ceil(graphic.height * framing.scale),
        );
    };

    try {
        const bodyImage = await loadImage(bodyGraphic.numFile);
        draw(bodyGraphic, bodyImage, bodyPos);
    } catch {
        return false;
    }

    if (headGraphic && headPos) {
        try {
            const headImage = await loadImage(headGraphic.numFile);
            draw(headGraphic, headImage, headPos);
        } catch {
            // body alone is fine
        }
    }

    return true;
}

export async function loadCreationDBs(): Promise<{
    graphicsDB: GraphicsDB;
    bodiesDB: BodiesDB;
    headsDB: HeadsDB;
}> {
    const [graphicsDB, bodiesDB, headsDB] = (await Promise.all([
        fetch("/init/graficos.json").then((r) => r.json()),
        fetch("/init/bodies.json").then((r) => r.json()),
        fetch("/init/heads.json").then((r) => r.json()),
    ])) as [GraphicsDB, BodiesDB, HeadsDB];

    return { graphicsDB, bodiesDB, headsDB };
}
