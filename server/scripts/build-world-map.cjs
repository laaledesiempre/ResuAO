const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const MAPS_SOURCE_DIR = path.join(ROOT_DIR, "mapas_source");
const IMAGES_DIR = path.join(ROOT_DIR, "imgs_maps");
const OUTPUT_DIR = path.join(ROOT_DIR, "world_map");
const COMPONENTS_DIR = path.join(OUTPUT_DIR, "components");
const FRONTEND_DATA_DIR = path.resolve(ROOT_DIR, "../frontend/data");
const FRONTEND_WORLD_MAP_DIR = path.resolve(ROOT_DIR, "../frontend/public/static/imgs");
const FRONTEND_WORLD_MAP_COMPONENT_ID = 1;
const EDGE_BAND = 12;
const DEFAULT_PNG_SCALE = 100;
const IMAGE_DATA_URI_CACHE = new Map();
const POSITION_OVERRIDES = {};

const SIDE_CONFIG = {
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    west: { dx: -1, dy: 0 },
    east: { dx: 1, dy: 0 },
};

const OPPOSITE_SIDE = {
    north: "south",
    south: "north",
    west: "east",
    east: "west",
};

function isMapImage(fileName) {
    return /^\d+\.png$/i.test(fileName);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function parseCoordinateKey(key) {
    const [rawX, rawY] = key.split(",");
    const x = Number.parseInt(rawX ?? "", 10);
    const y = Number.parseInt(rawY ?? "", 10);

    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1) {
        return null;
    }

    return { x, y };
}

function normalizeTileExitDestinations(tileExit) {
    let rawDestinations = [];

    if (Array.isArray(tileExit)) {
        rawDestinations = tileExit;
    } else if (tileExit && typeof tileExit === "object" && Array.isArray(tileExit.destinations)) {
        rawDestinations = tileExit.destinations;
    } else if (tileExit && typeof tileExit === "object") {
        rawDestinations = [tileExit];
    }

    return rawDestinations
        .map((destination) => {
            const map = toNumber(destination?.map);
            const x = toNumber(destination?.x);
            const y = toNumber(destination?.y);

            if (!Number.isFinite(map) || !Number.isFinite(x) || !Number.isFinite(y)) {
                return null;
            }

            return { map, x, y };
        })
        .filter(Boolean);
}

function getMapSourceDirectory(mapId) {
    return path.join(MAPS_SOURCE_DIR, `mapa_${mapId}`);
}

function mapSourceExists(mapId) {
    const mapDir = getMapSourceDirectory(mapId);
    return fs.existsSync(path.join(mapDir, "terrain.json")) && fs.existsSync(path.join(mapDir, "specials.json"));
}

function readPngSize(filePath) {
    const fd = fs.openSync(filePath, "r");

    try {
        const buffer = Buffer.alloc(24);
        fs.readSync(fd, buffer, 0, 24, 0);

        if (buffer.toString("ascii", 1, 4) !== "PNG") {
            throw new Error(`Archivo invalido: ${filePath}`);
        }

        return {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20),
        };
    } finally {
        fs.closeSync(fd);
    }
}

function detectSide(x, y, tileExit) {
    if (y <= EDGE_BAND && tileExit.y >= 101 - EDGE_BAND) {
        return "north";
    }

    if (y >= 101 - EDGE_BAND && tileExit.y <= EDGE_BAND) {
        return "south";
    }

    if (x <= EDGE_BAND && tileExit.x >= 101 - EDGE_BAND) {
        return "west";
    }

    if (x >= 101 - EDGE_BAND && tileExit.x <= EDGE_BAND) {
        return "east";
    }

    return null;
}

