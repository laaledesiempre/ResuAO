import { Container } from "pixi.js";
import { TILE_SIZE } from "../../../lib/viewport";
import type { Character, Engine } from "../engine/Engine";

export type MapRowLayerKind = "object" | "character" | "above";

const MAP_ROW_LAYER_ORDER: MapRowLayerKind[] = ["object", "character", "above"];

function getMapRowLayerKey(row: number, kind: MapRowLayerKind): string {
    return `${row}:${kind}`;
}

function clampRow(engine: Engine, row: number): number {
    return Math.max(1, Math.min(engine.mapDimensions.height, Math.round(row)));
}

export function createMapRowLayerContainers(engine: Engine): void {
    if (!engine.mapContainer) {
        return;
    }

    engine.mapRowLayerContainers.clear();
    engine.groundLayerContainer = new Container();
    engine.belowLayerContainer = new Container();
    engine.mapContainer.addChild(engine.groundLayerContainer);
    engine.mapContainer.addChild(engine.belowLayerContainer);

    for (let row = 1; row <= engine.mapDimensions.height; row++) {
        for (const kind of MAP_ROW_LAYER_ORDER) {
            const container = new Container();
            engine.mapContainer.addChild(container);
            engine.mapRowLayerContainers.set(
                getMapRowLayerKey(row, kind),
                container,
            );
        }
    }
}

export function createRoofRowContainers(engine: Engine): void {
    if (!engine.roofContainer) {
        return;
    }

    engine.roofRowContainers.clear();

    for (let row = 1; row <= engine.mapDimensions.height; row++) {
        const container = new Container();
        engine.roofContainer.addChild(container);
        engine.roofRowContainers.set(row, container);
    }
}

export function createEntityFXRowContainers(engine: Engine): void {
    if (!engine.entityFXOverlayContainer) {
        return;
    }

    engine.entityFXRowContainers.clear();

    for (let row = 1; row <= engine.mapDimensions.height; row++) {
        const container = new Container();
        engine.entityFXOverlayContainer.addChild(container);
        engine.entityFXRowContainers.set(row, container);
    }
}

export function getMapRowLayerContainer(
    engine: Engine,
    row: number,
    kind: MapRowLayerKind,
): Container | null {
    return (
        engine.mapRowLayerContainers.get(
            getMapRowLayerKey(clampRow(engine, row), kind),
        ) ?? null
    );
}

export function getRoofRowContainer(
    engine: Engine,
    row: number,
): Container | null {
    return engine.roofRowContainers.get(clampRow(engine, row)) ?? null;
}

export function getEntityFXRowContainer(
    engine: Engine,
    row: number,
): Container | null {
    return engine.entityFXRowContainers.get(clampRow(engine, row)) ?? null;
}

export function getWorldRowFromWorldY(engine: Engine, worldY: number): number {
    return clampRow(engine, Math.floor(worldY / TILE_SIZE) + 1);
}

export function getCharacterBaseRenderRow(character: Character): number {
    return Math.max(1, character.pos.y - character.addtoUserPos.y);
}

export function syncCharacterContainerToRenderRow(
    engine: Engine,
    character: Character | null | undefined,
    container: Container | null | undefined,
): void {
    if (!character || !container) {
        return;
    }

    const targetContainer = getMapRowLayerContainer(
        engine,
        getCharacterBaseRenderRow(character),
        "character",
    );

    if (!targetContainer || container.parent === targetContainer) {
        return;
    }

    targetContainer.addChild(container);
}

export function syncDisplayObjectToEntityFXRow(
    engine: Engine,
    worldY: number,
    displayObject: any,
): void {
    const targetContainer = getEntityFXRowContainer(
        engine,
        getWorldRowFromWorldY(engine, worldY),
    );

    if (!targetContainer || displayObject.parent === targetContainer) {
        return;
    }

    targetContainer.addChild(displayObject as Container);
}
