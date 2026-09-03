import fs from "node:fs";
import path from "node:path";

type SourceGraphicData = {
    numFrames?: number | string;
    numFile?: number | string;
    sX?: number | string;
    sY?: number | string;
    width?: number | string;
    height?: number | string;
    frames?: Record<string, number | string>;
    speed?: number | string;
    offset?: {
        x?: number | string;
        y?: number | string;
    };
};

type CompactSimpleGraphic = [numFile: number, sX: number, sY: number, width: number, height: number];

type CompactExtendedGraphic = {
    f?: number;
    n?: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    r?: number[];
    s?: number;
    o?: [x: number, y: number];
};

type CompactGraphicsDB = Record<string, CompactSimpleGraphic | CompactExtendedGraphic>;

const DEFAULT_INPUT_PATH = path.resolve(__dirname, "../../../frontend/public/init/graficos.json");
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, "../../../frontend/public/init/graficos_optimized.json");

function resolveCliPath(value: string | undefined, fallback: string): string {
    if (!value?.trim()) {
        return fallback;
    }

    return path.resolve(process.cwd(), value);
}

function formatBytes(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function normalizeFrames(frames: SourceGraphicData["frames"]): number[] {
    if (!frames) {
        return [];
    }

    return Object.entries(frames)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, frameId]) => toFiniteNumber(frameId))
        .filter((frameId): frameId is number => frameId !== undefined);
}

function compactGraphicEntry(
    graphicId: string,
    graphicData: SourceGraphicData,
): CompactSimpleGraphic | CompactExtendedGraphic {
    const numericGraphicId = toFiniteNumber(graphicId);
    const numFrames = toFiniteNumber(graphicData.numFrames);
    const numFile = toFiniteNumber(graphicData.numFile);
    const sX = toFiniteNumber(graphicData.sX);
    const sY = toFiniteNumber(graphicData.sY);
    const width = toFiniteNumber(graphicData.width);
    const height = toFiniteNumber(graphicData.height);
    const speed = toFiniteNumber(graphicData.speed);
    const offsetX = toFiniteNumber(graphicData.offset?.x) ?? 0;
    const offsetY = toFiniteNumber(graphicData.offset?.y) ?? 0;
    const frames = normalizeFrames(graphicData.frames);
    const inferredNumFrames = numFrames ?? frames.length;
    const isDefaultSingleFrameReference =
        inferredNumFrames === 1 &&
        frames.length <= 1 &&
        numericGraphicId !== undefined &&
        (frames.length === 0 || frames[0] === numericGraphicId);

    if (
        inferredNumFrames === 1 &&
        numFile !== undefined &&
        sX !== undefined &&
        sY !== undefined &&
        width !== undefined &&
        height !== undefined &&
        speed === undefined &&
        offsetX === 0 &&
        offsetY === 0 &&
        isDefaultSingleFrameReference
    ) {
        return [numFile, sX, sY, width, height];
    }

    const compactGraphic: CompactExtendedGraphic = {};

    if (inferredNumFrames > 1 || (inferredNumFrames === 1 && !isDefaultSingleFrameReference)) {
        compactGraphic.f = inferredNumFrames;
    }

    if (numFile !== undefined) {
        compactGraphic.n = numFile;
    }

    if (sX !== undefined) {
        compactGraphic.x = sX;
    }

    if (sY !== undefined) {
        compactGraphic.y = sY;
    }

    if (width !== undefined) {
        compactGraphic.w = width;
    }

    if (height !== undefined) {
        compactGraphic.h = height;
    }

    if (!isDefaultSingleFrameReference && graphicData.frames) {
        compactGraphic.r = frames;
    }

    if (speed !== undefined) {
        compactGraphic.s = speed;
    }

    if (offsetX !== 0 || offsetY !== 0) {
        compactGraphic.o = [offsetX, offsetY];
    }

    return compactGraphic;
}

function compactGraphicsDb(graphicsDb: Record<string, SourceGraphicData>): CompactGraphicsDB {
    const compactGraphicsDb: CompactGraphicsDB = {};

    for (const [graphicId, graphicData] of Object.entries(graphicsDb)) {
        compactGraphicsDb[graphicId] = compactGraphicEntry(graphicId, graphicData);
    }

    return compactGraphicsDb;
}

function main(): void {
    const inputPath = resolveCliPath(process.argv[2], DEFAULT_INPUT_PATH);
    const outputPath = resolveCliPath(process.argv[3], DEFAULT_OUTPUT_PATH);
    const sourceRaw = fs.readFileSync(inputPath, "utf8");
    const sourceGraphicsDb = JSON.parse(sourceRaw) as Record<string, SourceGraphicData>;
    const compactGraphics = compactGraphicsDb(sourceGraphicsDb);
    const outputRaw = `${JSON.stringify(compactGraphics)}\n`;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, outputRaw, "utf8");

    const inputSize = Buffer.byteLength(sourceRaw, "utf8");
    const outputSize = Buffer.byteLength(outputRaw, "utf8");
    const savedBytes = inputSize - outputSize;
    const savedPercent = inputSize > 0 ? (savedBytes / inputSize) * 100 : 0;

    console.log(`Compacted graphics dataset to ${outputPath}`);
    console.log(`Input: ${formatBytes(inputSize)}`);
    console.log(`Output: ${formatBytes(outputSize)}`);
    console.log(`Saved: ${formatBytes(savedBytes)} (${savedPercent.toFixed(2)}%)`);
}

main();