function summarizeTransitions(transitions) {
    const counts = new Map();

    for (const transition of transitions) {
        const key = String(transition.targetMap);
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    const ordered = [...counts.entries()]
        .map(([targetMap, count]) => ({ targetMap: Number(targetMap), count }))
        .sort((a, b) => b.count - a.count || a.targetMap - b.targetMap);

    return {
        winner: ordered[0] || null,
        options: ordered,
    };
}

function extractMapLinks(mapId) {
    const mapDir = getMapSourceDirectory(mapId);
    const terrain = readJson(path.join(mapDir, "terrain.json"));
    const specials = readJson(path.join(mapDir, "specials.json"));
    const width = Math.max(1, toNumber(terrain?.width) ?? 100);
    const height = Math.max(1, toNumber(terrain?.height) ?? 100);
    const transitionsBySide = {
        north: [],
        south: [],
        west: [],
        east: [],
    };

    for (const [coordinateKey, tileExit] of Object.entries(specials?.exits ?? {})) {
        const coordinates = parseCoordinateKey(coordinateKey);
        if (!coordinates) {
            continue;
        }

        const destinations = normalizeTileExitDestinations(tileExit);

        for (const destination of destinations) {
            if (!destination.map || destination.map === mapId) {
                continue;
            }

            const side = detectSide(coordinates.x, coordinates.y, destination);

            if (!side) {
                continue;
            }

            transitionsBySide[side].push({
                sourceX: coordinates.x,
                sourceY: coordinates.y,
                targetMap: destination.map,
                targetX: destination.x,
                targetY: destination.y,
                trigger: specials?.triggers?.[coordinateKey] || null,
            });
        }
    }

    const neighbors = {};
    const diagnostics = {};

    for (const side of Object.keys(transitionsBySide)) {
        const summary = summarizeTransitions(transitionsBySide[side]);

        diagnostics[side] = {
            count: transitionsBySide[side].length,
            candidates: summary.options,
        };

        if (summary.winner) {
            neighbors[side] = summary.winner.targetMap;
        }
    }

    return { neighbors, diagnostics };
}

function buildGraph(mapIds) {
    const graph = new Map();

    for (const mapId of mapIds) {
        graph.set(mapId, {
            id: mapId,
            neighbors: {},
            diagnostics: {},
        });
    }

    for (const mapId of mapIds) {
        const { diagnostics } = extractMapLinks(mapId);
        const node = graph.get(mapId);
        node.diagnostics = diagnostics;
    }

    resolveReciprocalNeighbors(graph);

    return graph;
}

function resolveReciprocalNeighbors(graph) {
    for (const [mapId, node] of graph.entries()) {
        const neighbors = {};

        for (const side of Object.keys(SIDE_CONFIG)) {
            const candidates = node.diagnostics[side]?.candidates || [];
            const reciprocal = candidates.find(({ targetMap }) => {
                const targetNode = graph.get(targetMap);

                if (!targetNode) {
                    return false;
                }

                const oppositeSide = OPPOSITE_SIDE[side];
                const oppositeCandidates = targetNode.diagnostics[oppositeSide]?.candidates || [];
                return oppositeCandidates.some((candidate) => candidate.targetMap === mapId);
            });

            if (reciprocal) {
                neighbors[side] = reciprocal.targetMap;
            }
        }

        node.neighbors = neighbors;
    }
}

function placeComponent(startId, graph, placed, componentId, conflicts) {
    const queue = [startId];
    const componentMaps = [];
    placed.set(startId, { x: 0, y: 0, componentId, parentId: null });

    while (queue.length > 0) {
        const currentId = queue.shift();
        const currentPos = placed.get(currentId);
        const node = graph.get(currentId);
        componentMaps.push(currentId);

        for (const [side, targetId] of Object.entries(node.neighbors)) {
            if (!graph.has(targetId)) {
                continue;
            }

            const delta = SIDE_CONFIG[side];
            const nextPos = {
                x: currentPos.x + delta.dx,
                y: currentPos.y + delta.dy,
                componentId,
                parentId: currentId,
            };

            const existing = placed.get(targetId);

            if (!existing) {
                placed.set(targetId, nextPos);
                queue.push(targetId);
                continue;
            }

            if (existing.x !== nextPos.x || existing.y !== nextPos.y) {
                conflicts.push({
                    sourceMap: currentId,
                    targetMap: targetId,
                    side,
                    expected: { x: nextPos.x, y: nextPos.y },
                    found: { x: existing.x, y: existing.y },
                });
            }
        }
    }

    return componentMaps;
}

function layoutWorld(graph) {
    const placed = new Map();
    const conflicts = [];
    const components = [];
    let componentId = 0;

    for (const mapId of [...graph.keys()].sort((a, b) => a - b)) {
        if (placed.has(mapId)) {
            continue;
        }

        componentId += 1;
        const mapIds = placeComponent(mapId, graph, placed, componentId, conflicts);
        const positions = mapIds.map((id) => ({ id, ...placed.get(id) }));
        const xs = positions.map((item) => item.x);
        const ys = positions.map((item) => item.y);

        components.push({
            id: componentId,
            maps: mapIds.sort((a, b) => a - b),
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
            width: Math.max(...xs) - Math.min(...xs) + 1,
            height: Math.max(...ys) - Math.min(...ys) + 1,
        });
    }

    const gap = 0;
    const orderedComponents = [...components].sort((a, b) => b.width * b.height - a.width * a.height || a.id - b.id);
    const maxRowWidth = Math.max(8, Math.ceil(Math.sqrt(graph.size)) + 2);
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    const componentOffsets = new Map();

    for (const component of orderedComponents) {
        if (cursorX > 0 && cursorX + component.width > maxRowWidth) {
            cursorX = 0;
            cursorY += rowHeight + gap;
            rowHeight = 0;
        }

        componentOffsets.set(component.id, {
            offsetX: cursorX - component.minX,
            offsetY: cursorY - component.minY,
        });

        cursorX += component.width + gap;
        rowHeight = Math.max(rowHeight, component.height);
    }

    const finalPositions = [];

    for (const [mapId, position] of placed.entries()) {
        const offset = componentOffsets.get(position.componentId);

        finalPositions.push({
            id: mapId,
            gridX: position.x + offset.offsetX,
            gridY: position.y + offset.offsetY,
            componentId: position.componentId,
            parentId: position.parentId,
            placementScore: Object.values(graph.get(mapId).diagnostics).reduce((total, side) => total + side.count, 0),
        });
    }

    resolveOverlaps(finalPositions);
    applyPositionOverrides(finalPositions);
    finalPositions.sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX || a.id - b.id);

    return { components, positions: finalPositions, conflicts };
}

