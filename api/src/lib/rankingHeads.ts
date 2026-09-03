import fs from "fs";
import path from "path";

// Head sprite resolution for GET /api/ranking, ported from
// frontend/lib/ranking-heads.ts. The sprite database ships with the API at
// src/jsons/headswithfile.json (copied from frontend/public/init).

export type RankingHeadSprite = {
    numFile: string;
    sourceX: number;
    sourceY: number;
    width: number;
    height: number;
};

type HeadsWithFileDB = Record<
    string,
    [numFile: string, sourceX: number, sourceY: number, width: number, height: number] | null
>;

let cachedDb: HeadsWithFileDB | null = null;

function loadHeadsWithFileDB(): HeadsWithFileDB {
    if (!cachedDb) {
        const filePath = path.resolve(__dirname, "../jsons/headswithfile.json");
        cachedDb = JSON.parse(fs.readFileSync(filePath, "utf8")) as HeadsWithFileDB;
    }

    return cachedDb;
}

export function getRankingHeadSprites(
    headIds: number[],
): Record<string, RankingHeadSprite | null> {
    if (headIds.length === 0) {
        return {};
    }

    try {
        const headsWithFileDB = loadHeadsWithFileDB();
        const uniqueHeadIds = [...new Set(headIds)];

        return Object.fromEntries(
            uniqueHeadIds.map((headId) => {
                const graphic = headsWithFileDB[String(headId)] ?? null;

                if (!graphic) {
                    return [String(headId), null];
                }

                return [
                    String(headId),
                    {
                        numFile: graphic[0],
                        sourceX: graphic[1],
                        sourceY: graphic[2],
                        width: graphic[3],
                        height: graphic[4],
                    },
                ];
            }),
        );
    } catch (error) {
        console.error("No se pudieron resolver las cabezas del ranking:", error);
        return {};
    }
}
