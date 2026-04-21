import { cors } from "hono/cors";
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";

type Env = {
  DB: D1Database;
  API_BASE_PATH: string;
  CORS_ORIGINS: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_OAUTH_SCOPES?: string;
  GOOGLE_OAUTH_SUCCESS_REDIRECT?: string;
  GOOGLE_OAUTH_FAILURE_REDIRECT?: string;
  GOOGLE_OAUTH_DEBUG_RESPONSE?: string;
  JWT_SECRET?: string;
};

type LangCode = "en" | "zh_TW";

type EditableCardRequest = {
  lang: LangCode;
  introMode?: "30" | "60";
  card: {
    id: string;
    type: string;
    title?: string;
    subtitle?: string;
    elements?: Array<Record<string, unknown>>;
  };
};

const DEFAULT_GOOGLE_OAUTH_SCOPES = "openid email profile";
const OAUTH_STATE_TTL_SECONDS = 600;
const SESSION_COOKIE_NAME = "resume_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

const requireEnv = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`[CONFIG] Missing required env: ${name}`);
  }

  return normalized;
};

type StoredCardContentEntry = {
  id: string;
  type: string;
  title?: string;
  subtitle?: string;
  name?: string;
  headline?: string;
  text?: string;
  topics?: string[];
  elements?: Array<Record<string, unknown>>;
};

const normalizeBaseUri = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("[CONFIG] API_BASE_PATH cannot be empty");
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("[CONFIG] API_BASE_PATH cannot be '/' only");
  }

  return normalized;
};

const getBaseUri = (env: Env): string => {
  return normalizeBaseUri(requireEnv(env.API_BASE_PATH, "API_BASE_PATH"));
};

const apiApp = new Hono<{ Bindings: Env }>();

