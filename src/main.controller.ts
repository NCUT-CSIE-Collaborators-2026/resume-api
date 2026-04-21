import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { Env } from "./app.types";
import { mainService } from "./main.service";

export const mainController = new Hono<{ Bindings: Env }>();

mainController.use("*", async (c, next) => {
  return mainService.applyCors(c, next);
});

mainController.get("/", (c) => c.redirect("/docs", 302));

mainController.get("/openapi.json", (c) => {
  return c.json(mainService.createOpenApiDocument(mainService.getBaseUri(c.env)));
});

mainController.get("/docs", swaggerUI({ url: "openapi.json" }));
mainController.get("/health", (c) => c.json({ ok: true, runtime: "cloudflare-workers" }));
mainController.get("/content.i18n", async (c) => mainService.getContentI18n(c));
mainController.post("/content.card/update", async (c) => mainService.updateCard(c));

mainController.get("/auth/login", (c) => c.redirect("/auth/google/login", 302));
mainController.get("/auth/google/login", async (c) => mainService.googleLogin(c));
mainController.get("/auth/google/callback", async (c) => mainService.googleCallback(c));
mainController.get("/auth/session", async (c) => mainService.session(c));
mainController.post("/auth/logout", (c) => mainService.logout(c));
mainController.get("/auth/google/me", async (c) => mainService.googleMe(c));
mainController.post("/auth/google/token-login", async (c) => mainService.tokenLogin(c));
