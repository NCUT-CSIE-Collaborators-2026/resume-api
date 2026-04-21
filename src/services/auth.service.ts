import type { Context } from "hono";
import type { Env } from "../app.types";
import {
  encodeBase64Url,
  decodeBase64UrlToText,
  getTextBuffer,
  getTextBytes,
  isHttpsRequest,
  getGoogleOAuthConfig,
  configService,
} from "./config.service";
import { getDb } from "../db/client";
import { resumeI18nContent } from "../db/schema";

type AppContext = Context<{ Bindings: Env }>;

const SESSION_COOKIE_NAME = "resume_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const OAUTH_STATE_TTL_SECONDS = 600;

// Auth 服務導覽：
// 1) 共用資料解析輔助
// 2) JWT 與 OAuth state 基礎能力
// 3) 登入郵件白名單查詢
// 4) 路由處理器（login/callback/session/logout）

type JwtPayload = {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  iat?: number;
  exp?: number;
};

type GoogleOAuthTokenPayload = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserProfile = {
  email?: string;
  name?: string;
  picture?: string;
};

type GoogleTokenInfo = {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeEmail = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getProfileEmailsFromArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const emails: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== "string" || entry.id.trim() !== "profile") continue;

    // Profile emails are in items[].name, not entry.email
    if (Array.isArray(entry.items)) {
      for (const item of entry.items) {
        if (isRecord(item) && typeof item.name === "string") {
          const normalized = normalizeEmail(item.name);
          if (normalized.length > 0) {
            emails.push(normalized);
          }
        }
      }
    }
  }
  return emails;
};

const parseJwtPayload = (encodedBody: string): JwtPayload | null => {
  const decodedBody = decodeBase64UrlToText(encodedBody);
  const parsed = parseJson(decodedBody);
  if (!isRecord(parsed)) {
    return null;
  }

  return parsed as JwtPayload;
};

// 產生 OAuth state 的隨機 nonce。
export const generateState = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
};

const decodeBase64UrlToBytes = (input: string): Uint8Array => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

// 解析請求 Cookie header 中指定名稱的 cookie。
export const getCookieValue = (
  cookieHeader: string | undefined,
  name: string,
): string | undefined => {
  if (!cookieHeader) {
    return undefined;
  }

  const entries = cookieHeader.split(/;\s*/);
  for (const entry of entries) {
    const [rawKey, value] = entry.split("=");
    if (rawKey === name) {
      return value ? decodeURIComponent(value) : undefined;
    }
  }

  return undefined;
};

// 寫入 session cookie；HTTPS 時使用 SameSite=None。
export const buildSessionCookie = (
  sessionToken: string,
  useSecureCookie: boolean,
): string => {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
    `HttpOnly`,
    `Path=/`,
    useSecureCookie ? `SameSite=None` : `SameSite=Lax`,
  ];

  if (useSecureCookie) {
    parts.push(`Secure`);
  }

  parts.push(`Max-Age=${SESSION_TTL_SECONDS}`);
  return parts.join("; ");
};

// 清除 session cookie（登出流程）。
export const clearSessionCookie = (useSecureCookie: boolean): string => {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `HttpOnly`,
    `Path=/`,
    useSecureCookie ? `SameSite=None` : `SameSite=Lax`,
    `Max-Age=0`,
  ];

  if (useSecureCookie) {
    parts.push(`Secure`);
  }

  return parts.join("; ");
};

// 最小化 JWT（HS256）簽發。
export const createJwt = async (
  payload: JwtPayload,
  secret: string,
): Promise<string> => {
  const header = JSON.stringify({ alg: "HS256", typ: "JWT" });
  const body = JSON.stringify(payload);

  const headerEncoded = encodeBase64Url(getTextBytes(header));
  const bodyEncoded = encodeBase64Url(getTextBytes(body));
  const message = `${headerEncoded}.${bodyEncoded}`;

  const keyBuffer = getTextBuffer(secret);
  const messageBuffer = getTextBuffer(message);
  const signature = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey("raw", keyBuffer, "HMAC", false, ["sign"]),
    messageBuffer,
  );

  const signatureEncoded = encodeBase64Url(new Uint8Array(signature));
  return `${message}.${signatureEncoded}`;
};