function resolveOverlaps(positions) {
    const positionById = new Map(positions.map((position) => [position.id, position]));
    const childrenById = new Map();

    for (const position of positions) {
        if (position.parentId == null) {
            continue;
        }

        if (!childrenById.has(position.parentId)) {
            childrenById.set(position.parentId, []);
        }

        childrenById.get(position.parentId).push(position.id);
    }

    const occupied = new Map();

    for (const position of positions) {
        const key = `${position.componentId}:${position.gridX},${position.gridY}`;

        if (!occupied.has(key)) {
            occupied.set(key, []);
        }

        occupied.get(key).push(position.id);
    }

    const movedRoots = new Set();
    const annexCursorByComponent = new Map();
    const collidingIds = new Set();

    for (const ids of occupied.values()) {
        if (ids.length <= 1) {
            continue;
        }

        for (const id of ids) {
            collidingIds.add(id);
        }
    }

    for (const ids of occupied.values()) {
        if (ids.length <= 1) {
            continue;
        }

        const primaryId = [...ids].sort(
            (a, b) => (positionById.get(b)?.placementScore || 0) - (positionById.get(a)?.placementScore || 0) || a - b,
        )[0];

        for (const candidateId of ids.filter((id) => id !== primaryId)) {
            const rootId = candidateId;
            const rootPosition = positionById.get(rootId);

            if (rootPosition?.parentId != null && collidingIds.has(rootPosition.parentId)) {
                continue;
            }

            if (rootId === primaryId || movedRoots.has(rootId)) {
                continue;
            }

            const subtreeIds = collectSubtreeIds(rootId, childrenById);
            const subtreePositions = subtreeIds.map((id) => positionById.get(id)).filter(Boolean);

            if (subtreePositions.length === 0) {
                continue;
            }

            const componentId = subtreePositions[0].componentId;
            const componentPositions = positions.filter((position) => position.componentId === componentId);
            const componentMaxX = Math.max(...componentPositions.map((position) => position.gridX));
            const componentMinY = Math.min(...componentPositions.map((position) => position.gridY));
            const componentMaxY = Math.max(...componentPositions.map((position) => position.gridY));
            const subtreeMinX = Math.min(...subtreePositions.map((position) => position.gridX));
            const subtreeMinY = Math.min(...subtreePositions.map((position) => position.gridY));
            const subtreeMaxY = Math.max(...subtreePositions.map((position) => position.gridY));
            const subtreeHeight = subtreeMaxY - subtreeMinY + 1;
            const cursor = annexCursorByComponent.get(componentId) || { x: componentMaxX + 1, y: componentMinY };
            const deltaX = cursor.x - subtreeMinX;
            const deltaY = cursor.y - subtreeMinY;

            for (const position of subtreePositions) {
                position.gridX += deltaX;
                position.gridY += deltaY;
            }

            annexCursorByComponent.set(componentId, {
                x: cursor.x,
                y: Math.max(cursor.y + subtreeHeight, componentMaxY + 1),
            });

            for (const subtreeId of subtreeIds) {
                movedRoots.add(subtreeId);
            }
        }
    }
}

