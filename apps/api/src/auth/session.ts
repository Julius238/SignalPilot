import { SignJWT, jwtVerify } from "jose";

export type AdminSessionPayload = {
  role: "admin";
  username?: string;
  devLogin?: boolean;
};

const ALGORITHM = "HS256";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export function getCookieName(): string {
  return process.env.AUTH_COOKIE_NAME ?? "signalpilot_session";
}

export function isAuthEnabled(): boolean {
  return process.env.API_AUTH_ENABLED !== "false";
}

export async function signSession(payload: AdminSessionPayload = { role: "admin" }): Promise<string> {
  const ttlHours = Number(process.env.AUTH_SESSION_TTL_HOURS ?? 12);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.role !== "admin") return null;
    return {
      role: "admin",
      username: typeof payload.username === "string" ? payload.username : undefined,
      devLogin: payload.devLogin === true
    };
  } catch {
    return null;
  }
}