// 最小化 JWT 驗證：結構、簽章、過期時間。
export const verifyJwt = async (
  token: string,
  secret: string,
): Promise<{
  valid: boolean;
  reason?: string;
  payload?: JwtPayload;
}> => {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return { valid: false, reason: "invalid_jwt_structure" };
  }

  const [headerEncoded, bodyEncoded, signatureEncoded] = parts;
  const message = `${headerEncoded}.${bodyEncoded}`;

  const keyBuffer = getTextBuffer(secret);
  const messageBuffer = getTextBuffer(message);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64UrlToBytes(signatureEncoded);
  } catch {
    return { valid: false, reason: "invalid_jwt_signature" };
  }

  const isValid = await crypto.subtle.verify(
    "HMAC",
    await crypto.subtle.importKey("raw", keyBuffer, "HMAC", false, ["verify"]),
    signatureBytes as BufferSource,
    messageBuffer,
  );

  if (!isValid) {
    return { valid: false, reason: "invalid_jwt_signature" };
  }

  const payload = parseJwtPayload(bodyEncoded);
  if (!payload) {
    return { valid: false, reason: "invalid_jwt_payload" };
  }

  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) >= exp!) {
    return { valid: false, reason: "jwt_expired" };
  }

  return { valid: true, payload };
};

