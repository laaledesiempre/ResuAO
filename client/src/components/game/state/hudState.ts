export function applyHudMemberDelta<T extends { id: number | string }>(
    current: T[],
    delta: { upsert: T[]; remove: Array<number | string> },
): T[] {
    const next = new Map(current.map((member) => [String(member.id), member]));

    for (const member of delta.upsert) {
        next.set(String(member.id), member);
    }

    for (const memberId of delta.remove) {
        next.delete(String(memberId));
    }

    return [...next.values()];
}
