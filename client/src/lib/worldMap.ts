// World map helpers: the grid JSON maps each map id to a cell in the world
// map image, and the player position inside the map refines the marker.
// Mirrors frontend/components/InventoryFloatingPanel.tsx math.

export const WORLD_MAP_TILES = 100;

export interface WorldMapGridData {
    generatedAt: string;
    totalCols: number;
    totalRows: number;
    maps: { id: number; gridX: number; gridY: number }[];
}

export interface WorldMapMarker {
    leftPct: number;
    topPct: number;
}

export function computeWorldMapMarker(
    grid: WorldMapGridData,
    mapId: number | null | undefined,
    pos: { x: number; y: number } | null | undefined,
): WorldMapMarker | null {
    if (!mapId || !pos) {
        return null;
    }

    const layout = grid.maps.find((entry) => entry.id === mapId);
    if (!layout) {
        return null;
    }

    const normalizedX = Math.max(
        0,
        Math.min(1, (pos.x - 0.5) / WORLD_MAP_TILES),
    );
    const normalizedY = Math.max(
        0,
        Math.min(1, (pos.y - 0.5) / WORLD_MAP_TILES),
    );

    return {
        leftPct: ((layout.gridX + normalizedX) / grid.totalCols) * 100,
        topPct: ((layout.gridY + normalizedY) / grid.totalRows) * 100,
    };
}