const createOpenApiDocument = (runtimeBaseUri: string) => ({
  openapi: "3.0.3",
  info: {
    title: "Resume API",
    version: "1.0.0",
    description: "Cloudflare Workers + D1 backend API for resume-skeleton",
  },
  servers: [{ url: runtimeBaseUri }],
  paths: {
    "/health": {
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
    "/content.i18n": {
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
    "/content.card/update": {
      post: {
        summary: "Update one editable resume card",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  lang: { type: "string", enum: ["en", "zh_TW"] },
                  introMode: { type: "string", enum: ["30", "60"] },
                  card: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      subtitle: { type: "string" },
                      elements: { type: "array", items: { type: "object" } },
                    },
                    required: ["id", "elements"],
                  },
                },
                required: ["lang", "card"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Card updated" },
          "400": { description: "Invalid payload" },
          "401": { description: "Not authenticated" },
          "404": { description: "Locale not found" },
          "500": { description: "Update failed" },
        },
      },
    },
    "/auth/google/login": {
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
    "/auth/google/callback": {
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
    "/auth/google/me": {
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
    "/auth/google/token-login": {
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
} as const);

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
  const binary = atob(base64 + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

const generateSignedState = async (
  secret: string,
  postLoginRedirect?: string,
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000).toString();
  const nonce = generateState();
  const encodedRedirect = postLoginRedirect
    ? encodeBase64Url(getTextBytes(postLoginRedirect))
    : "-";
  const payload = `${now}.${nonce}.${encodedRedirect}`;
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
): Promise<
  | { ok: true; postLoginRedirect: string | null }
  | { ok: false; reason: string }
> => {
  const parts = state.split(".");
  if (parts.length !== 4) {
    return { ok: false, reason: "state_format_invalid" };
  }

  const [issuedAtRaw, nonce, encodedRedirect, signature] = parts;
  const issuedAt = Number(issuedAtRaw);

  if (
    !Number.isFinite(issuedAt) ||
    issuedAt <= 0 ||
    nonce.length === 0 ||
    encodedRedirect.length === 0 ||
    signature.length === 0
  ) {
    return { ok: false, reason: "state_payload_invalid" };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  if (ageSeconds < 0 || ageSeconds > OAUTH_STATE_TTL_SECONDS) {
    return { ok: false, reason: "state_expired_or_clock_skew" };
  }

  const payload = `${issuedAtRaw}.${nonce}.${encodedRedirect}`;
  const expectedSignature = await signState(payload, secret);

  if (expectedSignature !== signature) {
    return { ok: false, reason: "state_signature_mismatch" };
  }

  if (encodedRedirect === "-") {
    return { ok: true, postLoginRedirect: null };
  }

  try {
    const redirect = decodeBase64UrlToText(encodedRedirect);
    return { ok: true, postLoginRedirect: redirect };
  } catch {
    return { ok: false, reason: "state_redirect_decode_failed" };
  }
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
  const sameSite = useSecureCookie ? "None" : "Lax";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${SESSION_TTL_SECONDS}${
    useSecureCookie ? "; Secure" : ""
  }`;
};

const clearSessionCookie = (useSecureCookie: boolean): string => {
  const sameSite = useSecureCookie ? "None" : "Lax";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${useSecureCookie ? "; Secure" : ""}`;
};

const isAllowedLoginEmail = async (
  db: D1Database,
  email: string,
): Promise<boolean> => {
  const row = await db
    .prepare(
      "SELECT lang_code FROM resume_i18n_content WHERE EXISTS (SELECT 1 FROM json_each(json_extract(payload, '$.card_content.cards')) AS card WHERE lower(json_extract(card.value, '$.type')) = 'profile' AND lower(json_extract(card.value, '$.elements[0].items[3]')) = lower(?)) LIMIT 1",
    )
    .bind(email)
    .first<{ lang_code: string }>();

  return Boolean(row?.lang_code);
};

const getElementByType = (
  elements: Array<Record<string, unknown>>,
  type: string,
): Record<string, unknown> | null => {
  for (const element of elements) {
    if (typeof element.type === "string" && element.type === type) {
      return element;
    }
  }
  return null;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const parseGroupItemValues = (element: Record<string, unknown>): string[] => {
  const groups = Array.isArray(element.groups)
    ? (element.groups as Array<Record<string, unknown>>)
    : [];

  const values: string[] = [];
  for (const group of groups) {
    const items = Array.isArray(group.items)
      ? (group.items as Array<Record<string, unknown>>)
      : [];
    for (const item of items) {
      if (typeof item.value === "string") {
        values.push(item.value);
      }
    }
  }

  return values;
};

const parseTreeGroups = (
  element: Record<string, unknown>,
): Array<{ name: string; icon: string; items: Array<{ value: string; icon: string }> }> => {
  const groups = Array.isArray(element.groups)
    ? (element.groups as Array<Record<string, unknown>>)
    : [];

  return groups
    .map((group) => {
      const name = typeof group.name === "string" ? group.name.trim() : "";
      const icon = typeof group.icon === "string" ? group.icon.trim() : "pi pi-folder-open";
      const items = Array.isArray(group.items)
        ? (group.items as Array<Record<string, unknown>>)
            .map((item) => {
              const value = typeof item.value === "string" ? item.value.trim() : "";
              const itemIcon =
                typeof item.icon === "string" && item.icon.trim().length > 0
                  ? item.icon.trim()
                  : "pi pi-check-circle";

              return {
                value,
                icon: itemIcon,
              };
            })
            .filter((item) => item.value.length > 0)
        : [];

      return {
        name,
        icon: icon.length > 0 ? icon : "pi pi-folder-open",
        items,
      };
    })
    .filter((group) => group.name.length > 0 || group.items.length > 0);
};

const getStoredCardContentKey = (request: EditableCardRequest): string => {
  return request.card.id.trim();
};

const normalizeStoredCardContentEntries = (
  value: unknown,
): StoredCardContentEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): StoredCardContentEntry | null => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const typeValue =
        typeof record.type === "string" && record.type.trim().length > 0
          ? record.type.trim()
          : "";
      if (!typeValue) {
        return null;
      }
      const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : typeValue;

      const topics = Array.isArray(record.topics)
        ? record.topics
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        : [];

      return {
        id,
        type: typeValue,
        title:
          typeof record.title === "string" && record.title.trim().length > 0
            ? record.title.trim()
            : undefined,
        subtitle:
          typeof record.subtitle === "string" && record.subtitle.trim().length > 0
            ? record.subtitle.trim()
            : undefined,
        topics,
        elements: Array.isArray(record.elements)
          ? (JSON.parse(JSON.stringify(record.elements)) as Array<Record<string, unknown>>)
          : undefined,
        name:
          typeof record.name === "string" && record.name.trim().length > 0
            ? record.name.trim()
            : undefined,
        headline:
          typeof record.headline === "string" && record.headline.trim().length > 0
            ? record.headline.trim()
            : undefined,
        text:
          typeof record.text === "string" && record.text.trim().length > 0
            ? record.text.trim()
            : undefined,
      } as StoredCardContentEntry;
    })
    .filter((entry): entry is StoredCardContentEntry => entry !== null);
};

const upsertStoredCardContentEntry = (
  entries: StoredCardContentEntry[],
  nextEntry: StoredCardContentEntry,
): StoredCardContentEntry[] => {
  const filtered = entries.filter((entry) => entry.id !== nextEntry.id);
  return [...filtered, nextEntry];
};

const storeCardContentSnapshot = (
  payload: Record<string, unknown>,
  request: EditableCardRequest,
  elements: Array<Record<string, unknown>>,
): void => {
  const cardContent =
    typeof payload.card_content === "object" && payload.card_content !== null && !Array.isArray(payload.card_content)
      ? (payload.card_content as Record<string, unknown>)
      : {};

  const key = getStoredCardContentKey(request);
  const safeElements = JSON.parse(
    JSON.stringify(elements),
  ) as Array<Record<string, unknown>>;
  const existingEntry = normalizeStoredCardContentEntries(cardContent.cards).find(
    (entry) => entry.id === key,
  );

  const nextEntry: StoredCardContentEntry = {
    id: key,
    type: request.card.type.trim(),
    ...(typeof existingEntry?.name === "string" ? { name: existingEntry.name } : {}),
    ...(typeof existingEntry?.headline === "string" ? { headline: existingEntry.headline } : {}),
    ...(typeof existingEntry?.text === "string" ? { text: existingEntry.text } : {}),
    ...(typeof request.card.title === "string"
      ? { title: request.card.title }
      : {}),
    ...(typeof request.card.subtitle === "string"
      ? { subtitle: request.card.subtitle }
      : {}),
    topics: [request.card.title, request.card.subtitle]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    elements: safeElements,
  };

  const nextCards = upsertStoredCardContentEntry(
    normalizeStoredCardContentEntries(cardContent.cards),
    nextEntry,
  );

  cardContent.cards = nextCards;

  payload.card_content = cardContent;
};

const applyEditableCardUpdate = (
  payload: Record<string, unknown>,
  request: EditableCardRequest,
): void => {
  const card = request.card;
  const elements = Array.isArray(card.elements) ? card.elements : [];

  // Persist a full snapshot for flexible card structures.
  storeCardContentSnapshot(payload, request, elements);
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
  return requireEnv(env.CORS_ORIGINS, "CORS_ORIGINS")
    .split(",")
    .map((origin: string) => origin.trim())
    .filter((origin: string) => origin.length > 0);
};

const getAllowedRedirectOrigins = (env: Env): string[] => {
  return getCorsOrigins(env)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return null;
      }
    })
    .filter((origin): origin is string => Boolean(origin));
};

