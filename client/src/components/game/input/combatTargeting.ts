import { Container } from "pixi.js";
import type { SpellData } from "../../../types/game";

type CombatTargetEntity = {
    isNpc?: boolean;
    pos: { x: number; y: number };
};

export function isSelfFirstSupportSpell(
    spellData: SpellData | null | undefined,
) {
    if (!spellData) {
        return false;
    }

    return Boolean(
        Number(spellData.removerParalisis ?? 0) === 1 ||
        Number(spellData.invisibilidad ?? 0) === 1 ||
        Number(spellData.subeHp ?? 0) === 1 ||
        Number(spellData.subeAg ?? 0) > 0 ||
        Number(spellData.subeFz ?? 0) > 0,
    );
}

export function getPointerTargetPriority(
    entity: CombatTargetEntity,
    isSelf: boolean,
    preferSelfFirst: boolean,
) {
    if (preferSelfFirst) {
        if (isSelf) {
            return 0;
        }

        return entity.isNpc ? 2 : 1;
    }

    if (!entity.isNpc && !isSelf) {
        return 0;
    }

    if (entity.isNpc) {
        return 1;
    }

    return 2;
}

export function getCombatTileMatchRank(
    entity: CombatTargetEntity,
    tileX: number,
    tileY: number,
) {
    if (entity.pos.x === tileX && entity.pos.y === tileY) {
        return 0;
    }

    if (entity.pos.x === tileX && entity.pos.y === tileY + 1) {
        return 1;
    }

    return 2;
}

export function getCombatTileDistance(
    entity: CombatTargetEntity,
    tileX: number,
    tileY: number,
) {
    const verticalDistance = Math.min(
        Math.abs(entity.pos.y - tileY),
        Math.abs(entity.pos.y - (tileY + 1)),
    );

    return Math.abs(entity.pos.x - tileX) + verticalDistance;
}

export function isPointerInsideCombatHitbox(
    bounds: { x: number; y: number; width: number; height: number },
    pointerX: number,
    pointerY: number,
) {
    const insetX = Math.min(bounds.width * 0.18, 12);
    const insetTop = Math.min(bounds.height * 0.12, 14);
    const insetBottom = Math.min(bounds.height * 0.06, 8);
    const hitboxX = bounds.x + insetX;
    const hitboxY = bounds.y + insetTop;
    const hitboxWidth = Math.max(8, bounds.width - insetX * 2);
    const hitboxHeight = Math.max(8, bounds.height - insetTop - insetBottom);

    return (
        pointerX >= hitboxX &&
        pointerX <= hitboxX + hitboxWidth &&
        pointerY >= hitboxY &&
        pointerY <= hitboxY + hitboxHeight
    );
}

export function isPointerOverMarkedSprite(
    container: Container | null | undefined,
    hitMarkers: Array<
        | "isPlayerBody"
        | "isPlayerHead"
        | "isPlayerHelmet"
        | "isRemoteBody"
        | "isRemoteHead"
        | "isRemoteHelmet"
    >,
    pointerX: number,
    pointerY: number,
): boolean {
    if (!container || container.destroyed) {
        return false;
    }

    return container.children.some((child) => {
        if (!hitMarkers.some((marker) => Boolean((child as any)[marker]))) {
            return false;
        }

        const displayObject = child as Container["children"][number] & {
            getBounds?: () => {
                x: number;
                y: number;
                width: number;
                height: number;
            };
        };

        if (
            typeof displayObject.getBounds !== "function" ||
            displayObject.visible === false ||
            displayObject.alpha <= 0.05
        ) {
            return false;
        }

        const bounds = displayObject.getBounds();

        return isPointerInsideCombatHitbox(bounds, pointerX, pointerY);
    });
}
