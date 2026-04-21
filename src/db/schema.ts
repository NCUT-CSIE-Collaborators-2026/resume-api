import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const resumeI18nContent = sqliteTable("resume_i18n_content", {
  langCode: text("lang_code").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export type ResumeI18nContent = typeof resumeI18nContent.$inferSelect;
