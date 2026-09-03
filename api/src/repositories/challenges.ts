import { z } from "zod";
import pool from "../db";
import type { ChallengeHistoryEntry, ChallengeHistoryRecord } from "../types";

const challengeParticipantSchema = z.object({
    characterId: z.string().uuid(),
    characterName: z.string().trim().min(1).max(64),
    teamSide: z.union([z.literal(1), z.literal(2)]),
    level: z.coerce.number().int().min(1).max(999),
    className: z.string().trim().min(1).max(64),
    raceName: z.string().trim().min(1).max(64),
});

const createChallengeHistorySchema = z.object({
    matchId: z.string().trim().min(1).max(120),
    teamSize: z.union([z.literal(1), z.literal(2)]),
    instanceMapId: z.coerce.number().int().min(1),
    winnerSide: z.union([z.literal(1), z.literal(2)]),
    finishReason: z.string().trim().min(1).max(120).optional().nullable(),
    teamOneScore: z.coerce.number().int().min(0).max(99),
    teamTwoScore: z.coerce.number().int().min(0).max(99),
    participants: z.array(challengeParticipantSchema).min(2).max(4),
    startedAt: z.union([z.string().datetime(), z.date()]),
    finishedAt: z.union([z.string().datetime(), z.date()]),
});

function toChallengeHistoryEntry(
    record: ChallengeHistoryRecord,
): ChallengeHistoryEntry {
    return {
        id: record.id,
        matchId: record.match_id,
        teamSize: record.team_size,
        instanceMapId: record.instance_map_id,
        winnerSide: record.winner_side,
        finishReason: record.finish_reason,
        teamOneScore: record.team_one_score,
        teamTwoScore: record.team_two_score,
        participants: record.participants,
        startedAt: record.started_at,
        finishedAt: record.finished_at,
        createdAt: record.created_at,
    };
}

export async function createChallengeHistory(
    payload: unknown,
): Promise<ChallengeHistoryEntry> {
    const parsed = createChallengeHistorySchema.parse(payload);
    const startedAt = new Date(parsed.startedAt);
    const finishedAt = new Date(parsed.finishedAt);

    const result = await pool.query<ChallengeHistoryRecord>(
        `
            INSERT INTO challenge_history (
                match_id,
                team_size,
                instance_map_id,
                winner_side,
                finish_reason,
                team_one_score,
                team_two_score,
                participants,
                started_at,
                finished_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
            ON CONFLICT (match_id)
            DO UPDATE SET winner_side = EXCLUDED.winner_side,
                          finish_reason = EXCLUDED.finish_reason,
                          team_one_score = EXCLUDED.team_one_score,
                          team_two_score = EXCLUDED.team_two_score,
                          participants = EXCLUDED.participants,
                          started_at = EXCLUDED.started_at,
                          finished_at = EXCLUDED.finished_at
            RETURNING *
        `,
        [
            parsed.matchId,
            parsed.teamSize,
            parsed.instanceMapId,
            parsed.winnerSide,
            parsed.finishReason ?? null,
            parsed.teamOneScore,
            parsed.teamTwoScore,
            JSON.stringify(parsed.participants),
            startedAt.toISOString(),
            finishedAt.toISOString(),
        ],
    );

    return toChallengeHistoryEntry(result.rows[0]);
}
