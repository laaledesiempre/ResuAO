import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TILE_SIZE } from "../../../lib/viewport";

export function createDebugGrid(mapDimensions: {
    width: number;
    height: number;
}): Container {
    const debugContainer = new Container();
    debugContainer.zIndex = 10000;
    debugContainer.visible = false;

    const gridGraphics = new Graphics();

    for (let x = 0; x <= mapDimensions.width; x++) {
        const xPos = x * TILE_SIZE;
        gridGraphics.rect(xPos, 0, 1, mapDimensions.height * TILE_SIZE).fill({
            color: 0x00ff00,
            alpha: 0.7,
        });
    }

    for (let y = 0; y <= mapDimensions.height; y++) {
        const yPos = y * TILE_SIZE;
        gridGraphics.rect(0, yPos, mapDimensions.width * TILE_SIZE, 1).fill({
            color: 0x00ff00,
            alpha: 0.7,
        });
    }

    debugContainer.addChild(gridGraphics);

    const labelStyle = new TextStyle({
        fontFamily: "Arial",
        fontSize: 10,
        fill: 0x00ff00,
        stroke: { color: 0x000000, width: 1 },
    });

    for (let x = 0; x <= mapDimensions.width; x += 10) {
        for (let y = 0; y <= mapDimensions.height; y += 10) {
            if (x < mapDimensions.width && y < mapDimensions.height) {
                const label = new Text({
                    text: `${x + 1},${y + 1}`,
                    style: labelStyle,
                });
                label.x = x * TILE_SIZE + 2;
                label.y = y * TILE_SIZE + 2;
                debugContainer.addChild(label);
            }
        }
    }

    return debugContainer;
}
