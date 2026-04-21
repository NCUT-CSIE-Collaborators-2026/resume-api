import type { Context } from "hono";
import type { Env } from "./app.types";
import { configService } from "./services/config.service";
import { authService } from "./services/auth.service";
import { contentService } from "./services/content.service";
import { apiDocsService } from "./services/api-docs.service";

type AppContext = Context<{ Bindings: Env }>;

/**
 * Unified service facade that aggregates all functional modules
 * - config: Configuration and utility functions
 * - auth: OAuth2 and session management
 * - content: Content and card management
 * - api-docs: OpenAPI documentation
 */
export const mainService = {
  // Re-export config service methods
  getBaseUri: (env: Env) => configService.getBaseUri(env),
  getCorsOrigins: (env: Env) => configService.getCorsOrigins(env),
  getAllowedRedirectOrigins: (env: Env) => configService.getAllowedRedirectOrigins(env),
  applyCors: (c: AppContext, next: () => Promise<void>) => configService.applyCors(c, next),

  // Re-export API docs service methods
  createOpenApiDocument: (runtimeBaseUri: string) => apiDocsService.createOpenApiDocument(runtimeBaseUri),

  // Re-export auth service methods
  googleLogin: (c: AppContext) => authService.googleLogin(c),
  googleCallback: (c: AppContext) => authService.googleCallback(c),
  session: (c: AppContext) => authService.session(c),
  logout: (c: AppContext) => authService.logout(c),
  googleMe: (c: AppContext) => authService.googleMe(c),
  tokenLogin: (c: AppContext) => authService.tokenLogin(c),

  // Re-export content service methods
  getContentI18n: (c: AppContext) => contentService.getContentI18n(c),
  updateCard: (c: AppContext) => contentService.updateCard(c),
};
