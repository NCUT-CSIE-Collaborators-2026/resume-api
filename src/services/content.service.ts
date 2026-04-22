import { asc } from "drizzle-orm";
import type { Context } from "hono";
import { getDb } from "../db/client";
import { resumeI18nContent } from "../db/schema";
import type { EditableCardRequest, Env } from "../app.types";
import { getCookieValue, verifyJwt } from "./auth.service";

type AppContext = Context<{ Bindings: Env }>;

const SESSION_COOKIE_NAME = "resume_session";

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

const mapTreeNode = (node: unknown): Record<string, unknown> | null => {
  if (typeof node !== "object" || node === null) {
    return null;
  }

  const record = node as Record<string, unknown>;
  const value = typeof record.value === "string" ? record.value : "";
  if (!value.trim()) {
    return null;
  }

  const children = Array.isArray(record.children)
    ? record.children
        .map((child) => mapTreeNode(child))
        .filter((child): child is Record<string, unknown> => child !== null)
    : [];

  return {
    type: "node",
    name: value,
    icon: typeof record.icon === "string" ? record.icon : "pi pi-circle",
    ...(children.length > 0 ? { items: children } : {}),
  };
};

const mapCardElementsToLegacyItems = (
  elements: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> => {
  if (elements.length === 0) {
    return [];
  }

  const first = elements[0];
  const elementType = typeof first.type === "string" ? first.type : "";

  if (elementType === "grid-tree") {
    const groups = Array.isArray(first.groups) ? first.groups : [];
    const mapped: Array<Record<string, unknown>> = [];
    for (const group of groups) {
      if (typeof group !== "object" || group === null) {
        continue;
      }

      const groupRecord = group as Record<string, unknown>;
      const name = typeof groupRecord.name === "string" ? groupRecord.name : "";
      if (!name.trim()) {
        continue;
      }

      const items = Array.isArray(groupRecord.items)
        ? groupRecord.items
            .map((item) => mapTreeNode(item))
            .filter((item): item is Record<string, unknown> => item !== null)
        : [];

      mapped.push({
        type: "node",
        name,
        icon:
          typeof groupRecord.icon === "string"
            ? groupRecord.icon
            : "pi pi-folder-open",
        items,
      });
    }

    return mapped;
  }

  if (elementType === "node-card") {
    const items = Array.isArray(first.items) ? first.items : [];
    return JSON.parse(JSON.stringify(items)) as Array<Record<string, unknown>>;
  }

  if (elementType === "badges") {
    const items = Array.isArray(first.items) ? first.items : [];
    return items
      .filter((item): item is string => typeof item === "string")
      .map((name) => ({ type: "badge", name }));
  }

  if (elementType === "text") {
    return [
      {
        type: "text",
        name: typeof first.text === "string" ? first.text : "",
      },
    ];
  }

  if (elementType === "icon-list") {
    const items = Array.isArray(first.items) ? first.items : [];
    const icon = typeof first.icon === "string" ? first.icon : "pi pi-circle";
    return items
      .filter((item): item is string => typeof item === "string")
      .map((name) => ({ type: "node", name, icon }));
  }

  return JSON.parse(JSON.stringify(elements)) as Array<Record<string, unknown>>;
};

const applyEditableCardUpdate = (
  payload: unknown,
  request: EditableCardRequest,
): void => {
  const card = request.card;
  const cardId = card.id.trim();
  const elements = Array.isArray(card.elements) ? card.elements : [];

  // 現行 DB payload 為陣列節點格式（name/items），更新時要回寫到該格式。
  if (Array.isArray(payload)) {
    const list = payload as Array<Record<string, unknown>>;
    const cardIndex = list.findIndex(
      (item) => typeof item === "object" && item !== null && item.id === cardId,
    );

    if (cardIndex === -1) {
      throw new Error(`Card '${cardId}' not found in payload`);
    }

    const targetCard = list[cardIndex];
    targetCard.id = cardId;
    targetCard.type = card.type.trim();
    if (typeof card.title === "string") {
      targetCard.name = card.title;
    }
    if (typeof card.subtitle === "string") {
      targetCard.subtitle = card.subtitle;
    }

    // 清除先前誤寫入的新格式欄位，避免 legacy payload 出現混合格式。
    delete targetCard.title;
    delete targetCard.elements;
    delete targetCard.layout;

    targetCard.items = mapCardElementsToLegacyItems(elements);
    return;
  } else if (typeof payload === "object" && payload !== null) {
    // 兼容舊 object payload 寫法。
    const objectPayload = payload as Record<string, unknown>;
    objectPayload[cardId] = {
      id: cardId,
      type: card.type.trim(),
      ...(typeof card.title === "string" ? { title: card.title } : {}),
      ...(typeof card.subtitle === "string" ? { subtitle: card.subtitle } : {}),
      ...(typeof card.layout === "number" ? { layout: card.layout } : {}),
      elements: elements,
    };

    storeCardContentSnapshot(objectPayload, request, elements);
    return;
  }

  throw new Error("Unsupported payload format");
};

export const contentService = {
  async getContentI18n(c: AppContext) {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");

    try {
      const db = getDb(c.env);
      const rows = await db
        .select({
          langCode: resumeI18nContent.langCode,
          payload: resumeI18nContent.payload,
        })
        .from(resumeI18nContent)
        .orderBy(asc(resumeI18nContent.langCode));

      const content: Record<string, unknown> = {};
      for (const row of rows) {
        content[row.langCode] = JSON.parse(row.payload);
      }

      if (!content.en || !content.zh_TW) {
        return c.json(
          { message: "D1 content missing required locales: en, zh_TW" },
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
  },

  async updateCard(c: AppContext) {
    if (!c.env.JWT_SECRET) {
      return c.json({ ok: false, message: "JWT_SECRET is not configured" }, 500);
    }

    const sessionToken = getCookieValue(c.req.header("Cookie"), SESSION_COOKIE_NAME);
    if (!sessionToken) {
      return c.json({ ok: false, message: "Not authenticated" }, 401);
    }

    let verification: {
      valid: boolean;
      reason?: string;
      payload?: Record<string, unknown>;
    };
    try {
      verification = await verifyJwt(sessionToken, c.env.JWT_SECRET);
    } catch {
      return c.json({ ok: false, message: "Session verification error" }, 401);
    }

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

    let payload: unknown;
    try {
      payload = JSON.parse(row.payload) as unknown;
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
  },
};
