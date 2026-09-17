export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000/api";

export const ACCESS_TOKEN_COOKIE = "bf_access_token";
export const REFRESH_TOKEN_COOKIE = "bf_refresh_token";

export const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 minutes, matches backend access token TTL
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, matches backend refresh token TTL

export function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