function collectSubtreeIds(rootId, childrenById) {
    const result = [];
    const queue = [rootId];

    while (queue.length > 0) {
        const currentId = queue.shift();
        result.push(currentId);

        for (const childId of childrenById.get(currentId) || []) {
            queue.push(childId);
        }
    }

    return result;
}

function applyPositionOverrides(positions) {
    for (const position of positions) {
        const override = POSITION_OVERRIDES[position.id];

        if (!override) {
            continue;
        }

        position.gridX = override.gridX;
        position.gridY = override.gridY;
    }
}

function getImageHref(mapId, embedImages) {
    if (!embedImages) {
        return `../imgs_maps/${mapId}.png`;
    }

    if (!IMAGE_DATA_URI_CACHE.has(mapId)) {
        const imageBuffer = fs.readFileSync(path.join(IMAGES_DIR, `${mapId}.png`));
        IMAGE_DATA_URI_CACHE.set(mapId, `data:image/png;base64,${imageBuffer.toString("base64")}`);
    }

    return IMAGE_DATA_URI_CACHE.get(mapId);
}

function buildSvg(layout, imageWidth, imageHeight, options = {}) {
    const { embedImages = false } = options;
    const totalCols = Math.max(...layout.positions.map((position) => position.gridX)) + 1;
    const totalRows = Math.max(...layout.positions.map((position) => position.gridY)) + 1;
    const width = totalCols * imageWidth;
    const height = totalRows * imageHeight;
    const images = layout.positions
        .map((position) => {
            const x = position.gridX * imageWidth;
            const y = position.gridY * imageHeight;
            const imageHref = getImageHref(position.id, embedImages);

            return [
                `  <g id="map-${position.id}">`,
                `    <image href="${imageHref}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" />`,
                `    <rect x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" />`,
                `    <text x="${x + imageWidth / 2}" y="${y + imageHeight - 80}" font-family="monospace" font-size="110" font-weight="700" text-anchor="middle" fill="#ffffff">${position.id}</text>`,
                "  </g>",
            ].join("\n");
        })
        .join("\n");

    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
        `  <rect width="100%" height="100%" fill="#101418" />`,
        images,
        `</svg>`,
    ].join("\n");
}

function normalizePositions(positions) {
    const minX = Math.min(...positions.map((position) => position.gridX));
    const minY = Math.min(...positions.map((position) => position.gridY));

    return positions.map((position) => ({
        ...position,
        gridX: position.gridX - minX,
        gridY: position.gridY - minY,
    }));
}

function buildComponentExports(layout, detailedLayout, imageWidth, imageHeight) {
    const detailedById = new Map(detailedLayout.map((item) => [item.id, item]));

    return layout.components.map((component) => {
        const componentPositions = normalizePositions(
            layout.positions.filter((position) => position.componentId === component.id),
        ).sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX || a.id - b.id);

        const componentMaps = componentPositions.map((position) => detailedById.get(position.id));
        const componentConflicts = layout.conflicts.filter(
            (conflict) => component.maps.includes(conflict.sourceMap) || component.maps.includes(conflict.targetMap),
        );

        return {
            component,
            positions: componentPositions,
            maps: componentMaps,
            conflicts: componentConflicts,
            svg: buildSvg({ positions: componentPositions }, imageWidth, imageHeight),
        };
    });
}

