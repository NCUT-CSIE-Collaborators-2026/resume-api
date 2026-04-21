import type { Env } from "./app.types";
import { mainController } from "./main.controller";
import { mainService } from "./main.service";

export type { Env } from "./app.types";

export default {
  async fetch(request: Request, env: Env, executionCtx: ExecutionContext) {
    const baseUri = mainService.getBaseUri(env);
    const legacyBaseUri = baseUri.replace(/\/v\d+$/, "");
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/") {
      return Response.redirect(`${url.origin}${baseUri}/docs`, 302);
    }

    const isPrimaryApiPath =
      pathname === baseUri || pathname.startsWith(`${baseUri}/`);
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

    return mainController.fetch(rewrittenRequest, env, executionCtx);
  },
};
