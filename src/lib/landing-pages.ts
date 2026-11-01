import { getRuntimeEnv } from "./env.ts";
import { formatIdr } from "./format-idr.ts";
import { solutionEntries } from "../data/content.ts";
import {
  installRouteSlugs,
  nativeLandingPages,
} from "../data/native-landing-pages.ts";
import {
  activeNativeLandingPages,
  isNativeLandingId,
  nativeLandingIdFor,
  type NativeLandingPage,
} from "./native-landing-pages.ts";

type D1Statement = ReturnType<D1Database["prepare"]>;
export type LandingSectionType =
  | "html"
  | "form"
  | "headline"
  | "paragraph"
  | "numbered_list"
  | "bullet_list"
  | "image";

export type LandingContentConfig =
  | {
      text: string;
      align?: "left" | "center" | "right";
      size?: "small" | "medium" | "large";
    }
  | { items: string[] }
  | { src: string; alt: string };

export type LandingFormConfig = {
  mode?: "hybrid" | "middle" | "full";
  selected_variant_id?: string;
  section_title?: string;
  button_text?: string;
};

export type LandingSection = {
  id: string;
  landing_page_id: string;
  sort_order: number;
  type: LandingSectionType;
  content_html: string | null;
  form_config: LandingFormConfig | null;
  content_config: LandingContentConfig | null;
  created_at: string;
  updated_at: string;
};

export type LandingPage = {
  id: string;
  slug: string;
  title: string;
  product_id: string;
  product_title?: string | null;
  product_slug?: string | null;
  is_active: number;
  /** 1 when this page has taken over `/produk/<product-slug>` (A21). */
  is_product_page: number;
  /** `native` rows mirror a route file and are not editable in the CMS. */
  source?: "cms" | "native";
  meta_title: string | null;
  meta_description: string | null;
  created_at: string;
  updated_at: string;
  sections: LandingSection[];
  /** List thumbnail: the page's own first image, else its product's photo. */
  thumbnail?: string | null;
};

const staticLandingPages: LandingPage[] = solutionEntries.map((entry) => ({
  id: `static:${entry.slug}`,
  slug: entry.slug,
  title: entry.title,
  product_id: "",
  product_title: null,
  is_active: entry.isAvailable === false ? 0 : 1,
  // A hand-authored static page has no product to take over.
  is_product_page: 0,
  meta_title: entry.title,
  meta_description: entry.excerpt,
  created_at: "",
  updated_at: "",
  sections: [],
}));

export type LandingSectionInput = {
  id?: string;
  sort_order?: number;
  type: LandingSectionType;
  content_html?: string | null;
  form_config?: LandingFormConfig | null;
  content_config?: LandingContentConfig | null;
};

export type CreateLandingPageInput = {
  slug: string;
  title: string;
  product_id: string;
  is_active?: boolean | number;
  meta_title?: string | null;
  meta_description?: string | null;
  sections?: LandingSectionInput[];
};

export type UpdateLandingPageInput = Partial<CreateLandingPageInput>;

export type LandingPageDuplicatePayload = {
  action: "duplicate";
  id: string;
};

type LandingPageDuplicateParseResult =
  | { value: LandingPageDuplicatePayload }
  | { error: string };

export function parseLandingPageDuplicatePayload(
  input: unknown,
): LandingPageDuplicateParseResult | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  if (record.action !== "duplicate") return null;
  if (typeof record.id !== "string" || !record.id.trim()) {
    return { error: "Landing page ID is required" };
  }
  if (record.id.startsWith("static:")) {
    return { error: "Static landing pages cannot be duplicated" };
  }

  return {
    value: {
      action: "duplicate",
      id: record.id.trim(),
    },
  };
}

export function buildLandingPageDuplicateInput(
  source: LandingPage,
): CreateLandingPageInput {
  return {
    slug: `${source.slug}-copy`,
    title: `${source.title} (Copy)`,
    product_id: source.product_id,
    is_active: source.is_active,
    meta_title: source.meta_title,
    meta_description: source.meta_description,
    sections: source.sections.map((section) => ({
      sort_order: section.sort_order,
      type: section.type,
      content_html: section.content_html,
      form_config: section.form_config ? { ...section.form_config } : null,
      content_config: section.content_config ? structuredClone(section.content_config) : null,
    })),
  };
}

type LandingPageRow = Omit<LandingPage, "sections">;
type LandingSectionRow = Omit<LandingSection, "content_config" | "form_config"> & {
  content_config: string | null;
  form_config: string | null;
};

type LocalsWithDatabase = {
  OMS_DB?: D1Database;
};

const PAGE_COLUMNS = `
  id, slug, title, product_id, is_active, is_product_page, source,
  meta_title, meta_description, created_at, updated_at
`;

const SECTION_COLUMNS = `
  id, landing_page_id, sort_order, type, content_html,
  form_config, content_config, created_at, updated_at
`;

function getDatabase(locals: App.Locals): D1Database {
  const localBindings = locals as unknown as LocalsWithDatabase;
  const database =
    localBindings.OMS_DB ??
    (getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined);

  if (!database || typeof database.prepare !== "function") {
    throw new Error("OMS_DB binding is unavailable");
  }

  return database;
}

