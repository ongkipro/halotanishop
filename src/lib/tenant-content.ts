import { getRuntimeEnv } from "./env.ts";
import {
  loadPublishedHomeContent,
  type HomeContent,
} from "./storefront-content.ts";
import { listPublicLandingPages } from "./landing-pages.ts";

export type TenantHomeContent = HomeContent;

export type TenantHomeContentResolution =
  | { state: "ready"; content: TenantHomeContent }
  | { state: "unavailable" };

/**
 * A store that has just been installed has no published home content. It used to
 * be sent to a setup screen before its storefront would render at all, which
 * made a fresh install unusable until an operator filled a form. The catalogue,
 * the store's own name, and its landing pages are already enough to build a
 * home page, so this composes one.
 *
 * `heroSlides` is left empty on purpose: the template borrows product photos and
 * rotates them daily, which is better art than any placeholder.
 */
function defaultHomeContent(
  tenant: App.Locals["tenant"],
  solutions: TenantHomeContent["solutions"],
): TenantHomeContent {
  const description =
    tenant.tagline || tenant.description || `Belanja produk pilihan di ${tenant.name}.`;
  return {
    hero: {
      title: tenant.name,
      description,
      ratingLabel: "Pesanan diproses setiap hari",
    },
    catalog: {
      eyebrow: "Produk kami",
      title: "Pilih Sesuai Kebutuhan",
      description: "Semua produk siap kirim dari gudang kami.",
    },
    solutionsHeading: {
      eyebrow: "Halaman",
      title: "Selengkapnya",
      description: "Halaman penawaran yang sedang aktif.",
    },
    proofsHeading: {
      eyebrow: "Ulasan",
      title: "Kata Pembeli",
      description: "Cerita dari pembeli kami.",
    },
    heroHighlights: [{ label: "Siap kirim", icon: "package" }],
    heroSlides: [],
    solutions,
    proofs: [],
  };
}

export async function getTenantHomeContent(
  locals?: App.Locals,
): Promise<TenantHomeContentResolution> {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    console.error("home-content-no-database-binding");
    return { state: "unavailable" };
  }

  const published = await loadPublishedHomeContent(database as D1Database);
  if (published.state === "unavailable") {
    return { state: "unavailable" };
  }
  const unpublished = published.state === "unpublished";

  if (!locals) {
    return unpublished
      ? { state: "unavailable" }
      : { state: "ready", content: published.content };
  }

  try {
    // Read-only public listing: the home page must not write to D1, must not
    // link a page whose product is off, and links a claimed page by the
    // product URL it answers on rather than a 308.
    const cmsSolutions = (await listPublicLandingPages(locals))
      .map((page) => ({
        title: page.title,
        excerpt: page.excerpt || `Informasi ${page.title}`,
        image: page.image || "",
        href: page.href,
        crop: "CMS Landing Page",
      }));

    if (unpublished) {
      return {
        state: "ready",
        content: defaultHomeContent(locals.tenant, cmsSolutions),
      };
    }

    return {
      state: "ready",
      content: {
        ...published.content,
        solutions:
          cmsSolutions.length > 0
            ? [...cmsSolutions, ...published.content.solutions]
            : published.content.solutions,
      },
    };
  } catch (error) {
    console.error("home-landing-pages-load", error);
    return { state: "unavailable" };
  }
}
