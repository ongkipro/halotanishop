import { useEffect, useMemo, useState } from "react";
import {
  Code2,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  ChevronDown,
  Package,
  CheckCircle2,
  Layers,
  Tag,
  Pencil,
  Copy,
  Plus,
  RefreshCw,
  Eye,
  Filter,
  Tags,
} from "lucide-react";
import { catalogProductIdOrNull } from "../../lib/catalog-feed";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { SearchInput } from "@/components/admin/filter-bar";
import { FilterSelect } from "@/components/admin/filter-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Input } from "../ui/input";
import { Button, buttonVariants } from "../ui/button";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { EMBED_SNIPPET_VERSION, buildEmbedMarkup } from "../../lib/embed-markup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const EMBED_MODE_LABELS: Record<string, string> = {
  hybrid: "Hybrid · Otomatis menyesuaikan wilayah",
  full: "Full · Alamat & ongkir lengkap",
  middle: "Middle · Form singkat (Nama & HP)",
};

export type ProductVariant = {
  id: number | string;
  sku: string;
  title: string;
  price: number;
  stock: number;
};

export type Product = {
  id: number | string;
  title: string;
  slug: string;
  category: string | null;
  image_url: string | null;
  is_active: number | boolean;
  variants: ProductVariant[];
};

type FormMode = "middle" | "full" | "hybrid";
type EmbedConfig = {
  variants: Array<{
    id: number | string;
    content_id: string;
    label: string;
  }>;
  selected_variant: {
    id: number | string;
    content_id: string;
  };
};

const FORM_PATHS: Record<FormMode, string> = {
  middle: "/middle-form",
  full: "/full-form",
  hybrid: "/hybrid-form",
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getProductPriceRange(variants: ProductVariant[]): string | null {
  if (!variants || variants.length === 0) return null;
  const prices = variants.map((v) => Number(v.price)).filter((p) => p > 0);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) {
    return formatIDR(min);
  }
  return `${formatIDR(min)} - ${formatIDR(max)}`;
}

