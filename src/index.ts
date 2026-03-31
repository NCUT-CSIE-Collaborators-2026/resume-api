import { cors } from "hono/cors";
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";

type Env = {
  DB: D1Database;
  CORS_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_OAUTH_SCOPES?: string;
  GOOGLE_OAUTH_SUCCESS_REDIRECT?: string;
  GOOGLE_OAUTH_FAILURE_REDIRECT?: string;
  JWT_SECRET?: string;
};

const DEFAULT_CORS_ORIGINS =
  "http://localhost:4200,https://haolun-wang.pages.dev";
const DEFAULT_GOOGLE_OAUTH_SCOPES = "openid email profile";
const OAUTH_STATE_TTL_SECONDS = 600;
const SESSION_COOKIE_NAME = "resume_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

const app = new Hono<{ Bindings: Env }>();

const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Resume API",
    version: "1.0.0",
    description: "Cloudflare Workers + D1 backend API for resume-skeleton",
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/resume/health": {
      get: {
        summary: "Health check",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    runtime: {
                      type: "string",
                      example: "cloudflare-workers",
                    },
                  },
                  required: ["ok", "runtime"],
                },
              },
            },
          },
        },
      },
    },
    "/api/resume/content.i18n": {
      get: {
        summary: "Get i18n resume content",
        responses: {
          "200": {
            description: "Localized resume payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    en: { type: "object", additionalProperties: true },
                    zh_TW: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "500": {
            description: "Content query failed",
          },
        },
      },
    },
    "/api/resume/auth/google/login": {
      get: {
        summary: "Start Google OAuth login",
        responses: {
          "302": {
            description: "Redirect to Google OAuth consent screen",
          },
          "500": {
            description: "Google OAuth is not configured",
          },
        },
      },
    },
    "/api/resume/auth/google/callback": {
      get: {
        summary: "Handle Google OAuth callback",
        responses: {
          "200": {
            description: "OAuth exchange succeeded",
          },
          "400": {
            description: "Invalid OAuth request",
          },
          "500": {
            description: "OAuth exchange failed",
          },
        },
      },
    },
    "/api/resume/auth/google/me": {
      get: {
        summary: "Fetch Google profile using access token",
        responses: {
          "200": {
            description: "Google profile",
          },
          "400": {
            description: "Missing access token",
          },
        },
      },
    },
    "/api/resume/auth/google/token-login": {
      post: {
        summary: "Login with Google ID token (no OAuth callback)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id_token: { type: "string" },
                },
                required: ["id_token"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Login succeeded and session cookie set",
          },
          "400": {
            description: "Missing id_token",
          },
          "401": {
            description: "Invalid id_token",
          },
          "403": {
            description: "Unknown user email",
          },
          "500": {
            description: "Server config missing",
          },
        },
      },
    },
  },
} as const;

const encodeBase64Url = (bytes: Uint8Array): string => {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const decodeBase64UrlToText = (input: string): string => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return atob(base64 + padding);
};

const generateState = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
};

const getTextBuffer = (input: string): ArrayBuffer => {
  return new TextEncoder().encode(input).buffer as ArrayBuffer;
};

const getTextBytes = (input: string): Uint8Array => {
  return new TextEncoder().encode(input);
};

const signState = async (payload: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    getTextBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    getTextBuffer(payload),
  );
  return encodeBase64Url(new Uint8Array(signatureBuffer));
};

const generateSignedState = async (secret: string): Promise<string> => {
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = generateState();
  const payload = `${now}.${nonce}`;
  const signature = await signState(payload, secret);

  return `${payload}.${signature}`;
};

const signHmacSha256 = async (
  text: string,
  secret: string,
): Promise<string> => {
  return signState(text, secret);
};

const createJwt = async (
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> => {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = encodeBase64Url(getTextBytes(JSON.stringify(header)));
  const encodedPayload = encodeBase64Url(getTextBytes(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHmacSha256(signingInput, secret);
  return `${signingInput}.${signature}`;
};

const verifyJwt = async (
  token: string,
  secret: string,
): Promise<
  | { valid: true; payload: Record<string, unknown> }
  | { valid: false; reason: string }
> => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "token_format_invalid" };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = await signHmacSha256(signingInput, secret);
  if (expectedSignature !== signature) {
    return { valid: false, reason: "token_signature_invalid" };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(decodeBase64UrlToText(encodedPayload)) as Record<
      string,
      unknown
    >;
  } catch {
    return { valid: false, reason: "token_payload_invalid" };
  }

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) >= exp) {
    return { valid: false, reason: "token_expired" };
  }

  return { valid: true, payload };
};

const validateSignedState = async (
  state: string,
  secret: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const parts = state.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "state_format_invalid" };
  }

  const [issuedAtRaw, nonce, signature] = parts;
  const issuedAt = Number(issuedAtRaw);

  if (
    !Number.isFinite(issuedAt) ||
    issuedAt <= 0 ||
    nonce.length === 0 ||
    signature.length === 0
  ) {
    return { ok: false, reason: "state_payload_invalid" };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  if (ageSeconds < 0 || ageSeconds > OAUTH_STATE_TTL_SECONDS) {
    return { ok: false, reason: "state_expired_or_clock_skew" };
  }

  const payload = `${issuedAtRaw}.${nonce}`;
  const expectedSignature = await signState(payload, secret);

  if (expectedSignature !== signature) {
    return { ok: false, reason: "state_signature_mismatch" };
  }

  return { ok: true };
};