function parseFormConfig(value: string | null): LandingFormConfig | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as LandingFormConfig)
      : null;
  } catch {
    return null;
  }
}

function parseContentConfig(value: string | null): LandingContentConfig | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as LandingContentConfig : null;
  } catch {
    return null;
  }
}

function mapSection(row: LandingSectionRow): LandingSection {
  return {
    ...row,
    form_config: parseFormConfig(row.form_config),
    content_config: parseContentConfig(row.content_config),
  };
}

function attachSections(
  pages: LandingPageRow[],
  sectionRows: LandingSectionRow[],
): LandingPage[] {
  const sectionsByPage = new Map<string, LandingSection[]>();

  for (const row of sectionRows) {
    const sections = sectionsByPage.get(row.landing_page_id) ?? [];
    sections.push(mapSection(row));
    sectionsByPage.set(row.landing_page_id, sections);
  }

  return pages.map((page) => ({
    ...page,
    sections: sectionsByPage.get(page.id) ?? [],
  }));
}

function serializeFormConfig(config: LandingFormConfig | null | undefined) {
  return config ? JSON.stringify(config) : null;
}

function serializeContentConfig(config: LandingContentConfig | null | undefined) {
  return config ? JSON.stringify(config) : null;
}

/**
 * Operator input that the CMS refuses, as opposed to something that went wrong.
 *
 * Everything here used to throw a bare `Error`, and both admin routes render a
 * bare `Error` as HTTP 500 "Failed to create/update landing page: <message>".
 * So an operator who left the title empty, reused a slug, or typed a `<` into a
 * headline was told the server had broken. The typed section kinds multiply
 * that surface, which is why it is worth a type: a refusal the caller can act
 * on is a 400 (or a 409 for a slug someone else holds), never a 500.
 */
export class LandingPageValidationError extends Error {
  readonly status: 400 | 409;
  constructor(message: string, status: 400 | 409 = 400) {
    super(message);
    this.name = "LandingPageValidationError";
    this.status = status;
  }
}

function normalizeActive(value: boolean | number | undefined, fallback = 1) {
  if (value === undefined) return fallback;
  return value === true || value === 1 ? 1 : 0;
}

/**
 * Bounds on everything an operator can store on a landing page.
 *
 * The public checkout schema (`order-schema.ts`) bounds every field it takes;
 * this path bounded none of them. `title`, `meta_title` and `meta_description`
 * were written straight through — untrimmed and unlimited — and two of them
 * ship inside `<title>` and `<meta name="description">` on every render of that
 * page. Astro escapes them, so this was never an injection; it was an
 * unbounded body on a page ads point at.
 *
 * The numbers are the ones already used elsewhere rather than new opinions:
 * 200 is `content_name`'s cap in `meta-event-contract.ts`, 500 is `address`'s
 * in `order-schema.ts`.
 */
const LANDING_TITLE_MAX = 200;
const LANDING_META_DESCRIPTION_MAX = 500;
/** One legacy HTML section. Generous — it is a whole page's markup — but finite. */
const LANDING_HTML_MAX = 100_000;
/** Sections per page. Every one is a statement in a single D1 batch. */
const LANDING_SECTIONS_MAX = 60;
const LANDING_TEXT_MAX = 2_000;
const LANDING_LIST_ITEMS_MAX = 50;
const LANDING_FORM_MODES = ["hybrid", "middle", "full"] as const;

function boundedText(
  value: string | null | undefined,
  max: number,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new LandingPageValidationError(`${label} maksimal ${max} karakter.`);
  }
  return trimmed;
}

function requiredTitle(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new LandingPageValidationError("Judul landing page wajib diisi.");
  if (trimmed.length > LANDING_TITLE_MAX) {
    throw new LandingPageValidationError(`Judul landing page maksimal ${LANDING_TITLE_MAX} karakter.`);
  }
  return trimmed;
}

function validateSections(sections: LandingSectionInput[] | undefined) {
  if (!sections) return;
  if (sections.length > LANDING_SECTIONS_MAX) {
    throw new LandingPageValidationError(
      `Maksimal ${LANDING_SECTIONS_MAX} section per landing page.`,
    );
  }
  // Name the section: "Teks section harus diisi" alone left the operator
  // hunting through every block (audit 2026-10-31 L5).
  sections.forEach((section, index) => {
    try {
      validateSection(section);
    } catch (error) {
      if (!(error instanceof LandingPageValidationError)) throw error;
      throw new LandingPageValidationError(`Section ${index + 1}: ${error.message}`, error.status);
    }
  });
}

/**
 * A landing page must point at a product this store actually carries.
 *
 * Without this the API accepted any string: the page saved, appeared in the
 * admin list, and answered `404` to every visitor because `[slug].astro` could
 * not resolve the product — an ad destination that silently was not one. The
 * native-landing register has always refused an unknown product for the same
 * reason (`docs/LANDING-PAGES.md`); this is the CMS path catching up.
 */
