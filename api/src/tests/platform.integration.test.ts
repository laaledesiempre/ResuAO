import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    API_AUTH,
    createAccountFixture,
    ensureApiReady,
    requestJson,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("public endpoints health runtime-config ranking and wiki respond", async () => {
    const [health, runtimeConfig, ranking, wiki] = await Promise.all([
        requestJson<{ ok?: boolean }>("/health"),
        requestJson<{ timing?: { walkStepMs?: number } }>("/runtime-config"),
        requestJson<{ characters?: unknown[] }>("/ranking"),
        requestJson<unknown>("/wiki"),
    ]);

    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.equal(runtimeConfig.status, 200);
    assert.equal(typeof runtimeConfig.data.timing?.walkStepMs, "number");
    assert.equal(ranking.status, 200);
    assert.equal(wiki.status, 200);
});

test("runtime-config internal endpoint requires auth and validates updates", async () => {
    const noAuth = await requestJson<{ error?: string }>(
        "/internal/runtime-config",
    );
    const withAuth = await requestJson<{ timing?: { walkStepMs?: number } }>(
        "/internal/runtime-config",
        {
            headers: {
                Authorization: API_AUTH,
            },
        },
    );
    const missingPath = await requestJson<{ error?: string }>(
        "/internal/runtime-config/timing",
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: API_AUTH,
            },
            body: JSON.stringify({ value: 123 }),
        },
    );

    assert.equal(noAuth.status, 401);
    assert.equal(withAuth.status, 200);
    assert.equal(typeof withAuth.data.timing?.walkStepMs, "number");
    assert.equal(missingPath.status, 400);
    assert.equal(missingPath.data.error, "path es requerido");
});

test("admin game-data endpoints are forbidden without admin proxy auth", async () => {
    const account = await createAccountFixture();

    const noSession = await requestJson<{ error?: string }>(
        "/admin/game-data/objects",
    );
    const userSession = await requestJson<{ error?: string }>(
        "/admin/game-data/objects",
        {
            headers: {
                Authorization: `Bearer ${account.session.sessionToken}`,
            },
        },
    );

    assert.equal(noSession.status, 403);
    assert.equal(userSession.status, 403);
});

test("internal game-data endpoints require auth and validate ids", async () => {
    const noAuth = await requestJson<{ error?: string }>(
        "/internal/game-data/crafting-recipes/1",
    );
    const invalidId = await requestJson<{ error?: string }>(
        "/internal/game-data/crafting-recipes/not-a-number",
        {
            headers: {
                Authorization: API_AUTH,
            },
        },
    );
    const balance = await requestJson<object | { error?: string }>(
        "/internal/game-data/balance",
        {
            headers: {
                Authorization: API_AUTH,
            },
        },
    );

    assert.equal(noAuth.status, 401);
    assert.equal(invalidId.status, 400);
    assert.equal(invalidId.data.error, "id invalido");
    assert.equal([200, 404].includes(balance.status), true);
});

test("user online stats endpoint validates payloads and exposes aggregate stats", async () => {
    const invalidOnlineStat = await requestJson<{ error?: string }>(
        "/internal/user-online-stats",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: API_AUTH,
            },
            body: JSON.stringify({
                totalUsers: 3,
                pveUsers: 1,
                pvpUsers: 1,
                fishingUsers: 0,
                miningUsers: 0,
                woodcuttingUsers: 0,
            }),
        },
    );
    const validOnlineStat = await requestJson<{ totalUsers?: number }>(
        "/internal/user-online-stats",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: API_AUTH,
            },
            body: JSON.stringify({
                totalUsers: 2,
                pveUsers: 1,
                pvpUsers: 1,
                fishingUsers: 0,
                miningUsers: 0,
                woodcuttingUsers: 0,
            }),
        },
    );
    const publicStats = await requestJson<{ stats?: unknown[] }>(
        "/user-online-stats",
    );

    assert.equal(invalidOnlineStat.status, 400);
    assert.equal(validOnlineStat.status, 201);
    assert.equal(validOnlineStat.data.totalUsers, 2);
    assert.equal(publicStats.status, 200);
    assert.equal(Array.isArray(publicStats.data.stats), true);
});