const getCookieValue = (
  cookieHeader: string | undefined,
  name: string,
): string | null => {
  if (!cookieHeader) {
    return null;
  }

  const entries = cookieHeader.split(";");
  for (const entry of entries) {
    const [rawKey, ...rest] = entry.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
};

const isHttpsRequest = (
  requestUrl: string,
  forwardedProto?: string,
): boolean => {
  if (forwardedProto) {
    return forwardedProto.toLowerCase() === "https";
  }

  return new URL(requestUrl).protocol === "https:";
};

const buildSessionCookie = (
  token: string,
  useSecureCookie: boolean,
): string => {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${
    useSecureCookie ? "; Secure" : ""
  }`;
};

const clearSessionCookie = (useSecureCookie: boolean): string => {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${useSecureCookie ? "; Secure" : ""}`;
};

const isAllowedLoginEmail = async (
  db: D1Database,
  email: string,
): Promise<boolean> => {
  const row = await db
    .prepare(
      "SELECT lang_code FROM resume_i18n_content WHERE lower(json_extract(payload, '$.profile.email')) = lower(?) LIMIT 1",
    )
    .bind(email)
    .first<{ lang_code: string }>();

  return Boolean(row?.lang_code);
};

const getGoogleOAuthConfig = (
  env: Env,
): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
} | null => {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return null;
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    scopes: env.GOOGLE_OAUTH_SCOPES ?? DEFAULT_GOOGLE_OAUTH_SCOPES,
  };
};