function ProductActions({
  product,
  onDelete,
  onEmbed,
  onCopyId,
  fullWidth = false,
}: {
  product: Product;
  onDelete: (product: Product) => void;
  onEmbed: (product: Product) => void;
  onCopyId: (id: string | number) => void;
  fullWidth?: boolean;
}) {
  const editUrl = `/admin/products/edit?id=${encodeURIComponent(String(product.id))}`;
  const storefrontUrl = `/produk/${product.slug}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={fullWidth ? "default" : "sm"}
          className={fullWidth ? "min-h-11 w-full justify-between" : "h-9 px-2.5"}
          aria-label={`Aksi produk ${product.title}`}
        >
          {fullWidth ? "Kelola produk" : null}
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <a href={editUrl} className="flex items-center gap-2">
            <Pencil className="size-4 text-slate-500" aria-hidden="true" />
            <span>Edit produk</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={storefrontUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2">
            <Eye className="size-4 text-slate-500" aria-hidden="true" />
            <span>Lihat di storefront</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onEmbed(product)} className="flex items-center gap-2">
          <Code2 className="size-4 text-emerald-600" aria-hidden="true" />
          <span>Embed checkout form</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopyId(product.id)} className="flex items-center gap-2">
          <Copy className="size-4 text-slate-500" aria-hidden="true" />
          <span>Salin Content ID</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => onDelete(product)}
          className="flex items-center gap-2"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          <span>Hapus produk</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProductCatalog({
  initialProducts,
}: {
  initialProducts?: Product[];
}) {
  const [products, setProducts] = useState<Product[]>(initialProducts || []);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [loading, setLoading] = useState(initialProducts ? false : true);
  const [error, setError] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingProductIds, setTogglingProductIds] = useState<Set<string>>(
    () => new Set()
  );
  const [embedTarget, setEmbedTarget] = useState<Product | null>(null);
  const [embedConfig, setEmbedConfig] = useState<EmbedConfig | null>(null);
  const [embedMode, setEmbedMode] = useState<FormMode>("hybrid");
  const [embedVariantId, setEmbedVariantId] = useState("");
  const [embedLoading, setEmbedLoading] = useState(false);
  const [embedError, setEmbedError] = useState("");

  useEffect(() => {
    setError("");
    const controller = new AbortController();
    const media = window.matchMedia("(min-width: 1024px)");
    const updateViewport = () => setIsDesktop(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);

    const load = async () => {
      try {
        // lazy: the newest 200 (the API's ceiling) with no paging. The old
        // default of 50 silently hid every older product from the catalogue
        // and from the landing-page picker. Upgrade path: cursor paging with
        // server-side search, once a store actually nears 200.
        const response = await fetch("/api/admin/products?limit=200", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success)
          throw new Error(payload.error || "Daftar produk gagal dimuat.");
        setProducts(Array.isArray(payload.data) ? payload.data : []);
      } catch (reason) {
        if (!(reason instanceof Error && reason.name === "AbortError")) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Daftar produk gagal dimuat."
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();

    return () => {
      media.removeEventListener("change", updateViewport);
      controller.abort();
    };
  }, [requestVersion]);

  useEffect(() => {
    if (!embedTarget) {
      setEmbedConfig(null);
      setEmbedError("");
      return;
    }

    const controller = new AbortController();
    setEmbedLoading(true);
    setEmbedError("");
    setEmbedConfig(null);
    setEmbedMode("hybrid");

    void fetch(
      `/api/form-config?product_id=${encodeURIComponent(String(embedTarget.id))}&form=hybrid`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(
            payload.error || "Konfigurasi form produk belum tersedia."
          );
        }
        const config = payload as EmbedConfig & { success: true };
        setEmbedConfig(config);
        setEmbedVariantId(String(config.selected_variant.id));
      })
      .catch((reason) => {
        if (!(reason instanceof Error && reason.name === "AbortError")) {
          setEmbedError(
            reason instanceof Error
              ? reason.message
              : "Konfigurasi form produk belum tersedia."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setEmbedLoading(false);
      });

    return () => controller.abort();
  }, [embedTarget]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return products.filter((product) => {
      const matchesQuery =
        !normalized ||
        [product.id, catalogProductIdOrNull(product.id) ?? "", product.title, product.slug, product.category]
          .join(" ")
          .toLowerCase()
          .includes(normalized);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && Boolean(product.is_active)) ||
        (statusFilter === "draft" && !Boolean(product.is_active));

      const matchesCategory =
        categoryFilter === "all" || product.category === categoryFilter;

      return matchesQuery && matchesStatus && matchesCategory;
    });
  }, [products, query, statusFilter, categoryFilter]);

  const itemsPerPage = 20;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, categoryFilter]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, page]);
  const { activeCount, variantCount, categoryCount } = useMemo(
    () => ({
      activeCount: products.filter((product) => Boolean(product.is_active)).length,
      variantCount: products.reduce(
        (total, product) => total + (product.variants?.length || 0),
        0
      ),
      categoryCount: categories.length,
    }),
    [products, categories]
  );

  const deleteProduct = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(
        `/api/admin/products?id=${encodeURIComponent(String(deleteTarget.id))}`,
        { method: "DELETE", headers: { Accept: "application/json" } }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Produk gagal dihapus.");
      }
      setProducts((current) =>
        current.filter((product) => product.id !== deleteTarget.id)
      );
      toast.success(payload.message || "Produk berhasil dihapus.");
      setDeleteTarget(null);
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : "Produk gagal dihapus."
      );
    } finally {
      setDeleting(false);
    }
  };

  const toggleProductStatus = async (
    product: Product,
    nextActive: boolean
  ) => {
    const productKey = String(product.id);
    if (togglingProductIds.has(productKey)) return;

    const previousActive = Boolean(product.is_active);
    setTogglingProductIds((current) => new Set(current).add(productKey));
    setProducts((current) =>
      current.map((item) =>
        String(item.id) === productKey
          ? { ...item, is_active: nextActive }
          : item
      )
    );

    try {
      const response = await fetch("/api/admin/products", {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: product.id, is_active: nextActive }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
        data?: Product;
      };
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || "Status produk gagal diperbarui.");
      }

      const updatedProduct = payload.data;
      setProducts((current) =>
        current.map((item) =>
          String(item.id) === productKey ? updatedProduct : item
        )
      );
      toast.success(
        payload.message ||
          (nextActive ? "Produk berhasil diaktifkan." : "Produk dijadikan draft.")
      );
    } catch (reason) {
      setProducts((current) =>
        current.map((item) =>
          String(item.id) === productKey
            ? { ...item, is_active: previousActive }
            : item
        )
      );
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Status produk gagal diperbarui."
      );
    } finally {
      setTogglingProductIds((current) => {
        const next = new Set(current);
        next.delete(productKey);
        return next;
      });
    }
  };

  const embedOrigin =
    typeof window === "undefined" ? "" : window.location.origin;
  const selectedVariant = embedVariantId || undefined;
  const buildIntegrationUrl = (path: string, includeMode = false) => {
    if (!embedTarget || !embedOrigin) return "";
    const params = new URLSearchParams({
      ...(includeMode ? { mode: embedMode } : {}),
      product_id: String(embedTarget.id),
    });
    if (selectedVariant) params.set("variant_id", selectedVariant);
    return `${embedOrigin}${path}?${params.toString()}`;
  };
  const standaloneUrl = buildIntegrationUrl(FORM_PATHS[embedMode]);
  const embedUrl = buildIntegrationUrl("/embed/form", true);
  const embedId = `adsbook-order-form-${String(embedTarget?.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;
  const embedMarkup = embedUrl
    ? buildEmbedMarkup({
        origin: embedOrigin,
        embedUrl,
        elementId: embedId,
        title: `Form pemesanan ${embedTarget?.title || "produk"}`,
        productId: String(embedTarget?.id || ""),
        variantId: selectedVariant,
        mode: embedMode,
      })
    : null;
  const iframeHtml = embedMarkup?.plainIframe || "";
  const widgetHtml = embedMarkup?.widget || "";

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} disalin.`);
    } catch {
      toast.error(`${label} gagal disalin. Izinkan akses clipboard browser.`);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl bg-slate-100" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return (
      <section
        className="rounded-xl border border-rose-200 bg-white p-8 text-center shadow-sm"
        role="alert"
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <RefreshCw className="size-6" />
        </div>
        <h2 className="mt-3 text-base font-semibold text-slate-950">
          Daftar produk gagal dimuat
        </h2>
        <p className="mt-1 text-sm text-slate-600">{error}</p>
        <Button
          type="button"
          onClick={() => {
            setLoading(true);
            setRequestVersion((current) => current + 1);
          }}
          className="mt-5"
        >
          Coba lagi
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Metrics Cards / Summary Hierarchy */}
      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label="Ringkasan katalog produk"
      >
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Produk
            </CardTitle>
            <Package className="size-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight text-slate-950">
              {products.length}
            </div>
            <p className="mt-1 hidden text-xs text-slate-500 sm:block">
              Produk terdaftar di katalog.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Produk Aktif
            </CardTitle>
            <CheckCircle2 className="size-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-slate-950">
                {activeCount}
              </span>
              <span className="text-xs font-semibold text-emerald-700">
                ({products.length ? Math.round((activeCount / products.length) * 100) : 0}%)
              </span>
            </div>
            <p className="mt-1 hidden text-xs text-slate-500 sm:block">
              Aktif & tayang di storefront.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Varian
            </CardTitle>
            <Layers className="size-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight text-slate-950">
              {variantCount}
            </div>
            <p className="mt-1 hidden text-xs text-slate-500 sm:block">
              Varian harga & opsi dari seluruh produk.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Kategori
            </CardTitle>
            <Tag className="size-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight text-slate-950">
              {categoryCount}
            </div>
            <p className="mt-1 hidden text-xs text-slate-500 sm:block">
              Kategori unik produk.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Main Catalog Container */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {/* Controls Header: Search, Filters, Stats */}
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
          <SearchInput className="flex-1" value={query} onValueChange={setQuery} placeholder="Cari nama produk, ID, slug, atau kategori..." aria-label="Cari produk" />

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Status Pills */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/60 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                aria-pressed={statusFilter === "all"}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
                  statusFilter === "all"
                    ? "bg-white text-slate-950 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Semua
                <span className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-xs tabular-nums text-slate-700">
                  {products.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("active")}
                aria-pressed={statusFilter === "active"}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
                  statusFilter === "active"
                    ? "bg-white text-emerald-800 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Aktif
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs tabular-nums text-emerald-800">
                  {activeCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("draft")}
                aria-pressed={statusFilter === "draft"}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
                  statusFilter === "draft"
                    ? "bg-white text-slate-950 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Draft
                <span className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-xs tabular-nums text-slate-700">
                  {products.length - activeCount}
                </span>
              </button>
            </div>

            {/* Filter Category Select */}
            {categories.length > 0 && (
              <div className="relative">
                <div className="w-full sm:w-48">
                  <FilterSelect
                    id="product-category-filter"
                    ariaLabel="Filter kategori produk"
                    icon={Tags}
                    value={categoryFilter}
                    onValueChange={setCategoryFilter}
                    options={[{ value: "all", label: "Semua kategori" }, ...categories.map((category) => ({ value: category, label: category }))]}
                  />
                </div>
              </div>
            )}

            {/* The page header owns "Tambah produk"; a second one here was the same link twice. */}
          </div>
        </div>

        {/* Results Counter Bar */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-4 py-2.5 text-xs font-medium text-slate-500 lg:px-5">
          <span>
            Menampilkan <strong>{filtered.length}</strong> dari <strong>{products.length}</strong> produk
            {products.length >= 200 && " (200 terbaru — produk lebih lama tidak tampil di sini)"}
          </span>
          {(query || statusFilter !== "all" || categoryFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
                setCategoryFilter("all");
              }}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline"
            >
              Reset filter
            </button>
          )}
        </div>

        {/* Empty State / Content */}
        {products.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Package className="size-7" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-950">Belum ada produk</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Katalog produk Anda masih kosong. Tambahkan produk pertama untuk mulai berjualan.
            </p>
            <a
              href="/admin/products/new"
              className={buttonVariants({ variant: "default", className: "mt-5" })}
            >
              <Plus className="size-4" />
              Tambah produk pertama
            </a>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Filter className="size-6" />
            </div>
            <h3 className="mt-3 text-base font-semibold text-slate-950">Produk tidak ditemukan</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Tidak ada produk yang cocok dengan pencarian atau filter yang dipilih.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
                setCategoryFilter("all");
              }}
              className="mt-4 px-4"
            >
              Reset filter pencarian
            </Button>
          </div>
        ) : !isDesktop ? (
          /* Mobile Product Card List.
             grid-cols-1 is load-bearing: it expands to minmax(0, 1fr). Without it the
             implicit column is sized `auto`, so a card's min-content width — driven by
             the `truncate` (white-space: nowrap) title and slug — widens the column past
             the viewport. The wrapper clips that overflow, which put the status switch
             and the Aksi menu off-screen and unreachable on mobile. */
          <div className="grid grid-cols-1 gap-3 p-4 lg:hidden" aria-label="Daftar produk mobile">
            {paginated.map((product) => {
              const priceRange = getProductPriceRange(product.variants);

              return (
                <article
                  key={product.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-start gap-3">
                    <div className="size-16 shrink-0 rounded-lg border border-slate-100 bg-slate-50 overflow-hidden flex items-center justify-center">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover"
                        />
                      ) : (
                        <Package className="size-7 text-slate-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {/* Two lines before an ellipsis: the name is what the operator scans for. */}
                          <h3 className="line-clamp-2 break-words font-semibold text-sm text-slate-950">
                            <a
                              href={`/admin/products/edit?id=${encodeURIComponent(String(product.id))}`}
                              className="hover:text-emerald-700 hover:underline"
                            >
                              {product.title}
                            </a>
                          </h3>
                          <p className="mt-0.5 font-mono text-xs text-slate-500 truncate">
                            /{product.slug}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={product.is_active ? "default" : "secondary"}
                            className={
                              product.is_active
                                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 font-semibold text-xs"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-100 font-semibold text-xs"
                            }
                          >
                            {product.is_active ? "Aktif" : "Draft"}
                          </Badge>
                          <Switch
                            size="sm"
                            checked={Boolean(product.is_active)}
                            disabled={togglingProductIds.has(String(product.id))}
                            onCheckedChange={(checked) =>
                              void toggleProductStatus(product, checked)
                            }
                            aria-label={`${Boolean(product.is_active) ? "Nonaktifkan" : "Aktifkan"} ${product.title}`}
                            title={
                              Boolean(product.is_active)
                                ? "Jadikan draft"
                                : "Aktifkan produk"
                            }
                          />
                        </div>
                      </div>

                      {product.category && (
                        <div className="mt-1.5">
                          <Badge variant="outline" className="text-xs py-0 px-2 text-slate-600 font-normal">
                            {product.category}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>

                  <dl className="mt-3.5 grid grid-cols-3 gap-2 rounded-lg bg-slate-50/80 p-2.5 text-xs">
                    <div>
                      <dt className="text-xs text-slate-500 uppercase font-semibold">Content ID</dt>
                      <dd className="mt-0.5 font-mono font-semibold text-slate-900 text-xs truncate">
                        {catalogProductIdOrNull(product.id) ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase font-semibold">Harga</dt>
                      <dd className="mt-0.5 font-semibold text-slate-900 text-xs truncate">
                        {priceRange || "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 uppercase font-semibold">Varian</dt>
                      <dd className="mt-0.5 font-semibold text-slate-900 text-xs">
                        {product.variants?.length || 0} opsi
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex gap-2">
                    <ProductActions
                      product={product}
                      onDelete={setDeleteTarget}
                      onEmbed={setEmbedTarget}
                      onCopyId={(id) => void copyText(String(id), "Content ID")}
                      fullWidth
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* Desktop Product Table */
          <div className="hidden overflow-x-auto lg:block" aria-label="Tabel produk desktop">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <TableHead className="py-3 pl-5 pr-4 w-[340px]">Produk</TableHead>
                  <TableHead className="py-3 px-4 w-[160px]">Harga</TableHead>
                  <TableHead className="py-3 px-4 w-[180px]">Content ID</TableHead>
                  <TableHead className="py-3 px-4 w-[100px]">Varian</TableHead>
                  <TableHead className="py-3 px-4 w-[110px]">Status</TableHead>
                  <TableHead className="py-3 pr-5 pl-4 text-right w-[90px]">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((product) => {
                  const priceRange = getProductPriceRange(product.variants);

                  return (
                    <TableRow key={product.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Product details cell with thumbnail */}
                      <TableCell className="py-3.5 pl-5 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="size-12 shrink-0 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                            {product.image_url ? (
                              <img
                                src={product.image_url}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="size-full object-cover"
                              />
                            ) : (
                              <Package className="size-5 text-slate-300" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <a
                                href={`/admin/products/edit?id=${encodeURIComponent(String(product.id))}`}
                                className="font-semibold text-slate-950 text-sm hover:text-emerald-700 hover:underline"
                              >
                                {product.title}
                              </a>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="font-mono text-xs text-slate-400">
                                /{product.slug}
                              </span>
                              {product.category && (
                                <>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-xs font-medium text-slate-500">
                                    {product.category}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Price range */}
                      <TableCell className="py-3.5 px-4">
                        <span className="font-semibold text-slate-900 text-sm">
                          {priceRange || <span className="text-slate-400 font-normal text-xs">Belum set</span>}
                        </span>
                      </TableCell>

                      {/* Content ID */}
                      <TableCell className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(
                              catalogProductIdOrNull(product.id) ?? String(product.id),
                              "Product / Content ID",
                            )
                          }
                          className="group inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-slate-100 transition-colors text-left"
                          title="Klik untuk menyalin Content ID"
                        >
                          <span className="font-mono text-xs font-semibold text-slate-700 group-hover:text-slate-950">
                            {catalogProductIdOrNull(product.id) ?? "—"}
                          </span>
                          <Copy className="size-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      </TableCell>

                      {/* Variant count */}
                      <TableCell className="py-3.5 px-4 font-semibold text-slate-700 text-xs">
                        {product.variants?.length || 0} varian
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={product.is_active ? "default" : "secondary"}
                            className={
                              product.is_active
                                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 font-semibold text-xs gap-1"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-100 font-semibold text-xs"
                            }
                          >
                            {product.is_active && (
                              <span className="size-1.5 rounded-full bg-emerald-600" />
                            )}
                            {product.is_active ? "Aktif" : "Draft"}
                          </Badge>
                          <Switch
                            size="sm"
                            checked={Boolean(product.is_active)}
                            disabled={togglingProductIds.has(String(product.id))}
                            onCheckedChange={(checked) =>
                              void toggleProductStatus(product, checked)
                            }
                            aria-label={`${Boolean(product.is_active) ? "Nonaktifkan" : "Aktifkan"} ${product.title}`}
                            title={
                              Boolean(product.is_active)
                                ? "Jadikan draft"
                                : "Aktifkan produk"
                            }
                          />
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3.5 pr-5 pl-4 text-right">
                        <ProductActions
                          product={product}
                          onDelete={setDeleteTarget}
                          onEmbed={setEmbedTarget}
                          onCopyId={(id) => void copyText(String(id), "Content ID")}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-5 py-3.5">
            <p className="text-xs text-slate-500 font-medium">
              Menampilkan <span className="font-semibold text-slate-900">{(page - 1) * itemsPerPage + 1}</span>–
              <span className="font-semibold text-slate-900">{Math.min(page * itemsPerPage, filtered.length)}</span> dari{" "}
              <span className="font-semibold text-slate-900">{filtered.length}</span> produk
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 bg-white"
              >
                Sebelumnya
              </Button>
              <div className="flex items-center gap-1 px-2 text-xs font-semibold text-slate-700">
                Halaman {page} dari {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 bg-white"
              >
                Selanjutnya
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Embed Dialog */}
      <Dialog
        open={Boolean(embedTarget)}
        onOpenChange={(open) => {
          if (!open) setEmbedTarget(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="size-5 text-emerald-600" />
              <span>Embed Checkout Form - {embedTarget?.title}</span>
            </DialogTitle>
            <DialogDescription>
              Pilih alur dan varian awal. Snippet embed selalu menggunakan ID produk dan varian canonical dari AdsBookCMS.
            </DialogDescription>
          </DialogHeader>

          {embedLoading ? (
            <Skeleton className="h-48 rounded-xl bg-slate-100" />
          ) : embedError ? (
            <section
              className="rounded-xl border border-amber-200 bg-amber-50 p-4"
              role="alert"
            >
              <p className="text-sm font-semibold text-slate-950">
                Form belum dapat di-embed
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-900">
                {embedError}
              </p>
            </section>
          ) : embedConfig ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Mode Form Checkout
                  </span>
                  <Select
                    items={EMBED_MODE_LABELS}
                    value={embedMode}
                    onValueChange={(value) => value && setEmbedMode(value as FormMode)}
                  >
                    <SelectTrigger aria-label="Mode form" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(EMBED_MODE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Varian Awal (Default)
                  </span>
                  <Select
                    items={Object.fromEntries(embedConfig.variants.map((variant) => [String(variant.id), variant.label]))}
                    value={embedVariantId}
                    onValueChange={(value) => value && setEmbedVariantId(String(value))}
                  >
                    <SelectTrigger aria-label="Varian awal" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {embedConfig.variants.map((variant) => (
                        <SelectItem key={String(variant.id)} value={String(variant.id)}>
                          {variant.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              {/* Recommended Widget Code */}
              <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-950">
                      AdsBookCMS Widget Snippet
                    </h3>
                    <Badge variant="default" className="bg-emerald-700 text-white font-semibold text-xs uppercase">
                      Direkomendasikan
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800"
                    onClick={() => void copyText(widgetHtml, "AdsBookCMS Widget")}
                  >
                    <Copy className="size-3.5" />
                    Salin Snippet
                  </Button>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-emerald-900">
                  Tempel snippet ini di website atau Landing Page Anda. Form akan tampil langsung, responsif, dan tinggi otomatis menyesuaikan isi.
                </p>
                <textarea
                  value={widgetHtml}
                  readOnly
                  rows={6}
                  aria-label="AdsBookCMS widget embed"
                  className="mt-3 w-full resize-y rounded-lg border border-emerald-300 bg-white p-3 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
              </section>

              {/* Advanced / Alternative Options */}
              <details className="group [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none">
                  <span>Opsi Lanjutan (Link Form Direct & Plain Iframe)</span>
                  <ChevronDown className="size-4 text-slate-500 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                </summary>

                <div className="mt-3 space-y-4 rounded-xl border border-slate-200 p-4 bg-white">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-semibold text-slate-950">Direct Form URL</h4>
                        <p className="mt-0.5 text-xs text-slate-500">Untuk tombol redirect CTA di Landing Page eksternal.</p>
                      </div>
                      <a
                        href={standaloneUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <span>Preview</span>
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={standaloneUrl}
                        readOnly
                        aria-label="Link form produk"
                        className="min-w-0 font-mono"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 px-3 gap-1.5"
                        onClick={() => void copyText(standaloneUrl, "Link Form URL")}
                      >
                        <Copy className="size-3.5" />
                        Salin
                      </Button>
                    </div>
                  </div>

                  <div className="h-px bg-slate-100" />

                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-slate-950">Plain Iframe (Tanpa Script JS)</h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void copyText(iframeHtml, "Iframe HTML")}
                      >
                        <Copy className="size-3.5" />
                        Salin Iframe
                      </Button>
                    </div>
                    <textarea
                      value={iframeHtml}
                      readOnly
                      rows={3}
                      aria-label="Iframe embed tanpa JavaScript"
                      className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs leading-5 text-slate-800"
                    />
                  </div>
                </div>
              </details>

              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                <strong>Versi snippet: v{EMBED_SNIPPET_VERSION}.</strong>{" "}
                Snippet yang sudah ditempel tidak ikut ter-update saat sistem
                di-deploy. Setiap kali halaman merchant memuat form dengan versi
                lama, sistem mencatat <code className="font-mono">embed-snippet-stale</code>{" "}
                beserta domain halaman tersebut di Workers Logs — minta merchant
                menyalin ulang snippet di atas bila itu muncul.
              </p>

              <p className="rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-xs leading-5 text-blue-900">
                <strong>Keamanan Domain Embed:</strong> Pastikan domain website tempat embed ditambahkan ke daftar domain di <strong>Pengaturan → Store & CS → Domain untuk Embed</strong> agar form diizinkan memuat.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus produk ini?</DialogTitle>
            <DialogDescription>
              <strong className="text-slate-900">{deleteTarget?.title}</strong>{" "}
              dan seluruh variannya akan dihapus secara permanen dari sistem.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <strong>Catatan:</strong> Bila produk ini sudah memiliki transaksi order, menghapus produk akan mempengaruhi riwayat katalog. Anda juga dapat mengubah status ke <strong>Draft</strong> untuk menonaktifkan penjualan.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={deleting}>
                Batal
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteProduct()}
            >
              {deleting ? "Menghapus..." : "Ya, hapus produk"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
