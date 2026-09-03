import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

// Cookie-session helpers for the /api/* routes, mirroring the behavior that
// used to live in frontend/app/api/auth/shared.ts.

export const AUTH_COOKIE_NAME = "resu_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const INVALID_SESSION_MESSAGE = "Tu sesion no es valida o ya vencio.";

export function shouldUseSecureCookies(c: Context): boolean {
    const forwardedProto = c.req
        .header("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim();

    if (forwardedProto) {
        return forwardedProto === "https";
    }

    return new URL(c.req.url).protocol === "https:";
}

export function getSessionTokenFromCookie(c: Context): string | null {
    const token = getCookie(c)[AUTH_COOKIE_NAME]?.trim();
    return token || null;
}

export function setSessionCookie(c: Context, token: string): void {
    setCookie(c, AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: shouldUseSecureCookies(c),
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
    });
}

export function clearSessionCookie(c: Context): void {
    setCookie(c, AUTH_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "Lax",
        secure: shouldUseSecureCookies(c),
        path: "/",
        maxAge: 0,
    });
}