const getCorsOrigins = (env: Env): string[] => {
  return (env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

app.use("*", async (c, next) => {
  const corsOrigins = getCorsOrigins(c.env);
  const corsOriginOption =
    corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins;

  const corsMiddleware = cors({
    origin: corsOriginOption,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  });

  return corsMiddleware(c, next);
});

app.get("/", (c) => {
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return c.json({
    name: "resume-api",
    version: "1.0.0",
    runtime: "cloudflare-workers",
    docs_url: `${baseUrl}/api/resume/docs`,
    openapi_url: `${baseUrl}/api/resume/openapi.json`,
    health_url: `${baseUrl}/api/resume/health`,
  });
});

app.get("/api/resume/openapi.json", (c) => {
  return c.json(openApiDocument);
});

app.get("/api/resume/docs", swaggerUI({ url: "/api/resume/openapi.json" }));

app.get("/api/resume/health", (c) => {
  return c.json({ ok: true, runtime: "cloudflare-workers" });
});

app.get("/api/resume/content.i18n", async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      "SELECT lang_code, payload FROM resume_i18n_content ORDER BY lang_code",
    ).all<{ lang_code: string; payload: string }>();

    const content: Record<string, unknown> = {};
    for (const row of rows.results ?? []) {
      content[row.lang_code] = JSON.parse(row.payload);
    }

    if (!content.en || !content.zh_TW) {
      return c.json(
        {
          message: "D1 content missing required locales: en, zh_TW",
        },
        500,
      );
    }

    return c.json(content);
  } catch (error) {
    return c.json(
      {
        message: "Failed to read i18n content from D1",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

app.get("/api/resume/auth/login", (c) => {
  return c.redirect("/api/resume/auth/google/login", 302);
});

app.get("/api/resume/auth/google/login", async (c) => {
  console.log("[OAuth Login] 收到登入請求");
  console.log("[OAuth Login] 環境變數檢查:");
  console.log(
    "[OAuth Login]   GOOGLE_CLIENT_ID:",
    c.env.GOOGLE_CLIENT_ID ? "✓ 存在" : "✗ 缺少",
  );
  console.log(
    "[OAuth Login]   GOOGLE_CLIENT_SECRET:",
    c.env.GOOGLE_CLIENT_SECRET ? "✓ 存在" : "✗ 缺少",
  );
  console.log(
    "[OAuth Login]   GOOGLE_REDIRECT_URI:",
    c.env.GOOGLE_REDIRECT_URI || "✗ 缺少",
  );

  const config = getGoogleOAuthConfig(c.env);
  if (!config) {
    console.error("[OAuth Login] ✗ 設定缺失，回傳 500");
    return c.json(
      {
        message:
          "Google OAuth config missing. Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI",
      },
      500,
    );
  }

  console.log("[OAuth Login] ✓ 設定成功載入");
  console.log("[OAuth Login] clientId:", config.clientId);
  console.log("[OAuth Login] redirectUri:", config.redirectUri);
  console.log("[OAuth Login] scopes:", config.scopes);

  const state = await generateSignedState(config.clientSecret);
  console.log("[OAuth Login] ✓ 產生 state:", state.substring(0, 20) + "...");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", config.clientId);
  console.log("[OAuth Login]   ✓ 設定 client_id");

  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  console.log("[OAuth Login]   ✓ 設定 redirect_uri");

  authUrl.searchParams.set("response_type", "code");
  console.log("[OAuth Login]   ✓ 設定 response_type");

  authUrl.searchParams.set("scope", config.scopes);
  console.log("[OAuth Login]   ✓ 設定 scope");

  authUrl.searchParams.set("state", state);
  console.log("[OAuth Login]   ✓ 設定 state");

  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  console.log("[OAuth Login]   ✓ 設定 access_type 和 prompt");

  const finalUrl = authUrl.toString();
  console.log("[OAuth Login] ✓ 完整 URL:", finalUrl.substring(0, 100) + "...");
  console.log("[OAuth Login] 即將重導到 Google OAuth");

  return c.redirect(finalUrl, 302);
});

app.get("/api/resume/auth/google/callback", async (c) => {
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

  const requestUrl = new URL(c.req.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");

  if (error) {
    const failureRedirect = c.env.GOOGLE_OAUTH_FAILURE_REDIRECT;
    if (failureRedirect) {
      return c.redirect(
        `${failureRedirect}?error=${encodeURIComponent(error)}`,
        302,
      );
    }

    return c.json({ message: "Google OAuth denied", error }, 400);
  }

  if (!code || !state) {
    return c.json({ message: "Missing OAuth code or state" }, 400);
  }

  const stateValidation = await validateSignedState(state, config.clientSecret);
  if (!stateValidation.ok) {
    return c.json(
      {
        message: "Invalid OAuth state",
        reason: stateValidation.reason,
      },
      400,
    );
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    id_token?: string;
    refresh_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return c.json(
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
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    },
  );

  const profile = (await profileResponse.json()) as Record<string, unknown>;
  const email = typeof profile.email === "string" ? profile.email.trim() : "";

  if (!email) {
    return c.json({ message: "Google account email missing" }, 403);
  }

  const emailAllowed = await isAllowedLoginEmail(c.env.DB, email);
  if (!emailAllowed) {
    return c.json(
      {
        message: "Login denied: unknown user",
        email,
      },
      403,
    );
  }

  if (!c.env.JWT_SECRET) {
    return c.json({ message: "JWT_SECRET is not configured" }, 500);
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

  const successRedirect = c.env.GOOGLE_OAUTH_SUCCESS_REDIRECT;
  if (successRedirect) {
    const redirectUrl = new URL(successRedirect);
    redirectUrl.searchParams.set("login", "ok");
    return c.redirect(redirectUrl.toString(), 302);
  }

  return c.json({
    authenticated: true,
    message: "login_ok",
  });
});

app.get("/api/resume/auth/session", async (c) => {
  const jwtSecret = c.env.JWT_SECRET;
  if (!jwtSecret) {
    return c.json(
      { authenticated: false, message: "JWT_SECRET is not configured" },
      500,
    );
  }

  const sessionToken = getCookieValue(
    c.req.header("Cookie"),
    SESSION_COOKIE_NAME,
  );
  if (!sessionToken) {
    return c.json({ authenticated: false }, 200);
  }

  const verification = await verifyJwt(sessionToken, jwtSecret);
  if (!verification.valid) {
    return c.json({ authenticated: false, reason: verification.reason }, 200);
  }

  return c.json({
    authenticated: true,
    user: {
      email: verification.payload.email,
      name: verification.payload.name,
      picture: verification.payload.picture,
    },
  });
});

app.post("/api/resume/auth/logout", (c) => {
  const useSecureCookie = isHttpsRequest(
    c.req.url,
    c.req.header("x-forwarded-proto"),
  );
  c.header("Set-Cookie", clearSessionCookie(useSecureCookie));
  return c.json({ ok: true });
});

app.get("/api/resume/auth/google/me", async (c) => {
  const accessToken = c.req.query("access_token");

  if (!accessToken) {
    return c.json({ message: "Missing access_token query param" }, 400);
  }

  const profileResponse = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const profile = await profileResponse.json();
  return c.json(profile, profileResponse.status as 200 | 400 | 401 | 500);
});

app.post("/api/resume/auth/google/token-login", async (c) => {
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

  const tokenInfo = (await googleVerifyResponse.json()) as {
    aud?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
  };

  if (tokenInfo.aud !== c.env.GOOGLE_CLIENT_ID) {
    return c.json({ message: "id_token audience mismatch" }, 401);
  }

  const emailVerified =
    tokenInfo.email_verified === true || tokenInfo.email_verified === "true";
  const email = tokenInfo.email?.trim() ?? "";

  if (!emailVerified || !email) {
    return c.json({ message: "Google email is missing or unverified" }, 401);
  }

  const emailAllowed = await isAllowedLoginEmail(c.env.DB, email);
  if (!emailAllowed) {
    return c.json(
      {
        message: "Login denied: unknown user",
        email,
      },
      403,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionToken = await createJwt(
    {
      sub: email,
      email,
      name: tokenInfo.name,
      picture: tokenInfo.picture,
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

  return c.json({
    authenticated: true,
    message: "login_ok",
  });
});

export default app;