async function requireExistingProduct(database: D1Database, productId: string) {
  const trimmed = productId.trim();
  if (!trimmed) throw new LandingPageValidationError("Produk landing page wajib dipilih.");
  let row: { id: number | string } | null = null;
  try {
    row = await database
      .prepare("SELECT id FROM products WHERE CAST(id AS TEXT) = ? LIMIT 1")
      .bind(trimmed)
      .first<{ id: number | string }>();
  } catch (error) {
    // A read failure is not proof the product is missing. Refusing the save
    // here would turn a transient D1 blip into "your product does not exist".
    console.error("landing-product-check-failed", error);
    return trimmed;
  }
  if (!row) {
    throw new LandingPageValidationError("Produk yang dipilih tidak ditemukan.");
  }
  return trimmed;
}

function validateSection(section: LandingSectionInput) {
  if (!["html", "form", "headline", "paragraph", "numbered_list", "bullet_list", "image"].includes(section.type)) {
    throw new LandingPageValidationError("Jenis section landing page tidak dikenal.");
  }
  if (section.type === "html" && (section.content_html?.length ?? 0) > LANDING_HTML_MAX) {
    throw new LandingPageValidationError(`HTML section maksimal ${LANDING_HTML_MAX} karakter.`);
  }
  // An unknown mode was not refused and did not fail loudly either: the form
  // component falls through to its middle variant, so an operator who stored a
  // typo silently got a different form than the one they chose.
  if (section.type === "form") {
    const mode = section.form_config?.mode;
    if (mode !== undefined && !LANDING_FORM_MODES.includes(mode)) {
      throw new LandingPageValidationError(
        `Mode form harus salah satu dari ${LANDING_FORM_MODES.join(", ")}.`,
      );
    }
  }
  if (section.type === "headline" || section.type === "paragraph") {
    if (!section.content_config || !("text" in section.content_config) || !section.content_config.text.trim() || /[<>]/.test(section.content_config.text)) throw new LandingPageValidationError("Teks section harus diisi tanpa tanda < atau >.");
    if (section.content_config.text.length > LANDING_TEXT_MAX) throw new LandingPageValidationError(`Teks section maksimal ${LANDING_TEXT_MAX} karakter.`);
    if (section.content_config.align && !["left", "center", "right"].includes(section.content_config.align)) throw new LandingPageValidationError("Perataan teks tidak valid.");
    if (section.type === "headline" && section.content_config.size && !["small", "medium", "large"].includes(section.content_config.size)) throw new LandingPageValidationError("Ukuran headline tidak valid.");
  }
  if (section.type === "numbered_list" || section.type === "bullet_list") {
    if (!section.content_config || !("items" in section.content_config) || !section.content_config.items.length || section.content_config.items.some((item) => !item.trim() || /[<>]/.test(item))) throw new LandingPageValidationError("Daftar harus berisi minimal satu item teks tanpa tanda < atau >.");
    if (section.content_config.items.length > LANDING_LIST_ITEMS_MAX) throw new LandingPageValidationError(`Daftar maksimal ${LANDING_LIST_ITEMS_MAX} item.`);
    if (section.content_config.items.some((item) => item.length > LANDING_TEXT_MAX)) throw new LandingPageValidationError(`Item daftar maksimal ${LANDING_TEXT_MAX} karakter.`);
  }
  if (section.type === "image") {
    if (!section.content_config || !("src" in section.content_config) || !/^\/assets\/uploads\/[\w/-]+\.webp$/.test(section.content_config.src) || !("alt" in section.content_config)) throw new LandingPageValidationError("Section gambar harus memakai berkas WebP hasil unggahan.");
  }
}

async function findPageBySlug(
  database: D1Database,
  slug: string,
): Promise<LandingPageRow | null> {
  return database
    .prepare(`SELECT ${PAGE_COLUMNS} FROM landing_pages WHERE slug = ? LIMIT 1`)
    .bind(slug)
    .first<LandingPageRow>();
}

