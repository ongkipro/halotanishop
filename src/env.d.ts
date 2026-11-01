/// <reference path="../.astro/types.d.ts" />
/// <reference types="@astrojs/cloudflare" />
type KVNamespace = import("@cloudflare/workers-types/index.ts").KVNamespace;
type D1Database = import("@cloudflare/workers-types/index.ts").D1Database;
type D1PreparedStatement =
  import("@cloudflare/workers-types/index.ts").D1PreparedStatement;
type D1Result<T = unknown> =
  import("@cloudflare/workers-types/index.ts").D1Result<T>;
type R2Bucket = import("@cloudflare/workers-types/index.ts").R2Bucket;
type Ai = import("@cloudflare/workers-types/index.ts").Ai;

interface SharedEnvVars {
  PUBLIC_COD_DISABLED_PROVINCES?: string;
  PUBLIC_SITE_NAME?: string;
  PUBLIC_SITE_URL?: string;
  /** Older domains of this store, comma separated; each 301s to PUBLIC_SITE_URL (lib/host-redirect.ts). */
  PUBLIC_ALIAS_HOSTS?: string;
  PUBLIC_SITE_DESCRIPTION?: string;
  PUBLIC_SITE_LOGO?: string;
  PUBLIC_SITE_BRAND_MARK?: string;
  PUBLIC_SITE_NOINDEX?: string;
  PUBLIC_SITE_TAGLINE?: string;
  PUBLIC_DEFAULT_BRAND?: string;
  PUBLIC_SITE_THEME_COLOR?: string;
  PUBLIC_SITE_LOCALE?: string;
  PUBLIC_STOREFRONT_TEMPLATE?: string;
  PUBLIC_ADMIN_NAME?: string;
  PUBLIC_EMBED_ALLOWED_ORIGINS?: string;
  PUBLIC_HEADLESS_ALLOWED_ORIGINS?: string;
  MENGANTAR_API_KEY?: string;
  AUTH_SECRET?: string;
  INSTALL_TOKEN?: string;
  /** Optional per-install HTTPS endpoint for redacted operational alerts. */
  OPS_ALERT_WEBHOOK_URL?: string;
  /** Kelola plugin fallback webhook pair; used only while the plugin is active (ADR-028). */
  KELOLA_ORDER_WEBHOOK_URL?: string;
  KELOLA_ORDER_WEBHOOK_SECRET?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  MENGANTAR_ORIGIN_AREA_ID?: string;
  MENGANTAR_PICKUP_ADDRESS_ID?: string;
  AUTOLARIS_API_KEY?: string;
  /** Numeric AutoLaris area ids used only by the `/submit` dashboard-order mirror. */
  AUTOLARIS_ORDER_ORIGIN_ID?: string;
  AUTOLARIS_ORDER_DESTINATION_ID?: string;
  /** Optional provider-required shipper email; buyer email is the fallback. */
  AUTOLARIS_SHIPPER_EMAIL?: string;
  AUTOLARIS_BASE_URL?: string;
  META_PIXEL_ID?: string;
  META_CAPI_ACCESS_TOKEN?: string;
  META_CAPI_TOKEN?: string;
  NEXT_PUBLIC_FB_PIXEL_ID?: string;
  PUBLIC_FB_PIXEL_ID?: string;
  FB_PIXEL_ID?: string;
  GOOGLE_ADS_CONVERSION_ID?: string;
  GOOGLE_ADS_CONVERSION_LABEL?: string;
  NEXT_PUBLIC_GTM_ID?: string;
  PUBLIC_GTM_ID?: string;
  GTM_ID?: string;
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
  GOOGLE_ADS_REFRESH_TOKEN?: string;
  /** ISO timestamp; prevents accidental historical conversion backfill. */
  GOOGLE_ADS_OFFLINE_START_AT?: string;
}

interface CloudflareRuntimeEnv extends SharedEnvVars {
  SESSION: KVNamespace;
  OMS_DB: D1Database;
  ASSET_BUCKET: R2Bucket;
  AI: Ai;
  ASSETS: unknown;
}
declare namespace Cloudflare {
  interface Env extends CloudflareRuntimeEnv {}
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}


declare namespace App {
  interface Locals {
    runtimeEnv?: CloudflareRuntimeEnv | Record<string, unknown>;
    /**
     * Store identity, resolved once per request in middleware from the `stores`
     * row with environment fallback. Read this instead of importing a
     * build-time constant — see DECISIONS.md ADR-003.
     */
    tenant: import("./lib/tenant").PublicTenantConfig;
    admin?: {
      username: string;
      role: import("./lib/auth").AdminRole;
      mustChangePassword: boolean;
    };
  }
}
