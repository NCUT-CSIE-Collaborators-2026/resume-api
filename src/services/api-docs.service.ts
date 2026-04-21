export const apiDocsService = {
  createOpenApiDocument(runtimeBaseUri: string) {
    return {
      openapi: "3.0.3",
      info: {
        title: "Resume API",
        version: "1.0.0",
        description: `Cloudflare Workers + D1 backend API for resume-skeleton.
        
## Architecture

**Services**: Modular service-oriented design with clear separation of concerns:
- **config.service.ts**: Configuration management, CORS validation, environment parsing
- **auth.service.ts**: OAuth2 (Google), JWT session management, token validation
- **content.service.ts**: i18n resume content, editable card updates
- **api-docs.service.ts**: OpenAPI documentation generation

**Layers**:
- index.ts (35 lines) → Entry point with path rewriting
- main.controller.ts (20 lines) → Route definitions
- main.service.ts (40 lines) → Service facade
- services/ (1185 lines) → Functional modules

**Database**: Drizzle ORM + D1 SQLite (migrations in drizzle/migrations)
**Auth**: Google OAuth2 + HS256 JWT (8-hour TTL) + HMAC-signed state (10-min TTL)
**Security**: Email allowlist in D1, session cookies (HttpOnly, SameSite=Lax, Secure)`,
      },
      servers: [{ url: runtimeBaseUri }],
      tags: [
        { name: "Health", description: "Service health checks" },
        { name: "Content", description: "Resume content and editable cards" },
        { name: "Auth", description: "Authentication and session management" },
      ],
      paths: {
        "/health": {
          get: {
            tags: ["Health"],
            summary: "Service health check",
            description: "Verify the API is running and healthy",
            responses: {
              "200": {
                description: "Service is healthy",
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { ok: { type: "boolean" }, runtime: { type: "string" } } },
                    example: { ok: true, runtime: "cloudflare-workers" },
                  },
                },
              },
            },
          },
        },
        "/content.i18n": {
          get: {
            tags: ["Content"],
            summary: "Get i18n resume content",
            description: "Fetch all localized resume payloads (en, zh_TW) from D1",
            responses: {
              "200": {
                description: "Localized resume content retrieved",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        en: { type: "object", description: "English resume payload" },
                        zh_TW: { type: "object", description: "Traditional Chinese resume payload" },
                      },
                    },
                  },
                },
              },
              "500": {
                description: "Failed to read content from D1 or missing required locales",
              },
            },
          },
        },
        "/content.card/update": {
          post: {
            tags: ["Content"],
            summary: "Update one editable resume card",
            description: "Requires valid JWT session cookie (from /auth/google/callback or /auth/google/token-login)",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      lang: { type: "string", enum: ["en", "zh_TW"], description: "Target language" },
                      card: {
                        type: "object",
                        properties: {
                          id: { type: "string", description: "Card unique identifier" },
                          type: { type: "string", description: "Card type (e.g. 'experience', 'education')" },
                          title: { type: "string", description: "Card title" },
                          subtitle: { type: "string", description: "Card subtitle" },
                          elements: { type: "array", description: "Card content elements" },
                        },
                        required: ["id", "type"],
                      },
                    },
                    required: ["lang", "card"],
                  },
                },
              },
            },
            responses: {
              "200": { description: "Card updated successfully" },
              "400": { description: "Invalid payload or invalid lang/card structure" },
              "401": { description: "Not authenticated (missing or invalid session cookie)" },
              "404": { description: "Locale not found in D1" },
              "500": { description: "D1 update failed or JWT_SECRET not configured" },
            },
          },
        },
        "/auth/google/login": {
          get: {
            tags: ["Auth"],
            summary: "Start Google OAuth login",
            description: "Initiate OAuth2 flow. Redirects to Google consent screen with PKCE state.",
            responses: {
              "302": {
                description: "Redirect to Google OAuth consent screen (https://accounts.google.com/o/oauth2/v2/auth)",
              },
              "500": {
                description: "Google OAuth config missing (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_OAUTH_SUCCESS_REDIRECT)",
              },
            },
          },
        },
        "/auth/google/callback": {
          get: {
            tags: ["Auth"],
            summary: "Handle Google OAuth callback",
            description: "Callback endpoint for Google OAuth. Exchanges auth code for access token, validates email against D1 allowlist, issues JWT session cookie.",
            parameters: [
              { name: "code", in: "query", required: true, schema: { type: "string" }, description: "OAuth authorization code" },
              { name: "state", in: "query", required: true, schema: { type: "string" }, description: "HMAC-signed state for CSRF protection" },
            ],
            responses: {
              "302": { description: "Redirect to GOOGLE_OAUTH_SUCCESS_REDIRECT on success, or GOOGLE_OAUTH_FAILURE_REDIRECT on failure" },
              "200": { description: "OAuth debug response (if GOOGLE_OAUTH_DEBUG_RESPONSE=true)" },
              "400": { description: "Invalid OAuth code, state, or email verification failed" },
              "403": { description: "Email not in D1 allowlist or unverified" },
              "500": { description: "Token exchange failed, redirect URL invalid, or config missing" },
            },
          },
        },
        "/auth/session": {
          get: {
            tags: ["Auth"],
            summary: "Verify current session",
            description: "Check if session cookie is valid and return authenticated user info",
            responses: {
              "200": {
                description: "Session status (authenticated or not)",
                content: {
                  "application/json": {
                    schema: {
                      oneOf: [
                        {
                          type: "object",
                          properties: {
                            authenticated: { type: "boolean", enum: [false] },
                            reason: { type: "string", enum: ["no_session_cookie", "invalid_jwt_signature", "jwt_expired"] },
                          },
                        },
                        {
                          type: "object",
                          properties: {
                            authenticated: { type: "boolean", enum: [true] },
                            user: {
                              type: "object",
                              properties: {
                                email: { type: "string" },
                                name: { type: "string" },
                                picture: { type: ["string", "null"] },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
              "500": { description: "JWT_SECRET not configured" },
            },
          },
        },
        "/auth/logout": {
          post: {
            tags: ["Auth"],
            summary: "Logout and clear session",
            description: "Clear session cookie (Max-Age=0)",
            responses: {
              "200": {
                description: "Session cleared",
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { ok: { type: "boolean" } } },
                  },
                },
              },
            },
          },
        },
        "/auth/google/me": {
          get: {
            tags: ["Auth"],
            summary: "Fetch Google profile using access token",
            description: "Proxy call to Google API with provided access token",
            parameters: [
              { name: "access_token", in: "query", required: true, schema: { type: "string" }, description: "Google OAuth access token" },
            ],
            responses: {
              "200": { description: "Google profile object (https://www.googleapis.com/oauth2/v3/userinfo)" },
              "400": { description: "Missing access_token parameter" },
              "401": { description: "Invalid or expired access token" },
            },
          },
        },
        "/auth/google/token-login": {
          post: {
            tags: ["Auth"],
            summary: "Login with Google ID token (alternative OAuth flow)",
            description: "Alternative to /auth/google/callback. Validates Google ID token directly without code exchange. Skips OAuth callback redirect.",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id_token: { type: "string", description: "Google ID token (from Google Sign-In client library)" },
                    },
                    required: ["id_token"],
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Login succeeded and session cookie set",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        authenticated: { type: "boolean", enum: [true] },
                        message: { type: "string", enum: ["login_ok"] },
                      },
                    },
                  },
                },
              },
              "400": { description: "Missing or invalid id_token body" },
              "401": { description: "Invalid Google id_token or unverified email" },
              "403": { description: "Email not in D1 allowlist" },
              "500": { description: "GOOGLE_CLIENT_ID or JWT_SECRET not configured" },
            },
          },
        },
      },
    } as const;
  },
};