function buildHtml(layoutFileName, stats) {
    return [
        "<!doctype html>",
        '<html lang="es">',
        "<head>",
        '  <meta charset="utf-8" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
        "  <title>World Map Preview</title>",
        "  <style>",
        "    :root { color-scheme: dark; }",
        "    * { box-sizing: border-box; }",
        "    body { margin: 0; font-family: monospace; background: #0b0f13; color: #e8eef2; }",
        "    header { position: sticky; top: 0; z-index: 1; display: flex; gap: 20px; flex-wrap: wrap; padding: 12px 16px; background: rgba(11, 15, 19, 0.9); border-bottom: 1px solid rgba(255,255,255,0.1); }",
        "    main { height: calc(100vh - 58px); overflow: auto; }",
        "    object, img { display: block; max-width: none; }",
        "    .warn { color: #ffb86c; }",
        "  </style>",
        "</head>",
        "<body>",
        "  <header>",
        `    <div>mapas: ${stats.totalMaps}</div>`,
        `    <div>componentes: ${stats.totalComponents}</div>`,
        `    <div>conflictos: <span class="warn">${stats.totalConflicts}</span></div>`,
        `    <div>layout: ${layoutFileName}</div>`,
        "  </header>",
        "  <main>",
        `    <img src="${layoutFileName}" alt="Mapa del mundo" />`,
        "  </main>",
        "</body>",
        "</html>",
    ].join("\n");
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function parseArgs(argv) {
    const options = {
        png: true,
        pngScale: DEFAULT_PNG_SCALE,
    };

    for (const arg of argv) {
        if (arg === "--no-png") {
            options.png = false;
            continue;
        }

        if (arg === "--png") {
            options.png = true;
            continue;
        }

        if (arg.startsWith("--scale=")) {
            options.pngScale = Number(arg.split("=")[1]);
            continue;
        }

        if (arg.startsWith("--png-scale=")) {
            options.pngScale = Number(arg.split("=")[1]);
            continue;
        }

        if (arg.startsWith("--reduce=")) {
            const reduction = Number(arg.split("=")[1]);
            options.pngScale = 100 - reduction;
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            console.log("Uso: node scripts/build-world-map.cjs [--png] [--no-png] [--scale=50] [--reduce=50]");
            console.log("--scale=50 exporta PNG al 50% del tamano original.");
            console.log("--reduce=50 exporta PNG con una reduccion del 50% (queda al 50%).");
            process.exit(0);
        }
    }

    if (!Number.isFinite(options.pngScale) || options.pngScale <= 0 || options.pngScale > 100) {
        throw new Error("El porcentaje debe estar entre 1 y 100.");
    }

    return options;
}

function renderSvgToPng(svgPath, pngPath, scalePercent) {
    execFileSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], { stdio: "pipe" });

    if (scalePercent === 100) {
        return;
    }

    const { width, height } = readPngSize(pngPath);
    const nextWidth = Math.max(1, Math.round(width * (scalePercent / 100)));
    const nextHeight = Math.max(1, Math.round(height * (scalePercent / 100)));

    execFileSync("sips", ["-z", String(nextHeight), String(nextWidth), pngPath], { stdio: "pipe" });
}

function optimizePng(pngPath) {
    const quantizedPath = `${pngPath}.quant.png`;

    try {
        execFileSync(
            "pngquant",
            ["--force", "--output", quantizedPath, "--speed", "1", "--quality", "40-80", pngPath],
            { stdio: "pipe" },
        );

        if (fs.existsSync(quantizedPath)) {
            fs.renameSync(quantizedPath, pngPath);
        }

        execFileSync("oxipng", ["-o", "4", "--strip", "all", pngPath], { stdio: "pipe" });
    } finally {
        if (fs.existsSync(quantizedPath)) {
            fs.unlinkSync(quantizedPath);
        }
    }
}

