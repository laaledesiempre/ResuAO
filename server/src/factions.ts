export type CharacterFaction = "none" | "armada" | "caos";

export type FactionRankConfig = {
    rank: number;
    title: string;
    minLevel: number;
    minScore: number;
    rewardItemIds: number[];
};

export type FactionConfig = {
    key: Exclude<CharacterFaction, "none">;
    enlistNpcId: number;
    rewardNpcId: number;
    color: string;
    ranks: FactionRankConfig[];
    restrictedItemIds: number[];
};

const ARMADA_RANKS: FactionRankConfig[] = [
    { rank: 1, title: "Soldado", minLevel: 25, minScore: 100, rewardItemIds: [] },
    { rank: 2, title: "Caballero", minLevel: 30, minScore: 500, rewardItemIds: [] },
    { rank: 3, title: "Capitan", minLevel: 35, minScore: 1000, rewardItemIds: [] },
    {
        rank: 4,
        title: "Protector del Reino",
        minLevel: 40,
        minScore: 2500,
        rewardItemIds: [],
    },
    {
        rank: 5,
        title: "Campeon de la Luz",
        minLevel: 43,
        minScore: 5000,
        rewardItemIds: [],
    },
];

const CAOS_RANKS: FactionRankConfig[] = [
    { rank: 1, title: "Acolito", minLevel: 25, minScore: 350, rewardItemIds: [] },
    {
        rank: 2,
        title: "Emisario del Caos",
        minLevel: 30,
        minScore: 1000,
        rewardItemIds: [],
    },
    { rank: 3, title: "Sanguinario", minLevel: 35, minScore: 2500, rewardItemIds: [] },
    {
        rank: 4,
        title: "Caballero de la Oscuridad",
        minLevel: 40,
        minScore: 5000,
        rewardItemIds: [],
    },
    {
        rank: 5,
        title: "Devorador de Almas",
        minLevel: 43,
        minScore: 10000,
        rewardItemIds: [],
    },
];

function collectRestrictedItems(ranks: FactionRankConfig[]): number[] {
    return Array.from(new Set(ranks.flatMap((rank) => rank.rewardItemIds)));
}

export const FACTIONS: Record<Exclude<CharacterFaction, "none">, FactionConfig> = {
    armada: {
        key: "armada",
        enlistNpcId: 72,
        rewardNpcId: 72,
        color: "#00AFFF",
        ranks: ARMADA_RANKS,
        restrictedItemIds: collectRestrictedItems(ARMADA_RANKS),
    },
    caos: {
        key: "caos",
        enlistNpcId: 98,
        rewardNpcId: 98,
        color: "#9B0000",
        ranks: CAOS_RANKS,
        restrictedItemIds: collectRestrictedItems(CAOS_RANKS),
    },
};

export function getFactionConfig(faction: CharacterFaction | undefined | null): FactionConfig | null {
    if (!faction || faction === "none") {
        return null;
    }

    return FACTIONS[faction];
}

export function getFactionColor(faction: CharacterFaction | undefined | null): string | null {
    return getFactionConfig(faction)?.color ?? null;
}

export function getFactionRankConfig(faction: CharacterFaction, rank: number): FactionRankConfig | null {
    return getFactionConfig(faction)?.ranks.find((entry) => entry.rank === rank) ?? null;
}

export function getFactionRankTitle(faction: CharacterFaction, rank: number): string | null {
    return getFactionRankConfig(faction, rank)?.title ?? null;
}

export function getMaxEligibleFactionRank(faction: CharacterFaction, level: number, score: number): number {
    const config = getFactionConfig(faction);

    if (!config) {
        return 0;
    }

    let eligibleRank = 0;

    for (const rank of config.ranks) {
        if (level >= rank.minLevel && score >= rank.minScore) {
            eligibleRank = rank.rank;
        }
    }

    return eligibleRank;
}

export function getFactionRewardItemIdsUpToRank(faction: CharacterFaction, rank: number): number[] {
    const config = getFactionConfig(faction);

    if (!config || rank <= 0) {
        return [];
    }

    return config.ranks.filter((entry) => entry.rank <= rank).flatMap((entry) => entry.rewardItemIds);
}

export function isFactionRewardItem(itemId: number): boolean {
    return Object.values(FACTIONS).some((config) => config.restrictedItemIds.includes(itemId));
}

export function getRequiredFactionForItem(itemId: number): CharacterFaction {
    for (const [faction, config] of Object.entries(FACTIONS) as Array<
        [Exclude<CharacterFaction, "none">, FactionConfig]
    >) {
        if (config.restrictedItemIds.includes(itemId)) {
            return faction;
        }
    }

    return "none";
}

export function calculateBaseFactionScore(attackerLevel: number, victimLevel: number): number {
    void attackerLevel;
    void victimLevel;
    return 10;
}
