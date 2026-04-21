import { cors } from "hono/cors";
import type { Context } from "hono";
import type { Env } from "../app.types";

type AppContext = Context<{ Bindings: Env }>;

const requireEnv = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`[CONFIG] Missing required env: ${name}`);
  }
  return normalized;
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

export const getGoogleOAuthConfig = (
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
    scopes: env.GOOGLE_OAUTH_SCOPES ?? "openid email profile",
  };
};

export const encodeBase64Url = (bytes: Uint8Array): string => {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

export const decodeBase64UrlToText = (input: string): string => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const getTextBuffer = (input: string): ArrayBuffer => {
  return new TextEncoder().encode(input).buffer as ArrayBuffer;
};

export const getTextBytes = (input: string): Uint8Array => {
  return new TextEncoder().encode(input);
};

export const isHttpsRequest = (
  requestUrl: string,
  forwardedProto?: string,
): boolean => {
  if (forwardedProto) {
    return forwardedProto === "https";
  }
  try {
    return new URL(requestUrl).protocol === "https:";
  } catch {
    return false;
  }
};

export const configService = {
  getBaseUri(env: Env): string {
    return normalizeBaseUri(requireEnv(env.API_BASE_PATH, "API_BASE_PATH"));
  },

  getCorsOrigins(env: Env): string[] {
    return requireEnv(env.CORS_ORIGINS, "CORS_ORIGINS")
      .split(",")
      .map((origin: string) => origin.trim())
      .filter((origin: string) => origin.length > 0);
  },

  getAllowedRedirectOrigins(env: Env): string[] {
    return this.getCorsOrigins(env)
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return null;
        }
      })
      .filter((origin): origin is string => Boolean(origin));
  },

  async applyCors(c: AppContext, next: () => Promise<void>) {
    this.getBaseUri(c.env);
    const corsOrigins = this.getCorsOrigins(c.env);
    const corsOriginOption = corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins;

    const corsMiddleware = cors({
      origin: corsOriginOption,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      credentials: true,
    });

    return corsMiddleware(c, next);
  },
};