function renderLayoutToPng(layout, imageWidth, imageHeight, pngPath, scalePercent) {
    const tempSvgPath = `${pngPath}.render.svg`;

    fs.writeFileSync(tempSvgPath, buildSvg(layout, imageWidth, imageHeight, { embedImages: true }), "utf8");

    try {
        renderSvgToPng(tempSvgPath, pngPath, scalePercent);
    } finally {
        if (fs.existsSync(tempSvgPath)) {
            fs.unlinkSync(tempSvgPath);
        }
    }
}

function buildFrontendGridJson(positions, generatedAt) {
    const totalCols = Math.max(...positions.map((position) => position.gridX)) + 1;
    const totalRows = Math.max(...positions.map((position) => position.gridY)) + 1;

    return {
        generatedAt,
        totalCols,
        totalRows,
        maps: positions
            .map((position) => ({
                id: position.id,
                gridX: position.gridX,
                gridY: position.gridY,
            }))
            .sort((a, b) => a.id - b.id),
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    ensureDir(OUTPUT_DIR);
    ensureDir(COMPONENTS_DIR);

    const mapIds = fs
        .readdirSync(IMAGES_DIR)
        .filter(isMapImage)
        .map((fileName) => Number(path.basename(fileName, ".png")))
        .filter((mapId) => mapSourceExists(mapId))
        .sort((a, b) => a - b);

    if (mapIds.length === 0) {
        throw new Error("No se encontraron imagenes en imgs_maps.");
    }

    const sampleImage = path.join(IMAGES_DIR, `${mapIds[0]}.png`);
    const { width: imageWidth, height: imageHeight } = readPngSize(sampleImage);
    const graph = buildGraph(mapIds);
    const layout = layoutWorld(graph);
    const detailedLayout = layout.positions.map((position) => {
        const node = graph.get(position.id);
        return {
            ...position,
            image: `imgs_maps/${position.id}.png`,
            neighbors: node.neighbors,
            diagnostics: node.diagnostics,
        };
    });

    const layoutJson = {
        generatedAt: new Date().toISOString(),
        imageSize: { width: imageWidth, height: imageHeight },
        edgeBand: EDGE_BAND,
        totalMaps: mapIds.length,
        components: layout.components,
        conflicts: layout.conflicts,
        maps: detailedLayout,
    };

    const svgFileName = "world-map.svg";
    const pngFileName = "world-map.png";
    const generalPngFileName = "world-map-general.png";
    const svgPath = path.join(OUTPUT_DIR, svgFileName);
    const pngPath = path.join(OUTPUT_DIR, pngFileName);
    const generalPngPath = path.join(OUTPUT_DIR, generalPngFileName);
    const jsonPath = path.join(OUTPUT_DIR, "world-map-layout.json");
    const frontendGridPath = path.join(FRONTEND_DATA_DIR, "world-map-grid.json");
    const frontendGeneralGridPath = path.join(FRONTEND_DATA_DIR, "world-map-grid-general.json");
    const frontendWorldMapPath = path.join(FRONTEND_WORLD_MAP_DIR, "world-map.png");
    const frontendGeneralWorldMapPath = path.join(FRONTEND_WORLD_MAP_DIR, "world-map-general.png");
    const htmlPath = path.join(OUTPUT_DIR, "world-map-preview.html");
    const componentExports = buildComponentExports(layout, detailedLayout, imageWidth, imageHeight);
    const frontendMapComponent = componentExports.find(
        (componentExport) => componentExport.component.id === FRONTEND_WORLD_MAP_COMPONENT_ID,
    );

    if (!frontendMapComponent) {
        throw new Error(`No se encontro el componente ${FRONTEND_WORLD_MAP_COMPONENT_ID} para exportar al frontend.`);
    }

    const frontendGridJson = buildFrontendGridJson(frontendMapComponent.positions, layoutJson.generatedAt);
    const frontendGeneralGridJson = buildFrontendGridJson(layout.positions, layoutJson.generatedAt);

    fs.writeFileSync(svgPath, buildSvg(layout, imageWidth, imageHeight), "utf8");
    if (options.png) {
        renderLayoutToPng(layout, imageWidth, imageHeight, pngPath, options.pngScale);
        fs.copyFileSync(pngPath, generalPngPath);
        optimizePng(generalPngPath);
        ensureDir(FRONTEND_WORLD_MAP_DIR);
        fs.copyFileSync(generalPngPath, frontendGeneralWorldMapPath);
    }
    fs.writeFileSync(jsonPath, `${JSON.stringify(layoutJson, null, 2)}\n`, "utf8");
    ensureDir(FRONTEND_DATA_DIR);
    fs.writeFileSync(frontendGridPath, JSON.stringify(frontendGridJson), "utf8");
    fs.writeFileSync(frontendGeneralGridPath, JSON.stringify(frontendGeneralGridJson), "utf8");
    fs.writeFileSync(
        htmlPath,
        buildHtml(svgFileName, {
            totalMaps: mapIds.length,
            totalComponents: layout.components.length,
            totalConflicts: layout.conflicts.length,
        }),
        "utf8",
    );

    for (const componentExport of componentExports) {
        const componentDir = path.join(
            COMPONENTS_DIR,
            `component-${String(componentExport.component.id).padStart(2, "0")}`,
        );
        const componentSvgFileName = "map.svg";
        const componentPngFileName = "map.png";
        const componentJsonFileName = "layout.json";
        const componentWorldMapJsonFileName = "world-map-layout.json";
        const componentHtmlFileName = "preview.html";
        const componentSvgPath = path.join(componentDir, componentSvgFileName);
        const componentPngPath = path.join(componentDir, componentPngFileName);

        ensureDir(componentDir);
        fs.writeFileSync(componentSvgPath, componentExport.svg, "utf8");
        if (options.png) {
            renderLayoutToPng(
                { positions: componentExport.positions },
                imageWidth,
                imageHeight,
                componentPngPath,
                options.pngScale,
            );

            if (componentExport.component.id === FRONTEND_WORLD_MAP_COMPONENT_ID) {
                ensureDir(FRONTEND_WORLD_MAP_DIR);
                fs.copyFileSync(componentPngPath, frontendWorldMapPath);
            }
        }
        fs.writeFileSync(
            path.join(componentDir, componentJsonFileName),
            `${JSON.stringify(
                {
                    generatedAt: layoutJson.generatedAt,
                    imageSize: layoutJson.imageSize,
                    edgeBand: EDGE_BAND,
                    component: componentExport.component,
                    conflicts: componentExport.conflicts,
                    maps: componentExport.maps,
                },
                null,
                2,
            )}\n`,
            "utf8",
        );
        if (componentExport.component.id === FRONTEND_WORLD_MAP_COMPONENT_ID) {
            fs.writeFileSync(
                path.join(componentDir, componentWorldMapJsonFileName),
                `${JSON.stringify(
                    {
                        generatedAt: layoutJson.generatedAt,
                        imageSize: layoutJson.imageSize,
                        edgeBand: EDGE_BAND,
                        component: componentExport.component,
                        conflicts: componentExport.conflicts,
                        maps: componentExport.maps,
                    },
                    null,
                    2,
                )}\n`,
                "utf8",
            );
        }
        fs.writeFileSync(
            path.join(componentDir, componentHtmlFileName),
            buildHtml(componentSvgFileName, {
                totalMaps: componentExport.component.maps.length,
                totalComponents: 1,
                totalConflicts: componentExport.conflicts.length,
            }),
            "utf8",
        );
    }

    console.log(`SVG generado en ${path.relative(ROOT_DIR, svgPath)}`);
    if (options.png) {
        console.log(`PNG generado en ${path.relative(ROOT_DIR, pngPath)} al ${options.pngScale}%`);
        console.log(`PNG frontend generado en ${path.relative(ROOT_DIR, frontendWorldMapPath)}`);
    }
    console.log(`Layout generado en ${path.relative(ROOT_DIR, jsonPath)}`);
    console.log(`Grid frontend generada en ${path.relative(ROOT_DIR, frontendGridPath)}`);
    console.log(`Preview generada en ${path.relative(ROOT_DIR, htmlPath)}`);
    console.log(`Componentes exportados en ${path.relative(ROOT_DIR, COMPONENTS_DIR)}`);
    console.log(`Mapas procesados: ${mapIds.length}`);
    console.log(`Componentes: ${layout.components.length}`);
    console.log(`Conflictos de grilla detectados: ${layout.conflicts.length}`);
}

main();
