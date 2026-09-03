import { z } from "zod";
import pool, { dbDialect } from "../db";
import type {
    UserOnlineStatRecord,
    UserOnlineStatsResponse,
    UserOnlineStatResponse,
} from "../types";

const createUserOnlineStatSchema = z
    .object({
        sampledAt: z.union([z.string().datetime(), z.date()]).optional(),
        totalUsers: z.coerce.number().int().min(0),
        pveUsers: z.coerce.number().int().min(0),
        pvpUsers: z.coerce.number().int().min(0),
        fishingUsers: z.coerce.number().int().min(0),
        miningUsers: z.coerce.number().int().min(0),
        woodcuttingUsers: z.coerce.number().int().min(0),
    })
    .superRefine((value, ctx) => {
        if (value.totalUsers !== value.pveUsers + value.pvpUsers) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "totalUsers debe ser igual a pveUsers + pvpUsers",
                path: ["totalUsers"],
            });
        }

        for (const key of ["fishingUsers", "miningUsers", "woodcuttingUsers"] as const) {
            if (value[key] > value.totalUsers) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${key} no puede superar totalUsers`,
                    path: [key],
                });
            }
        }
    });

function toUserOnlineStatResponse(
    record: UserOnlineStatRecord,
): UserOnlineStatResponse {
    return {
        sampledMinute: record.sampled_minute,
        totalUsers: record.total_users,
        pveUsers: record.pve_users,
        pvpUsers: record.pvp_users,
        fishingUsers: record.fishing_users,
        miningUsers: record.mining_users,
        woodcuttingUsers: record.woodcutting_users,
        createdAt: record.created_at,
    };
}

function getUserOnlineStatsBucketSeconds(hours: number): number | null {
    if (hours <= 1) {
        return null;
    }

    if (hours <= 6) {
        return 5 * 60;
    }

    if (hours <= 24) {
        return 15 * 60;
    }

    if (hours <= 168) {
        return 60 * 60;
    }

    if (hours <= 336) {
        return 2 * 60 * 60;
    }

    return 4 * 60 * 60;
}

export async function createUserOnlineStat(
    payload: unknown,
): Promise<UserOnlineStatResponse> {
    const parsed = createUserOnlineStatSchema.parse(payload);
    const sampledAt = parsed.sampledAt
        ? new Date(parsed.sampledAt)
        : new Date();

    const result = await pool.query<UserOnlineStatRecord>(
        `
            INSERT INTO user_online_stats (
                sampled_minute,
                total_users,
                pve_users,
                pvp_users,
                fishing_users,
                mining_users,
                woodcutting_users
            )
            VALUES (
                date_trunc('minute', $1::timestamptz),
                $2,
                $3,
                $4,
                $5,
                $6,
                $7
            )
            ON CONFLICT (sampled_minute)
            DO UPDATE SET
                total_users = EXCLUDED.total_users,
                pve_users = EXCLUDED.pve_users,
                pvp_users = EXCLUDED.pvp_users,
                fishing_users = EXCLUDED.fishing_users,
                mining_users = EXCLUDED.mining_users,
                woodcutting_users = EXCLUDED.woodcutting_users
            RETURNING *
        `,
        [
            sampledAt.toISOString(),
            parsed.totalUsers,
            parsed.pveUsers,
            parsed.pvpUsers,
            parsed.fishingUsers,
            parsed.miningUsers,
            parsed.woodcuttingUsers,
        ],
    );

    return toUserOnlineStatResponse(result.rows[0]);
}

export async function listUserOnlineStats(
    hours = 24,
): Promise<UserOnlineStatsResponse> {
    const safeHours = Number.isFinite(hours)
        ? Math.min(Math.max(hours, 0.25), 720)
        : 24;
    const bucketSeconds = getUserOnlineStatsBucketSeconds(safeHours);

    if (!bucketSeconds) {
        const result = await pool.query<UserOnlineStatRecord>(
            `
                SELECT *
                FROM user_online_stats
                WHERE sampled_minute >= NOW() - ($1::double precision * INTERVAL '1 hour')
                ORDER BY sampled_minute ASC
            `,
            [safeHours],
        );

        return { stats: result.rows.map(toUserOnlineStatResponse) };
    }

    if (dbDialect === "sqlite") {
        // SQLite variant: unixepoch()/strftime() instead of
        // EXTRACT(EPOCH ...)/to_timestamp(), a JS-computed window cutoff
        // instead of NOW() - INTERVAL, and a far-future literal instead of
        // 'infinity'::timestamptz.
        const cutoff = new Date(
            Date.now() - safeHours * 60 * 60 * 1000,
        ).toISOString();
        const result = await pool.query<UserOnlineStatRecord>(
            `
                WITH filtered_stats AS (
                    SELECT *
                    FROM user_online_stats
                    WHERE sampled_minute >= $1
                ),
                latest_stat AS (
                    SELECT *
                    FROM filtered_stats
                    ORDER BY sampled_minute DESC
                    LIMIT 1
                ),
                bucketed_stats AS (
                    SELECT
                        strftime('%Y-%m-%dT%H:%M:%fZ', CAST(FLOOR((unixepoch(sampled_minute) * 1.0) / $2) * $2 AS INTEGER), 'unixepoch') AS sampled_minute,
                        CAST(ROUND(AVG(total_users)) AS INTEGER) AS total_users,
                        CAST(ROUND(AVG(pve_users)) AS INTEGER) AS pve_users,
                        CAST(ROUND(AVG(pvp_users)) AS INTEGER) AS pvp_users,
                        CAST(ROUND(AVG(fishing_users)) AS INTEGER) AS fishing_users,
                        CAST(ROUND(AVG(mining_users)) AS INTEGER) AS mining_users,
                        CAST(ROUND(AVG(woodcutting_users)) AS INTEGER) AS woodcutting_users,
                        MAX(created_at) AS created_at
                    FROM filtered_stats
                    WHERE sampled_minute < COALESCE((SELECT sampled_minute FROM latest_stat), '9999-12-31T23:59:59.999Z')
                    GROUP BY 1
                )
                SELECT
                    sampled_minute,
                    total_users,
                    pve_users,
                    pvp_users,
                    fishing_users,
                    mining_users,
                    woodcutting_users,
                    created_at
                FROM bucketed_stats
                UNION ALL
                SELECT
                    sampled_minute,
                    total_users,
                    pve_users,
                    pvp_users,
                    fishing_users,
                    mining_users,
                    woodcutting_users,
                    created_at
                FROM latest_stat
                ORDER BY sampled_minute ASC
            `,
            [cutoff, bucketSeconds],
        );

        return { stats: result.rows.map(toUserOnlineStatResponse) };
    }

    const result = await pool.query<UserOnlineStatRecord>(
        `
            WITH filtered_stats AS (
                SELECT *
                FROM user_online_stats
                WHERE sampled_minute >= NOW() - ($1::double precision * INTERVAL '1 hour')
            ),
            latest_stat AS (
                SELECT *
                FROM filtered_stats
                ORDER BY sampled_minute DESC
                LIMIT 1
            ),
            bucketed_stats AS (
                SELECT
                    to_timestamp(FLOOR(EXTRACT(EPOCH FROM sampled_minute) / $2) * $2) AS sampled_minute,
                    ROUND(AVG(total_users))::integer AS total_users,
                    ROUND(AVG(pve_users))::integer AS pve_users,
                    ROUND(AVG(pvp_users))::integer AS pvp_users,
                    ROUND(AVG(fishing_users))::integer AS fishing_users,
                    ROUND(AVG(mining_users))::integer AS mining_users,
                    ROUND(AVG(woodcutting_users))::integer AS woodcutting_users,
                    MAX(created_at) AS created_at
                FROM filtered_stats
                WHERE sampled_minute < COALESCE((SELECT sampled_minute FROM latest_stat), 'infinity'::timestamptz)
                GROUP BY 1
            )
            SELECT
                sampled_minute,
                total_users,
                pve_users,
                pvp_users,
                fishing_users,
                mining_users,
                woodcutting_users,
                created_at
            FROM bucketed_stats
            UNION ALL
            SELECT
                sampled_minute,
                total_users,
                pve_users,
                pvp_users,
                fishing_users,
                mining_users,
                woodcutting_users,
                created_at
            FROM latest_stat
            ORDER BY sampled_minute ASC
        `,
        [safeHours, bucketSeconds],
    );

    return { stats: result.rows.map(toUserOnlineStatResponse) };
}