apiApp.use("*", async (c, next) => {
  // Fail fast when required runtime bindings are missing.
  getBaseUri(c.env);
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

apiApp.get("/", (c) => {
  return c.redirect("/docs", 302);
});

apiApp.get("/openapi.json", (c) => {
  return c.json(createOpenApiDocument(getBaseUri(c.env)));
});

apiApp.get("/docs", swaggerUI({ url: "openapi.json" }));

apiApp.get("/health", (c) => {
  return c.json({ ok: true, runtime: "cloudflare-workers" });
});

apiApp.get("/content.i18n", async (c) => {
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");

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

apiApp.post("/content.card/update", async (c) => {
  if (!c.env.JWT_SECRET) {
    return c.json({ ok: false, message: "JWT_SECRET is not configured" }, 500);
  }

  const sessionToken = getCookieValue(
    c.req.header("Cookie"),
    SESSION_COOKIE_NAME,
  );

  if (!sessionToken) {
    return c.json({ ok: false, message: "Not authenticated" }, 401);
  }

  const verification = await verifyJwt(sessionToken, c.env.JWT_SECRET);
  if (!verification.valid) {
    return c.json({ ok: false, message: "Invalid session" }, 401);
  }

  let body: EditableCardRequest;
  try {
    body = await c.req.json<EditableCardRequest>();
  } catch {
    return c.json({ ok: false, message: "Invalid JSON body" }, 400);
  }

  if (!body?.lang || (body.lang !== "en" && body.lang !== "zh_TW")) {
    return c.json({ ok: false, message: "Invalid lang" }, 400);
  }

  if (!body.card || typeof body.card.id !== "string") {
    return c.json({ ok: false, message: "Invalid card payload" }, 400);
  }

  const row = await c.env.DB.prepare(
    "SELECT payload FROM resume_i18n_content WHERE lang_code = ? LIMIT 1",
  )
    .bind(body.lang)
    .first<{ payload: string }>();

  if (!row?.payload) {
    return c.json({ ok: false, message: "Locale not found" }, 404);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, message: "Stored payload is invalid JSON" }, 500);
  }

  try {
    applyEditableCardUpdate(payload, body);
  } catch (error) {
    return c.json(
      {
        ok: false,
        message: "Card mapping failed",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      400,
    );
  }

  const updatedPayload = JSON.stringify(payload);

  try {
    await c.env.DB.prepare(
      "UPDATE resume_i18n_content SET payload = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE lang_code = ?",
    )
      .bind(updatedPayload, body.lang)
      .run();
  } catch (error) {
    return c.json(
      {
        ok: false,
        message: "Failed to update card content",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }

  return c.json({
    ok: true,
    message: `Card ${body.card.id} updated`,
    lang: body.lang,
    cardId: body.card.id,
    content: payload,
  });
});

apiApp.get("/auth/login", (c) => {
  return c.redirect("/auth/google/login", 302);
});

apiApp.get("/auth/google/login", async (c) => {
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

  const configuredSuccessRedirect = c.env.GOOGLE_OAUTH_SUCCESS_REDIRECT?.trim();
  if (!configuredSuccessRedirect) {
    return c.json(
      {
        message: "Missing GOOGLE_OAUTH_SUCCESS_REDIRECT",
      },
      500,
    );
  }

  let configuredSuccessUrl: URL;
  try {
    configuredSuccessUrl = new URL(configuredSuccessRedirect);
  } catch {
    return c.json(
      {
        message: "Configured success redirect is not a valid URL",
      },
      500,
    );
  }

  const allowedOrigins = new Set(getAllowedRedirectOrigins(c.env));
  if (!allowedOrigins.has(configuredSuccessUrl.origin)) {
    return c.json(
      {
        message: "Configured success redirect target is not allowed by CORS_ORIGINS",
      },
      500,
    );
  }

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

apiApp.get("/auth/google/callback", async (c) => {
  const debugResponseEnabled =
    (c.env.GOOGLE_OAUTH_DEBUG_RESPONSE ?? "").toLowerCase() === "true";

  const redirectToFailure = (
    errorCode: string,
    fallbackBody: Record<string, unknown>,
    fallbackStatus: 400 | 401 | 403 | 500,
  ): Response => {
    const failureRedirect = c.env.GOOGLE_OAUTH_FAILURE_REDIRECT?.trim();
    if (!failureRedirect) {
      return c.json(fallbackBody, fallbackStatus);
    }

    let failureUrl: URL;
    try {
      failureUrl = new URL(failureRedirect);
    } catch {
      return c.json(
        {
          message: "Configured failure redirect is not a valid URL",
        },
        500,
      );
    }

    const allowedOrigins = new Set(getAllowedRedirectOrigins(c.env));
    if (!allowedOrigins.has(failureUrl.origin)) {
      return c.json(
        {
          message: "Configured failure redirect target is not allowed by CORS_ORIGINS",
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

  const requestUrl = new URL(c.req.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");

  console.log("[OAuth Callback] 收到 callback", {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    error: error ?? null,
    redirectUri: config.redirectUri,
    debugResponseEnabled,
  });

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

  const stateValidation = await validateSignedState(state, config.clientSecret);
  if (!stateValidation.ok) {
    return redirectToFailure(
      stateValidation.reason,
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

  console.log("[OAuth Callback] token exchange", {
    ok: tokenResponse.ok,
    status: tokenResponse.status,
    hasAccessToken: Boolean(tokenPayload.access_token),
    hasIdToken: Boolean(tokenPayload.id_token),
    error: tokenPayload.error ?? null,
  });

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
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    },
  );

  const profile = (await profileResponse.json()) as Record<string, unknown>;
  const email = typeof profile.email === "string" ? profile.email.trim() : "";

  console.log("[OAuth Callback] userinfo", {
    status: profileResponse.status,
    email: email || null,
    name: typeof profile.name === "string" ? profile.name : null,
  });

  if (!email) {
    return redirectToFailure(
      "google_account_email_missing",
      { message: "Google account email missing" },
      403,
    );
  }

  const emailAllowed = await isAllowedLoginEmail(c.env.DB, email);

  if (debugResponseEnabled) {
    return c.json(
      {
        debug: true,
        oauth: {
          token_exchange_status: tokenResponse.status,
          has_access_token: Boolean(tokenPayload.access_token),
          has_id_token: Boolean(tokenPayload.id_token),
          token_type: tokenPayload.token_type ?? null,
          expires_in: tokenPayload.expires_in ?? null,
        },
        google_profile: {
          email,
          name: typeof profile.name === "string" ? profile.name : null,
          picture:
            typeof profile.picture === "string" ? profile.picture : null,
        },
        access_check: {
          email_allowed_in_d1: emailAllowed,
        },
      },
      200,
    );
  }

  if (!emailAllowed) {
    return redirectToFailure(
      "login_denied_unknown_user",
      {
        message: "Login denied: unknown user",
        email,
      },
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

    const allowedOrigins = new Set(getAllowedRedirectOrigins(c.env));
    if (!allowedOrigins.has(redirectUrl.origin)) {
      return redirectToFailure(
        "success_redirect_not_allowed",
        {
          message: "Configured redirect target is not allowed by CORS_ORIGINS",
        },
        500,
      );
    }
    return c.redirect(redirectUrl.toString(), 302);
  }

  return redirectToFailure(
    "missing_oauth_success_redirect_target",
    {
      message: "Missing OAuth success redirect target",
    },
    500,
  );
});

apiApp.get("/auth/session", async (c) => {
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

  const email =
    typeof verification.payload.email === "string"
      ? verification.payload.email.trim()
      : "";
  const rawName =
    typeof verification.payload.name === "string"
      ? verification.payload.name.trim()
      : "";
  const name = rawName || email;
  const picture =
    typeof verification.payload.picture === "string" &&
    verification.payload.picture.trim().length > 0
      ? verification.payload.picture.trim()
      : null;

  return c.json({
    authenticated: true,
    user: {
      email,
      name,
      picture,
    },
  });
});

apiApp.post("/auth/logout", (c) => {
  const useSecureCookie = isHttpsRequest(
    c.req.url,
    c.req.header("x-forwarded-proto"),
  );
  c.header("Set-Cookie", clearSessionCookie(useSecureCookie));
  return c.json({ ok: true });
});

apiApp.get("/auth/google/me", async (c) => {
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

apiApp.post("/auth/google/token-login", async (c) => {
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

export default {
  async fetch(request: Request, env: Env, executionCtx: ExecutionContext) {
    const baseUri = getBaseUri(env);
    const legacyBaseUri = baseUri.replace(/\/v\d+$/, "");
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/") {
      return Response.redirect(`${url.origin}${baseUri}/docs`, 302);
    }

    const isPrimaryApiPath = pathname === baseUri || pathname.startsWith(`${baseUri}/`);
    const isLegacyGoogleCallbackPath =
      pathname === `${legacyBaseUri}/auth/google/callback`;

    if (!isPrimaryApiPath && !isLegacyGoogleCallbackPath) {
      return new Response("Not Found", { status: 404 });
    }

    const relativePath = isPrimaryApiPath
      ? pathname.slice(baseUri.length) || "/"
      : "/auth/google/callback";
    const rewrittenUrl = new URL(request.url);
    rewrittenUrl.pathname = relativePath;
    const rewrittenRequest = new Request(rewrittenUrl.toString(), request);

    return apiApp.fetch(rewrittenRequest, env, executionCtx);
  },
};