async function loadSections(
  database: D1Database,
  landingPageId: string,
): Promise<LandingSection[]> {
  const result = await database
    .prepare(
      `SELECT ${SECTION_COLUMNS}
       FROM landing_sections
       WHERE landing_page_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(landingPageId)
    .all<LandingSectionRow>();

  return (result.results ?? []).map(mapSection);
}

export async function listLandingPages(
  locals: App.Locals,
): Promise<LandingPage[]> {
  const database = getDatabase(locals);
  // The register is the file manifest; this makes the table agree with it
  // before anything reads the list, so a page deployed since the last load
  // shows up without a separate sync step.
  await reconcileNativeLandingPages(database);
  const [pageResult, sectionResult] = await database.batch<LandingPageRow | LandingSectionRow>([
    database.prepare(
      `SELECT ${PAGE_COLUMNS}
       FROM landing_pages
       ORDER BY updated_at DESC, created_at DESC`,
    ),
    database.prepare(
      `SELECT ${SECTION_COLUMNS}
       FROM landing_sections
       ORDER BY landing_page_id ASC, sort_order ASC, created_at ASC`,
    ),
  ]);
  const productMap = new Map<string, string>();
  // The slug is what a claimed page's real URL is built from, so the admin can
  // show and copy `/produk/<slug>` rather than an address that only redirects.
  const productSlugMap = new Map<string, string>();
  const productImageMap = new Map<string, string>();

  try {
    const productResult = await database
      .prepare(`SELECT id, title, slug, image_url FROM products`)
      .all<{ id: number | string; title: string; slug: string; image_url?: string | null }>();
    for (const prod of productResult.results ?? []) {
      if (prod?.id && prod?.title) {
        productMap.set(String(prod.id), prod.title);
      }
      if (prod?.id && prod?.slug) {
        productSlugMap.set(String(prod.id), prod.slug);
      }
      if (prod?.id && prod?.image_url) {
        productImageMap.set(String(prod.id), prod.image_url);
      }
    }
  } catch {
    // Products table may be absent in isolated landing_page migration tests
  }

  const pages = attachSections(
    (pageResult?.results ?? []) as LandingPageRow[],
    (sectionResult?.results ?? []) as LandingSectionRow[],
  );

  return [
    ...pages.map((page) => ({
      ...page,
      product_title: productMap.get(String(page.product_id)) || null,
      product_slug: productSlugMap.get(String(page.product_id)) || null,
      thumbnail: landingThumbnail({
        sections: page.sections,
        nativeImage:
          page.source === "native"
            ? nativeLandingPages.find((entry) => entry.slug === page.slug)?.image
            : null,
        productImage: productImageMap.get(String(page.product_id)),
      }),
    })),
    ...staticLandingPages.map((page) => ({ ...page, sections: [] })),
  ];
}

export async function getLandingPageBySlug(
  locals: App.Locals,
  slug: string,
): Promise<LandingPage | null> {
  const database = getDatabase(locals);
  const page = await findPageBySlug(database, slug);
  if (!page) return null;

  return {
    ...page,
    sections: await loadSections(database, page.id),
  };
}

export async function getLandingPageById(
  locals: App.Locals,
  id: string,
): Promise<LandingPage | null> {
  const database = getDatabase(locals);
  const page = await database
    .prepare(`SELECT ${PAGE_COLUMNS} FROM landing_pages WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<LandingPageRow>();
  if (!page) return null;

  return {
    ...page,
    sections: await loadSections(database, page.id),
  };
}

export async function createLandingPage(
  locals: App.Locals,
  input: CreateLandingPageInput,
): Promise<LandingPage> {
  const slugValidation = validateLandingPageSlug(input.slug);
  if (!slugValidation.valid) throw new LandingPageValidationError(String(slugValidation.error));
  const title = requiredTitle(input.title);
  const metaTitle = boundedText(input.meta_title, LANDING_TITLE_MAX, "Meta title");
  const metaDescription = boundedText(
    input.meta_description,
    LANDING_META_DESCRIPTION_MAX,
    "Meta description",
  );
  validateSections(input.sections);

  const database = getDatabase(locals);
  const productId = await requireExistingProduct(database, input.product_id ?? "");
  if (await findPageBySlug(database, input.slug)) {
    throw new LandingPageValidationError("Slug ini sudah dipakai landing page lain.", 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1Statement[] = [
    database
      .prepare(
        `INSERT INTO landing_pages (
           id, slug, title, product_id, is_active,
           meta_title, meta_description, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.slug,
        title,
        productId,
        normalizeActive(input.is_active),
        metaTitle,
        metaDescription,
        now,
        now,
      ),
  ];

  for (const [index, section] of (input.sections ?? []).entries()) {
    statements.push(
      database
        .prepare(
          `INSERT INTO landing_sections (
             id, landing_page_id, sort_order, type, content_html,
             form_config, content_config, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          section.id ?? crypto.randomUUID(),
          id,
          section.sort_order ?? index,
          section.type,
          section.content_html ?? null,
          serializeFormConfig(section.form_config),
          serializeContentConfig(section.content_config),
          now,
          now,
        ),
    );
  }

  await database.batch(statements);
  const created = await getLandingPageById(locals, id);
  if (!created) throw new Error("Landing page could not be loaded after creation");
  return created;
}

export async function updateLandingPage(
  locals: App.Locals,
  id: string,
  input: UpdateLandingPageInput,
): Promise<LandingPage | null> {
  if (isNativeLandingId(id)) throw new NativeLandingReadOnlyError();
  const database = getDatabase(locals);
  const existing = await getLandingPageById(locals, id);
  if (!existing) return null;

  const slug = input.slug ?? existing.slug;
  const slugValidation = validateLandingPageSlug(slug);
  if (!slugValidation.valid) throw new LandingPageValidationError(String(slugValidation.error));

  if (slug !== existing.slug) {
    const duplicate = await findPageBySlug(database, slug);
    if (duplicate && duplicate.id !== id) {
      throw new LandingPageValidationError("Slug ini sudah dipakai landing page lain.", 409);
    }
  }

  const title =
    input.title === undefined ? existing.title : requiredTitle(input.title);
  // Only a *submitted* product is re-checked. An edit that leaves the field
  // alone must not start failing because the product was deleted after the
  // page was built — that is a state to report, not a reason to lock the
  // operator out of fixing their own page.
  const productId =
    input.product_id === undefined
      ? existing.product_id
      : await requireExistingProduct(database, input.product_id);
  if (!productId) throw new LandingPageValidationError("Produk landing page wajib dipilih.");
  const metaTitle =
    input.meta_title === undefined
      ? existing.meta_title
      : boundedText(input.meta_title, LANDING_TITLE_MAX, "Meta title");
  const metaDescription =
    input.meta_description === undefined
      ? existing.meta_description
      : boundedText(input.meta_description, LANDING_META_DESCRIPTION_MAX, "Meta description");
  validateSections(input.sections);

  const now = new Date().toISOString();
  const statements: D1Statement[] = [
    database
      .prepare(
        `UPDATE landing_pages
         SET slug = ?, title = ?, product_id = ?, is_active = ?,
             meta_title = ?, meta_description = ?, updated_at = ?,
             is_product_page = CASE WHEN ? THEN 0 ELSE is_product_page END
         WHERE id = ?`,
      )
      .bind(
        slug,
        title,
        productId,
        normalizeActive(input.is_active, existing.is_active),
        metaTitle,
        metaDescription,
        now,
        // A claim is a decision about one product's page. Moving the page to
        // another product must not carry it along: that silently took over the
        // new product's URL, or hit the one-claim-per-product index as a 500.
        String(productId) !== String(existing.product_id) ? 1 : 0,
        id,
      ),
  ];

  if (input.sections !== undefined) {
    statements.push(
      database
        .prepare("DELETE FROM landing_sections WHERE landing_page_id = ?")
        .bind(id),
    );

    for (const [index, section] of input.sections.entries()) {
      statements.push(
        database
          .prepare(
            `INSERT INTO landing_sections (
               id, landing_page_id, sort_order, type, content_html,
               form_config, content_config, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            section.id ?? crypto.randomUUID(),
            id,
            section.sort_order ?? index,
            section.type,
            section.content_html ?? null,
            serializeFormConfig(section.form_config),
            serializeContentConfig(section.content_config),
            now,
            now,
          ),
      );
    }
  }

  await database.batch(statements);
  return getLandingPageById(locals, id);
}

export async function deleteLandingPage(
  locals: App.Locals,
  id: string,
): Promise<boolean> {
  // Deleting the row would only make it reappear on the next reconcile; the
  // file is what has to go.
  if (isNativeLandingId(id)) throw new NativeLandingReadOnlyError();
  const result = await getDatabase(locals)
    .prepare("DELETE FROM landing_pages WHERE id = ?")
    .bind(id)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function firstDefinedNumber(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return 0;
}

export type ShortcodeProduct = {
  title?: string;
  productName?: string;
  name?: string;
  price?: number | string;
  compare_price?: number | string | null;
  comparePrice?: number | string | null;
  variants?: Array<{
    price?: number | string;
    compare_price?: number | string | null;
    comparePrice?: number | string | null;
  }>;
};

/**
 * Defers the images of a merchant-authored HTML section the browser does not
 * need for first paint. A CMS landing page is written by hand, and its images
 * arrive eager and unsized: on a live ad landing every before/after photo and a
 * 172 KB stock photo far below the fold were fetched up front, competing with
 * the hero for the mobile connection that LCP is measured on.
 *
 * Adds `loading="lazy" decoding="async"` to each `<img>` except:
 * - the first image of the page (`keepFirstEager`), the likely LCP element;
 * - a tag that already declares `loading` — the operator chose;
 * - a tag carrying `onerror`/`onload`: content uses a hidden
 *   `<img src="x" onerror=…>` to run script, and a lazy hidden image is never
 *   fetched, so its handler would never fire.
 *
 * Such a script carrier's placeholder `src` ("x", "#") becomes `data:,`. It
 * fails just the same, so `onerror` still fires, but without a request: "x"
 * cost every page view a Worker 404 render on `/x`, and "#" refetched the page.
 */
export function deferOffscreenImages(html: string, keepFirstEager: boolean): string {
  let first = keepFirstEager;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\sonerror\s*=/i.test(tag)) tag = tag.replace(/(\ssrc\s*=\s*)(["']?)(?:x|#)\2(?=[\s>/])/i, '$1"data:,"');
    if (/\sloading\s*=/i.test(tag) || /\son(error|load)\s*=/i.test(tag)) return tag;
    if (first) {
      first = false;
      return tag;
    }
    return tag.replace(/^<img\b/i, '<img loading="lazy" decoding="async"');
  });
}

/**
 * A page has one <h1>. Merchant HTML often carries two — a pasted page with a
 * hero title and a second one over the offer — so every <h1> after the first
 * the page keeps becomes an <h2>, its attributes (and so its look, which such
 * content sets inline) untouched. `pageHasH1` says an earlier section already
 * holds the page's <h1>; the result says whether the page has one after this.
 */
export function demoteExtraH1(html: string, pageHasH1: boolean): { html: string; pageHasH1: boolean } {
  let hasH1 = pageHasH1;
  const kept: boolean[] = [];
  const out = html.replace(/<(\/?)h1(?=[\s>])([^>]*)>/gi, (_tag, close: string, rest: string) => {
    if (close) return kept.pop() ? '</h1>' : '</h2>';
    const keep = !hasH1;
    hasH1 = true;
    kept.push(keep);
    return keep ? `<h1${rest}>` : `<h2${rest}>`;
  });
  return { html: out, pageHasH1: hasH1 };
}

export function parseShortcodes(
  html: string,
  product: ShortcodeProduct,
  csPhone = "",
): string {
  const firstVariant = Array.isArray(product?.variants)
    ? product.variants[0]
    : undefined;
  const price = firstDefinedNumber(product?.price, firstVariant?.price);
  const comparePrice = firstDefinedNumber(
    product?.compare_price,
    product?.comparePrice,
    firstVariant?.compare_price,
    firstVariant?.comparePrice,
  );
  const discountPercent =
    comparePrice > price && comparePrice > 0
      ? `${Math.round(((comparePrice - price) / comparePrice) * 100)}%`
      : "0%";
  const replacements: Record<string, string> = {
    product_name: escapeHtml(
      product?.title ?? product?.productName ?? product?.name ?? "",
    ),
    product_price: formatIdr(price),
    compare_price: formatIdr(comparePrice),
    discount_percent: discountPercent,
    cs_whatsapp: escapeHtml(csPhone),
  };

  return html.replace(
    /(?:\{\{|\[)\s*(product_name|product_price|compare_price|discount_percent|cs_whatsapp)\s*(?:\}\}|\])/g,
    (_match, shortcode: string) => replacements[shortcode] ?? _match,
  );
}

/**
 * First path segments a static route already answers. Astro serves a static
 * route before `[slug]`, so a landing page saved under one of these was listed,
 * advertised in the sitemap and linked from home while its URL served
 * something else. `landing-pages.test.ts` fails when `src/pages/` gains a
 * top-level route this list does not name.
 */
export const RESERVED_LANDING_SLUGS: ReadonlySet<string> = new Set([
  "404", "admin", "api", "assets", "contoh-landing", "disclaimer", "embed",
  "feed", "form-full", "form-hybrid", "form-middle", "full-form", "geoipform",
  "hello", "hybrid-form", "install", "kebijakan-cookie", "kebijakan-privasi",
  "kontak", "landing", "landing-page", "llms", "media", "middle-form", "payment",
  "pengiriman", "produk", "robots", "sitemap", "solusi-terbaru",
  "syarat-ketentuan", "tentang", "testimoni", "thanks",
]);

/**
 * A slug a CMS landing page may not take because a route file already answers
 * on it: the product's own pages, every registered native landing page (active
 * or not — the file exists either way), and the install's other route files.
 * Without the last two a CMS page saved on `/<native-slug>` stays unreachable.
 */
export function isReservedLandingSlug(
  slug: string,
  natives: readonly NativeLandingPage[] = nativeLandingPages,
  installRoutes: readonly string[] = installRouteSlugs,
): boolean {
  return (
    RESERVED_LANDING_SLUGS.has(slug) ||
    natives.some((entry) => entry.slug === slug) ||
    installRoutes.includes(slug)
  );
}

export function validateLandingPageSlug(
  slug: string,
): { valid: boolean; error?: string } {
  if (!slug) return { valid: false, error: "Slug is required" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return {
      valid: false,
      error:
        "Slug must contain only lowercase letters, numbers, and single hyphens",
    };
  }
  if (isReservedLandingSlug(slug)) {
    return { valid: false, error: `Slug /${slug} sudah dipakai halaman bawaan toko.` };
  }
  return { valid: true };
}

/**
 * Raw HTML sections render unescaped on the store's own origin, which is also
 * the admin's origin — a `<script>` there runs with the session of whoever
 * opens the page. So only owner/admin may introduce or change one; an
 * advertiser may still edit the typed sections around HTML someone trusted
 * already wrote. Compared by content, not position, so reordering is free.
 */
export function changesHtmlSections(
  next: readonly LandingSectionInput[] | undefined,
  existing: readonly { type: string; content_html?: string | null }[] = [],
): boolean {
  if (next === undefined) return false;
  const trusted = new Set(
    existing.filter((section) => section.type === "html").map((section) => section.content_html ?? ""),
  );
  return next.some(
    (section) => section.type === "html" && !trusted.has(section.content_html ?? ""),
  );
}

/**
 * The landing page that has taken over a product's page, if any.
 *
 * Only an active page counts: unpublishing a claimed landing page must return
 * `/produk/<slug>` to the normal product template rather than 404 the product.
 */
export async function getProductPageLanding(
  locals: App.Locals,
  productId: string,
): Promise<LandingPage | null> {
  const trimmed = String(productId || "").trim();
  if (!trimmed) return null;
  const database = getDatabase(locals);
  const page = await database
    .prepare(
      `SELECT ${PAGE_COLUMNS}
       FROM landing_pages
       WHERE product_id = ? AND is_product_page = 1 AND is_active = 1
       LIMIT 1`,
    )
    .bind(trimmed)
    .first<LandingPageRow>();
  if (!page) return null;

  return { ...page, sections: await loadSections(database, page.id) };
}

/** A native page's content lives in a deployed file; the CMS may not rewrite it. */
export class NativeLandingReadOnlyError extends Error {
  constructor() {
    super(
      "Landing page ini dibuat dari file Astro. Ubah filenya lalu deploy ulang; CMS hanya mencatat dan menautkannya.",
    );
  }
}

export class LandingProductPageConflictError extends Error {
  readonly conflictingSlug: string;
  constructor(conflictingSlug: string) {
    super(
      `Produk ini sudah dipakai oleh landing page /${conflictingSlug}. Lepaskan dulu dari sana.`,
    );
    this.conflictingSlug = conflictingSlug;
  }
}

/**
 * Claims or releases a product's page for one landing page.
 *
 * The partial unique index is the real guard; this reads the current holder
 * first only so the operator gets the offending slug instead of a constraint
 * error they cannot act on.
 */
export async function setLandingPageAsProductPage(
  locals: App.Locals,
  id: string,
  claim: boolean,
): Promise<LandingPage | null> {
  const database = getDatabase(locals);
  const page = await database
    .prepare(`SELECT ${PAGE_COLUMNS} FROM landing_pages WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<LandingPageRow>();
  if (!page) return null;

  if (claim) {
    const holder = await database
      .prepare(
        `SELECT slug FROM landing_pages
         WHERE product_id = ? AND is_product_page = 1 AND id <> ?
         LIMIT 1`,
      )
      .bind(page.product_id, id)
      .first<{ slug: string }>();
    if (holder) throw new LandingProductPageConflictError(holder.slug);
  }

  await database
    .prepare(
      `UPDATE landing_pages
       SET is_product_page = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(claim ? 1 : 0, new Date().toISOString(), id)
    .run();

  return {
    ...page,
    is_product_page: claim ? 1 : 0,
    sections: await loadSections(database, page.id),
  };
}

/**
 * Brings the `landing_pages` table in line with the native register.
 *
 * The file manifest owns whether a native page exists and what it says; this
 * table owns only the operational state the CMS needs — chiefly whether the
 * page has taken over a product page. So the reconcile writes identity and
 * metadata and never touches `is_product_page`, which is the operator's
 * decision, not the file's.
 *
 * Removing an entry from the register removes its row, and with it any claim
 * it held. That is deliberate: a register entry without a file is a listing
 * that 404s, and a claim held by a page that no longer exists would leave
 * `/produk/<slug>` pointing at nothing. The product simply returns to its own
 * template.
 */
export async function reconcileNativeLandingPages(
  database: D1Database,
  entries: readonly NativeLandingPage[] = activeNativeLandingPages(),
): Promise<void> {
  let productIdBySlug = new Map<string, string>();
  try {
    const productResult = await database
      .prepare(`SELECT id, slug FROM products`)
      .all<{ id: number | string; slug: string }>();
    productIdBySlug = new Map(
      (productResult.results ?? [])
        .filter((row) => row?.id && row?.slug)
        .map((row) => [row.slug, String(row.id)] as const),
    );
  } catch {
    // Products unreadable: leave the register alone rather than rewriting
    // every native row's product to nothing.
    return;
  }

  const now = new Date().toISOString();
  const statements: D1Statement[] = [];

  for (const entry of entries) {
    const productId = productIdBySlug.get(entry.productSlug);
    // A register entry naming a product this store does not carry is skipped
    // rather than inserted against an empty product, which would make the
    // takeover unresolvable later.
    if (!productId) continue;

    statements.push(
      database
        .prepare(
          `INSERT INTO landing_pages
             (id, slug, title, product_id, is_active, is_product_page,
              meta_title, meta_description, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, 0, ?, ?, 'native', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             slug = excluded.slug,
             title = excluded.title,
             product_id = excluded.product_id,
             meta_title = excluded.meta_title,
             meta_description = excluded.meta_description,
             updated_at = excluded.updated_at
           -- Only a real change writes. updated_at is the sitemap's lastmod,
           -- and a re-sync that bumped it every time told crawlers every
           -- native page had changed whenever the list was opened.
           WHERE landing_pages.slug IS NOT excluded.slug
              OR landing_pages.title IS NOT excluded.title
              OR landing_pages.product_id IS NOT excluded.product_id
              OR landing_pages.meta_title IS NOT excluded.meta_title
              OR landing_pages.meta_description IS NOT excluded.meta_description`,
        )
        .bind(
          nativeLandingIdFor(entry.slug),
          entry.slug,
          entry.title,
          productId,
          entry.title,
          entry.description,
          now,
          now,
        ),
    );
  }

  const registeredIds = entries.map((entry) => nativeLandingIdFor(entry.slug));
  const placeholders = registeredIds.map(() => "?").join(", ");
  statements.push(
    database
      .prepare(
        registeredIds.length
          ? `DELETE FROM landing_pages
             WHERE source = 'native' AND id NOT IN (${placeholders})`
          : `DELETE FROM landing_pages WHERE source = 'native'`,
      )
      .bind(...registeredIds),
  );

  try {
    await database.batch(statements);
  } catch (error) {
    // The register is a convenience layer over files that already answer on
    // their URLs; failing to record them must not take the admin list down.
    console.error("native-landing-reconcile-failed", error);
  }
}

/**
 * The address a native landing page should declare as canonical.
 *
 * A native route cannot know on its own whether an operator has handed it a
 * product page — that is a database fact — and when one has, the page answers
 * on `/produk/<product-slug>` while its own slug redirects there. Declaring
 * its own slug in that state would point search engines at a URL that bounces
 * back to the page they are already on.
 *
 * Every native landing page should build its canonical from this rather than
 * from its slug. Falls back to the slug if the claim cannot be read, which is
 * the correct answer for an unclaimed page and a harmless one otherwise.
 */
export async function nativeLandingCanonicalPath(
  locals: App.Locals,
  slug: string,
): Promise<string> {
  const fallback = `/${slug}`;
  try {
    const row = await getDatabase(locals)
      .prepare(
        `SELECT p.slug AS product_slug
           FROM landing_pages lp
           INNER JOIN products p ON CAST(p.id AS TEXT) = lp.product_id
          WHERE lp.slug = ?
            AND lp.source = 'native'
            AND lp.is_product_page = 1
            AND lp.is_active = 1
          LIMIT 1`,
      )
      .bind(slug)
      .first<{ product_slug: string }>();
    return row?.product_slug ? `/produk/${row.product_slug}` : fallback;
  } catch {
    return fallback;
  }
}

export type PublicLandingPage = {
  slug: string;
  title: string;
  excerpt: string;
  /** Where the page actually answers, honouring a product-page takeover. */
  href: string;
  /** True when `href` is the product URL, not the page's own slug. */
  isProductPage: boolean;
  /** List thumbnail: the page's own first image, else its product's photo. */
  image: string | null;
  /** `landing_pages.updated_at`, the sitemap's honest `lastmod`; null when unset. */
  updatedAt: string | null;
};

/**
 * Active landing pages for a public listing, CMS and native alike.
 *
 * Deliberately does **not** reconcile the native register: that is a write, and
 * a storefront read must not mutate the store. The admin list already keeps the
 * register in step, so a page deployed but never opened in the CMS is the only
 * gap, and it closes the moment an operator loads the landing-page list.
 *
 * `href` follows the takeover rather than the slug, so a claimed page links to
 * the product URL it actually answers on instead of one that redirects.
 */
/**
 * The picture a landing page is listed with. A page's own imagery wins — the
 * first `image` section, then the first `<img>` of a legacy HTML section, or
 * a native page's register `image` — and the product it sells is the
 * fallback, so a list never shows an empty tile for a page that has none.
 */
export function landingThumbnail(input: {
  sections?: readonly Pick<LandingSection, "type" | "content_html" | "content_config">[];
  nativeImage?: string | null;
  productImage?: string | null;
}): string | null {
  for (const section of input.sections ?? []) {
    const config = section.content_config as { src?: unknown } | null;
    if (section.type === "image" && typeof config?.src === "string" && config.src.trim()) {
      return config.src.trim();
    }
  }
  for (const section of input.sections ?? []) {
    const match = section.type === "html" ? /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(section.content_html || "") : null;
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return input.nativeImage?.trim() || input.productImage?.trim() || null;
}

export async function listPublicLandingPages(
  locals: App.Locals,
): Promise<PublicLandingPage[]> {
  const result = await getDatabase(locals)
    .prepare(
      `SELECT lp.slug, lp.title, lp.meta_description, lp.is_product_page, lp.updated_at,
              p.slug AS product_slug, p.image_url AS product_image,
              (SELECT ls.content_config FROM landing_sections ls
                WHERE ls.landing_page_id = lp.id AND ls.type = 'image'
                ORDER BY ls.sort_order LIMIT 1) AS first_image_config
         FROM landing_pages lp
         -- The rowid term lets SQLite look each product up by primary key;
         -- matching on CAST(p.id AS TEXT) alone scanned every landing page
         -- once per active product (2.75M rows read a day across the fleet,
         -- STATUS 2026-10-29). The text term keeps the old exact match, so
         -- '020001' still names no product.
         JOIN products p ON p.id = CAST(lp.product_id AS INTEGER)
                        AND CAST(p.id AS TEXT) = lp.product_id
        -- A page whose product is off answers 404, so it is not advertised.
        WHERE lp.is_active = 1 AND p.is_active = 1
        ORDER BY lp.updated_at DESC, lp.created_at DESC`,
    )
    .all<{
      slug: string;
      title: string;
      meta_description: string | null;
      is_product_page: number;
      updated_at: string | null;
      product_slug: string | null;
      product_image: string | null;
      first_image_config: string | null;
    }>();

  return (result.results ?? []).map((row) => ({
    slug: row.slug,
    title: row.title,
    excerpt: (row.meta_description || "").trim(),
    href:
      row.is_product_page && row.product_slug
        ? `/produk/${row.product_slug}`
        : `/${row.slug}`,
    isProductPage: Boolean(row.is_product_page && row.product_slug),
    image: landingThumbnail({
      sections: row.first_image_config
        ? [{ type: "image", content_html: null, content_config: parseContentConfig(row.first_image_config) }]
        : [],
      nativeImage: nativeLandingPages.find((entry) => entry.slug === row.slug)?.image,
      productImage: row.product_image,
    }),
    updatedAt: row.updated_at || null,
  }));
}
