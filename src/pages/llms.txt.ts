import type { APIRoute } from "astro";
import { getStorefrontProducts } from "../lib/catalog";
import { buildLlmsTxt } from "../lib/llms-txt";

export const prerender = false;

/**
 * The store described for AI assistants (llmstxt.org), from this store's own
 * catalogue. A store that asked to stay out of search publishes none.
 */
export const GET: APIRoute = async ({ locals }) => {
  const tenant = locals.tenant;
  if (tenant.noindex) return new Response("Not found\n", { status: 404 });

  let products: Awaited<ReturnType<typeof getStorefrontProducts>> = [];
  try {
    products = await getStorefrontProducts(locals);
  } catch (error) {
    // The store's own pages are still worth pointing at.
    console.error("llms-txt-products", error);
  }

  return new Response(
    buildLlmsTxt(
      { name: tenant.name, siteUrl: tenant.siteUrl, description: tenant.description, tagline: tenant.tagline },
      products,
    ),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
};