// 簽署 OAuth state，用於防止 CSRF 與重放。
export const generateSignedState = async (secret: string): Promise<string> => {
  const state = generateState();
  const now = Math.floor(Date.now() / 1000);
  const expirationTimestamp = now + OAUTH_STATE_TTL_SECONDS;
  const statePayload = `${state}:${expirationTimestamp}`;

  const keyBuffer = getTextBuffer(secret);
  const payloadBuffer = getTextBuffer(statePayload);

  const signature = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    payloadBuffer,
  );

  const signatureHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${statePayload}:${signatureHex}`;
};

// 驗證 OAuth state 的簽章與有效時間窗。
export const validateSignedState = async (
  signedState: string,
  secret: string,
): Promise<{ ok: boolean; reason?: string }> => {
  const parts = signedState.split(":");

  if (parts.length !== 3) {
    return { ok: false, reason: "malformed_state" };
  }

  const [stateBase64, timestampStr, signatureHex] = parts;
  const expirationTimestamp = Number.parseInt(timestampStr, 10);

  if (!Number.isFinite(expirationTimestamp)) {
    return { ok: false, reason: "invalid_state_timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - expirationTimestamp;

  if (ageSeconds < 0 || ageSeconds > OAUTH_STATE_TTL_SECONDS) {
    return { ok: false, reason: "state_expired" };
  }

  const statePayload = `${stateBase64}:${timestampStr}`;
  const keyBuffer = getTextBuffer(secret);
  const payloadBuffer = getTextBuffer(statePayload);

  const expectedSignature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          keyBuffer,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        payloadBuffer,
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedSignature !== signatureHex) {
    return { ok: false, reason: "invalid_state_signature" };
  }

  return { ok: true };
};

// 從 D1 payload 查詢郵件白名單（僅支援目前 root array / profile.items[].name 結構）。
export const isAllowedLoginEmail = async (
  env: Env,
  email: string,
): Promise<boolean> => {
  const targetEmail = normalizeEmail(email);
  if (!targetEmail) {
    return false;
  }

  const db = getDb(env);
  const rows = await db
    .select({ payload: resumeI18nContent.payload })
    .from(resumeI18nContent);

  for (const row of rows) {
    const parsed = parseJson(row.payload);
    if (!parsed) {
      continue;
    }

    if (getProfileEmailsFromArray(parsed).includes(targetEmail)) {
      return true;
    }
  }

  return false;
};

export const authService = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  OAUTH_STATE_TTL_SECONDS,

  async googleLogin(c: AppContext) {
    // 入口：建立 OAuth 授權 URL，並導向 Google。
    const config = getGoogleOAuthConfig(c.env);
    if (!config) {
      return c.json(
        {
          message:
            "Google OAuth config missing. Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI",
        },
        500,
      );
    }

    const configuredSuccessRedirect =
      c.env.GOOGLE_OAUTH_SUCCESS_REDIRECT?.trim();
    if (!configuredSuccessRedirect) {
      return c.json({ message: "Missing GOOGLE_OAUTH_SUCCESS_REDIRECT" }, 500);
    }

    let configuredSuccessUrl: URL;
    try {
      configuredSuccessUrl = new URL(configuredSuccessRedirect);
    } catch {
      return c.json(
        { message: "Configured success redirect is not a valid URL" },
        500,
      );
    }

    const allowedOrigins = new Set(
      configService.getAllowedRedirectOrigins(c.env),
    );
    if (!allowedOrigins.has(configuredSuccessUrl.origin)) {
      return c.json(
        {
          message:
            "Configured success redirect target is not allowed by CORS_ORIGINS",
        },
        500,
      );
    }

    const state = await generateSignedState(config.clientSecret);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    return c.redirect(authUrl.toString(), 302);
  },

  async googleCallback(c: AppContext) {
    // 回呼：驗證 state -> 交換 code -> 取得 profile -> 發放 session cookie。
    const requestUrl = new URL(c.req.url);
    const debugMode =
      requestUrl.searchParams.get("debug") === "1" ||
      c.env.GOOGLE_OAUTH_DEBUG_RESPONSE?.trim() === "true";

    const redirectToFailure = (
      errorCode: string,
      fallbackBody: Record<string, unknown>,
      fallbackStatus: 400 | 401 | 403 | 500,
    ): Response => {
      if (debugMode) {
        return c.json(
          {
            ...fallbackBody,
            login: "failed",
            error: errorCode,
          },
          fallbackStatus,
        );
      }

      const failureRedirect = c.env.GOOGLE_OAUTH_FAILURE_REDIRECT?.trim();
      if (!failureRedirect) {
        return c.json(fallbackBody, fallbackStatus);
      }

      let failureUrl: URL;
      try {
        failureUrl = new URL(failureRedirect);
      } catch {
        return c.json(
          { message: "Configured failure redirect is not a valid URL" },
          500,
        );
      }

      const allowedOrigins = new Set(
        configService.getAllowedRedirectOrigins(c.env),
      );
      if (!allowedOrigins.has(failureUrl.origin)) {
        return c.json(
          {
            message:
              "Configured failure redirect target is not allowed by CORS_ORIGINS",
          },
          500,
        );
      }

      failureUrl.searchParams.set("login", "failed");
      failureUrl.searchParams.set("error", errorCode);
      return c.redirect(failureUrl.toString(), 302);
    };

    const config = getGoogleOAuthConfig(c.env);
    if (!config) {
      return c.json(
        {
          message:
            "Google OAuth config missing. Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI",
        },
        500,
      );
    }

    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    const error = requestUrl.searchParams.get("error");

    if (error) {
      return redirectToFailure(
        error,
        { message: "Google OAuth denied", error },
        400,
      );
    }

    if (!code || !state) {
      return redirectToFailure(
        "missing_oauth_code_or_state",
        { message: "Missing OAuth code or state" },
        400,
      );
    }

    const stateValidation = await validateSignedState(
      state,
      config.clientSecret,
    );
    if (!stateValidation.ok) {
      return redirectToFailure(
        stateValidation.reason ?? "invalid_state",
        { message: "Invalid OAuth state", reason: stateValidation.reason },
        400,
      );
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenPayload =
      (await tokenResponse.json()) as GoogleOAuthTokenPayload;

    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return redirectToFailure(
        tokenPayload.error ?? "oauth_token_exchange_failed",
        {
          message: "Failed to exchange OAuth code",
          error: tokenPayload.error ?? "oauth_token_exchange_failed",
          error_description: tokenPayload.error_description,
        },
        500,
      );
    }

    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      },
    );

    const profile = (await profileResponse.json()) as GoogleUserProfile;
    const email = normalizeEmail(profile.email);

    if (!email) {
      return redirectToFailure(
        "google_account_email_missing",
        { message: "Google account email missing", debug: { raw_email: profile.email } },
        403,
      );
    }

    const emailAllowed = await isAllowedLoginEmail(c.env, email);

    if (!emailAllowed) {
      return redirectToFailure(
        "login_denied_unknown_user",
        { message: "Login denied: unknown user", email, debug: { normalized_email: email, emailAllowed } },
        403,
      );
    }

    if (!c.env.JWT_SECRET) {
      return redirectToFailure(
        "jwt_secret_not_configured",
        { message: "JWT_SECRET is not configured" },
        500,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const sessionToken = await createJwt(
      {
        sub: email,
        email,
        name: profile.name,
        picture: profile.picture,
        iat: now,
        exp: now + SESSION_TTL_SECONDS,
      },
      c.env.JWT_SECRET,
    );

    const useSecureCookie = isHttpsRequest(
      c.req.url,
      c.req.header("x-forwarded-proto"),
    );
    c.header("Set-Cookie", buildSessionCookie(sessionToken, useSecureCookie));

    const successRedirect = c.env.GOOGLE_OAUTH_SUCCESS_REDIRECT?.trim();
    if (successRedirect) {
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(successRedirect);
      } catch {
        return redirectToFailure(
          "success_redirect_invalid_url",
          { message: "Configured success redirect is not a valid URL" },
          500,
        );
      }

      const allowedOrigins = new Set(
        configService.getAllowedRedirectOrigins(c.env),
      );
      if (!allowedOrigins.has(redirectUrl.origin)) {
        return redirectToFailure(
          "success_redirect_not_allowed",
          {
            message:
              "Configured redirect target is not allowed by CORS_ORIGINS",
          },
          500,
        );
      }
      if (debugMode) {
        const response = c.json(
          {
            login: "success",
            email,
            tokenLength: sessionToken.length,
            secure: useSecureCookie,
            redirectUrl: redirectUrl.toString(),
          },
          200,
        );
        response.headers.set(
          "Set-Cookie",
          buildSessionCookie(sessionToken, useSecureCookie),
        );
        return response;
      }

      redirectUrl.searchParams.set("login", "success");
      return c.redirect(redirectUrl.toString(), 302);
    }

    return redirectToFailure(
      "missing_oauth_success_redirect_target",
      { message: "Missing OAuth success redirect target" },
      500,
    );
  },

  async session(c: AppContext) {
    // 前端用來判斷登入/可編輯狀態的 session 探針端點。
    const jwtSecret = c.env.JWT_SECRET;
    if (!jwtSecret) {
      return c.json(
        {
          authenticated: false,
          reason: "jwt_secret_not_configured",
          message: "JWT_SECRET is not configured",
        },
        500,
      );
    }

    const sessionToken = getCookieValue(
      c.req.header("Cookie"),
      SESSION_COOKIE_NAME,
    );
    if (!sessionToken) {
      return c.json({ authenticated: false, reason: "no_session_cookie" }, 200);
    }

    const verification = await verifyJwt(sessionToken, jwtSecret);

    if (!verification.valid) {
      return c.json({ authenticated: false, reason: verification.reason }, 200);
    }

    const payload = verification.payload ?? {};
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const rawName = typeof payload.name === "string" ? payload.name.trim() : "";
    const name = rawName || email;
    const picture =
      typeof payload.picture === "string" && payload.picture.trim().length > 0
        ? payload.picture.trim()
        : null;

    return c.json({ authenticated: true, user: { email, name, picture } });
  },

  logout(c: AppContext) {
    // 登出僅處理 cookie：清除 client 端 session token。
    const useSecureCookie = isHttpsRequest(
      c.req.url,
      c.req.header("x-forwarded-proto"),
    );
    c.header("Set-Cookie", clearSessionCookie(useSecureCookie));
    return c.json({ ok: true });
  },

  async googleMe(c: AppContext) {
    const accessToken = c.req.query("access_token");
    if (!accessToken) {
      return c.json({ message: "Missing access_token query param" }, 400);
    }

    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const profile = await profileResponse.json();
    return c.json(profile, profileResponse.status as 200 | 400 | 401 | 500);
  },

  async tokenLogin(c: AppContext) {
    // 前端 token 流程的替代登入路徑（不走 OAuth callback redirect）。
    if (!c.env.GOOGLE_CLIENT_ID) {
      return c.json({ message: "GOOGLE_CLIENT_ID is not configured" }, 500);
    }

    if (!c.env.JWT_SECRET) {
      return c.json({ message: "JWT_SECRET is not configured" }, 500);
    }

    let body: { id_token?: string };
    try {
      body = await c.req.json<{ id_token?: string }>();
    } catch {
      return c.json({ message: "Invalid JSON body" }, 400);
    }

    const idToken = body.id_token?.trim();
    if (!idToken) {
      return c.json({ message: "Missing id_token" }, 400);
    }

    const googleVerifyResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );

    if (!googleVerifyResponse.ok) {
      return c.json({ message: "Invalid Google id_token" }, 401);
    }

    const tokenInfo = (await googleVerifyResponse.json()) as GoogleTokenInfo;

    if (tokenInfo.aud !== c.env.GOOGLE_CLIENT_ID) {
      return c.json({ message: "id_token audience mismatch" }, 401);
    }

    const emailVerified =
      tokenInfo.email_verified === true || tokenInfo.email_verified === "true";
    const email = normalizeEmail(tokenInfo.email);

    if (!emailVerified || !email) {
      return c.json({ message: "Google email is missing or unverified" }, 401);
    }

    const emailAllowed = await isAllowedLoginEmail(c.env, email);
    if (!emailAllowed) {
      return c.json({ message: "Login denied: unknown user", email }, 403);
    }

    const now = Math.floor(Date.now() / 1000);
    const sessionToken = await createJwt(
      {
        sub: email,
        email,
        name: typeof tokenInfo.name === "string" ? tokenInfo.name : undefined,
        picture: typeof tokenInfo.picture === "string" ? tokenInfo.picture : undefined,
        iat: now,
        exp: now + SESSION_TTL_SECONDS,
      },
      c.env.JWT_SECRET,
    );

    const useSecureCookie = isHttpsRequest(
      c.req.url,
      c.req.header("x-forwarded-proto"),
    );
    c.header("Set-Cookie", buildSessionCookie(sessionToken, useSecureCookie));

    return c.json({ authenticated: true, message: "login_ok" });
  },
};
