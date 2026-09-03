// Pure derivation of HUD animation events from consecutive hud snapshots.
// The play view diffs hud values every update and toggles CSS classes.

export interface HudEventsInput {
    hp?: number;
    level?: number;
}

export interface HudEvents {
    hpDropped: boolean;
    leveledUp: boolean;
}

export function deriveHudEvents(
    prev: HudEventsInput | null,
    next: HudEventsInput | null,
): HudEvents {
    if (!prev || !next) return { hpDropped: false, leveledUp: false };
    const hpDropped =
        typeof prev.hp === "number" &&
        typeof next.hp === "number" &&
        next.hp < prev.hp;
    const leveledUp =
        typeof prev.level === "number" &&
        typeof next.level === "number" &&
        next.level > prev.level;
    return { hpDropped, leveledUp };
}
