import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    API_URL,
    buildCharacterName,
    createAccountFixture,
    ensureApiReady,
    requestJson,
} from "./helpers/api";

type CookieSessionPayload = {
    account?: { _id: string; name: string; email: string };
    characters?: unknown[];
    selectedCharacterId?: string | null;
    sessionToken?: string;
    error?: string;
};

function extractSessionCookie(response: Response): string | null {
    for (const header of response.headers.getSetCookie()) {
        if (header.startsWith("resu_session=")) {
            return header.split(";")[0];
        }
    }

    return null;
}

function extractSessionCookieAttributes(response: Response): string {
    return (
        response.headers
            .getSetCookie()
            .find((header) => header.startsWith("resu_session=")) ?? ""
    );
}

beforeAll(async () => {
    await ensureApiReady();
});

test("cookie register sets httpOnly session cookie and omits sessionToken", async () => {
    const nonce = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const response = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: buildCharacterName("Ck"),
            email: `cookie-${nonce}@local.test`,
            password: "VaultApi123",
        }),
    });
    const data = (await response.json()) as CookieSessionPayload;

    assert.equal(response.status, 200);
    assert.ok(data.account?._id, "register should return the account");
    assert.equal("sessionToken" in data, false);

    const cookie = extractSessionCookie(response);
    assert.ok(cookie, "register should set the session cookie");
    assert.ok(cookie!.split("=")[1].length > 0);

    const attributes = extractSessionCookieAttributes(response);
    assert.match(attributes, /HttpOnly/i);
    assert.match(attributes, /Path=\//);
    assert.match(attributes, /Max-Age=604800/);
    assert.match(attributes, /SameSite=Lax/i);
});

test("cookie session works end to end: login, session read, logout clears", async () => {
    const account = await createAccountFixture();

    const loginResponse = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            identifier: account.email,
            password: account.password,
        }),
    });
    const loginData = (await loginResponse.json()) as CookieSessionPayload;

    assert.equal(loginResponse.status, 200);
    assert.equal(loginData.account?.email, account.email);
    assert.equal("sessionToken" in loginData, false);

    const cookie = extractSessionCookie(loginResponse);
    assert.ok(cookie, "login should set the session cookie");

    const sessionResponse = await fetch(`${API_URL}/api/auth/session`, {
        headers: { Cookie: cookie! },
    });
    const sessionData = (await sessionResponse.json()) as CookieSessionPayload;

    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionData.account?.email, account.email);
    assert.ok(
        extractSessionCookie(sessionResponse),
        "session read should refresh the cookie",
    );

    const logoutResponse = await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Cookie: cookie! },
    });
    const logoutData = (await logoutResponse.json()) as { ok?: boolean };

    assert.equal(logoutResponse.status, 200);
    assert.equal(logoutData.ok, true);
    assert.match(
        extractSessionCookieAttributes(logoutResponse),
        /Max-Age=0/,
        "logout should clear the session cookie",
    );

    const sessionAfterLogout = await fetch(`${API_URL}/api/auth/session`, {
        headers: { Cookie: cookie! },
    });

    assert.equal(sessionAfterLogout.status, 401);
});

test("cookie session rejects missing cookie with friendly error", async () => {
    const response = await requestJson<{ error?: string }>("/api/auth/session");

    assert.equal(response.status, 401);
    assert.equal(response.data.error, "Tu sesion no es valida o ya vencio.");
});
