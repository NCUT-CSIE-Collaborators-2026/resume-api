import { cors } from "hono/cors";
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";

type Env = {
  DB: D1Database;
  CORS_ORIGINS?: string;
};

const DEFAULT_CORS_ORIGINS =
  "http://localhost:4200,https://haolun-wang.pages.dev";

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
  },
} as const;

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

export default app;
