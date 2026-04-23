export type Env = {
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
  DEV_MODE?: string;
  DEV_USER_EMAIL?: string;
  DEV_USER_NAME?: string;
};

export type LangCode = "en" | "zh_TW";

export type EditableCardRequest = {
  lang: LangCode;
  introMode?: "30" | "60";
  card: {
    id: string;
    type: string;
    name?: string;
    title?: string;
    subtitle?: string;
    layout?: number;
    items?: Array<Record<string, unknown>>;
    elements?: Array<Record<string, unknown>>;
  };
};
