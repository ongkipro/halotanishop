import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { ImagePlus, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../ui/input-group";
import { Textarea } from "../ui/textarea";
import { DistrictCombobox, type DistrictOption } from "./DistrictCombobox";
import { searchTaxonomy, suggestGoogleCategories, taxonomyLeaf, type TaxonomyRow } from "../../lib/google-taxonomy";
import { catalogProductIdOrNull } from "../../lib/catalog-feed";
import { formatKg } from "../../lib/weight";
import {
  CARD_IMAGE_EDGE,
  MAX_ENCODED_BYTES,
  convertImageToWebP,
} from "../../lib/client-image";
type Variant = {
  key: string;
  id?: number | string;
  sku: string;
  title: string;
  price: string;
  compare_price: string;
  weight_grams: string;
  stock: string;
};
type ProductPayload = {
  id?: number | string;
  title: string;
  slug: string;
  category: string;
  brand: string;
  description: string;
  google_category_id: number | null;
  google_category_path: string;
  image_url: string;
  is_active: boolean;
  variants: Array<{
    id?: number | string;
    sku: string;
    title: string;
    price: number;
    compare_price?: number;
    // Null only when the operator left it empty; the server refuses that for a
    // new variant and keeps the stored weight for an existing one.
    weight_grams: number | null;
    stock: number;
  }>;
};
type ProductVariantResponse = {
  id: number | string;
  sku: string;
  title: string;
  price: number;
  compare_price: number | null;
  weight_grams: number;
  stock: number;
};
type ProductResponse = {
  id: number | string;
  title: string;
  slug: string;
  category: string | null;
  brand?: string | null;
  description?: string | null;
  google_category_id?: number | null;
  google_category_path?: string | null;
  image_url: string | null;
  is_active: number | boolean;
  variants: ProductVariantResponse[];
};
const emptyVariant = (key: string): Variant => ({
  key,
  sku: "",
  title: "",
  price: "",
  compare_price: "",
  // Empty, not 1000: the weight sets the Mengantar shipping cost, so a new
  // variant must state it (PRD A41, REQ-231).
  weight_grams: "",
  stock: "1000",
});
const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Google's taxonomy (~5,600 rows) is fetched once, on the first search, from
// the static asset scripts/generate-google-taxonomy.mjs writes.
let taxonomyRows: Promise<TaxonomyRow[]> | null = null;
const loadTaxonomy = () =>
  (taxonomyRows ??= fetch("/data/google-product-taxonomy.json")
    .then((response) => {
      if (!response.ok) throw new Error("Daftar kategori Google gagal dimuat.");
      return response.json() as Promise<{ categories: TaxonomyRow[] }>;
    })
    .then((data) => data.categories)
    .catch((error) => {
      taxonomyRows = null;
      throw error;
    }));
const taxonomyOption = ([id, path]: TaxonomyRow): DistrictOption => ({
  id: String(id),
  label: taxonomyLeaf(path),
  detail: `${id} · ${path}`,
});
const searchGoogleCategory = async (query: string) =>
  searchTaxonomy(await loadTaxonomy(), query).map(taxonomyOption);

export function ProductForm({ productId, storeName = "" }: { productId?: string; storeName?: string }) {
  const editing = Boolean(productId);
  const nextVariantKey = useRef(1);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  // Category, brand and description used to have no field at all: every
  // product was "Umum", the feeds named the store as every product's brand, and
  // the product page described itself from its own title.
  const [category, setCategory] = useState("Umum");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(editing);
  const [googleCategory, setGoogleCategory] = useState<DistrictOption | null>(null);
  // "auto": picked by the form from the product's own name and label, and
  // re-picked as they change. "manual": chosen or cleared by the operator, or
  // saved before — never overwritten.
  const [categorySource, setCategorySource] = useState<"auto" | "manual" | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyRow[] | null>(null);
  useEffect(() => {
    loadTaxonomy().then(setTaxonomy).catch(() => setTaxonomy(null));
  }, []);
  const suggestions = useMemo(
    () => (taxonomy ? suggestGoogleCategories(taxonomy, { title, category, description }) : []),
    [taxonomy, title, category, description],
  );
  useEffect(() => {
    if (loading || categorySource === "manual" || !suggestions.length) return;
    const top = taxonomyOption(suggestions[0]);
    if (top.id === googleCategory?.id) return;
    setGoogleCategory(top);
    setCategorySource("auto");
  }, [suggestions, loading, categorySource, googleCategory?.id]);
  const chooseCategory = (option: DistrictOption | null) => {
    setGoogleCategory(option);
    setCategorySource("manual");
    // The store's own label follows the first pick; an edited label is the
    // merchant's and is left alone.
    if (option && (!category.trim() || category.trim() === "Umum")) setCategory(option.label);
  };
  const [active, setActive] = useState(!editing);
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [variants, setVariants] = useState<Variant[]>(() => [
    emptyVariant("new-0"),
  ]);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"idle" | "error" | "success">(
    "idle",
  );

  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    void fetch(`/api/admin/products?id=${encodeURIComponent(productId)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success)
          throw new Error(payload.error || "Produk gagal dimuat.");
        return payload.data as ProductResponse;
      })
      .then((product) => {
        setTitle(product.title || "");
        setSlug(product.slug || "");
        setCategory(product.category || "Umum");
        setBrand(product.brand || "");
        setDescription(product.description || "");
        if (product.google_category_id && product.google_category_path) {
          setGoogleCategory(taxonomyOption([Number(product.google_category_id), product.google_category_path]));
          setCategorySource("manual");
        }
        setImageUrl(product.image_url || "");
        setActive(product.is_active !== undefined ? Boolean(product.is_active) : true);
        setVariants(
          Array.isArray(product.variants) && product.variants.length
            ? product.variants.map((variant: ProductVariantResponse) => ({
                key: `saved-${variant.id}`,
                id: variant.id,
                sku: variant.sku || "",
                title: variant.title || "",
                price: String(variant.price ?? ""),
                compare_price: String(variant.compare_price ?? ""),
                weight_grams: String(variant.weight_grams ?? ""),
                stock: String(variant.stock ?? 0),
              }))
            : [emptyVariant("new-0")],
        );
      })
      .catch((reason) => {
        if (!(reason instanceof Error && reason.name === "AbortError")) {
          setLoadError(
            reason instanceof Error ? reason.message : "Produk gagal dimuat.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productId]);

  const updateVariant = (index: number, field: keyof Variant, value: string) =>
    setVariants((current) =>
      current.map((variant, itemIndex) =>
        itemIndex === index ? { ...variant, [field]: value } : variant,
      ),
    );
  const capitalizeTitle = (text: string) =>
    text
      .split(" ")
      .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""))
      .join(" ");

  const onTitleChange = (value: string) => {
    const formatted = capitalizeTitle(value);
    setTitle(formatted);
    setSlug(slugify(formatted));
  };

  // The conversion rules live in src/lib/client-image.ts, shared with the
  // content workbench so the two upload paths cannot disagree again. The old
  // local copy passed any WebP under 2MB through untouched — which is how a
  // high-quality 132KB hero reached R2 unrecompressed.
  const MAX_IMAGE_SIZE = MAX_ENCODED_BYTES;

  const uploadImage = async (file: File) => {
    if (file.size > MAX_IMAGE_SIZE) {
      setStatusTone("error");
      setStatus("Ukuran file maksimal 2 MB.");
      return;
    }
    setUploading(true);
    setStatusTone("idle");
    setStatus("Mengonversi & mengunggah gambar WebP…");
    try {
      const webpFile = await convertImageToWebP(file);
      const formData = new FormData();
      formData.set("file", webpFile);
      const response = await fetch("/api/admin/upload-r2", {
        method: "POST",
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success || !result.url) {
        throw new Error(result.error || "Gambar gagal diunggah.");
      }
      setImageUrl(String(result.url));

      // The card-sized sibling. Its absence is not an error: the asset route
      // falls back to the full image, so a failure here costs bytes on the
      // catalogue grid rather than a broken tile, and must not lose an upload
      // the operator already completed.
      try {
        const cardFile = await convertImageToWebP(webpFile, CARD_IMAGE_EDGE);
        const cardForm = new FormData();
        cardForm.set("file", cardFile);
        cardForm.set("derivative_of", String(result.fileName || ""));
        await fetch("/api/admin/upload-r2", { method: "POST", body: cardForm });
      } catch {
        // deliberately ignored - see above
      }

      setStatusTone("success");
      setStatus("Gambar berhasil diunggah dalam format WebP.");
    } catch (reason) {
      setStatusTone("error");
      setStatus(
        reason instanceof Error ? reason.message : "Gambar gagal diunggah.",
      );
    } finally {
      setUploading(false);
    }
  };
  const submit = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const missingWeight = variants.find((variant) => !variant.weight_grams.trim());
    if (missingWeight) {
      setStatusTone("error");
      setStatus(
        `Berat varian ${missingWeight.sku.trim().toUpperCase() || "baru"} wajib diisi (gram).`,
      );
    }
    if (!form.reportValidity()) return;
    setSaving(true);
    setStatusTone("idle");
    setStatus("Menyimpan produk…");
    const payloadVariants = variants.map((variant) => ({
      ...(variant.id ? { id: variant.id } : {}),
      sku: variant.sku.trim().toUpperCase(),
      title: variant.title.trim(),
      price: Number(variant.price),
      ...(variant.compare_price
        ? { compare_price: Number(variant.compare_price) }
        : {}),
      weight_grams: variant.weight_grams.trim()
        ? Number(variant.weight_grams)
        : null,
      stock: Number(variant.stock),
    }));

    const invalidVariant = payloadVariants.find((v) => v.title.length > 15);
    if (invalidVariant) {
      setStatusTone("error");
      setStatus(`Nama varian "${invalidVariant.title}" melebihi batas maksimal 15 karakter.`);
      setSaving(false);
      return;
    }

    const payload: ProductPayload = {
      ...(productId ? { id: productId } : {}),
      title: title.trim(),
      slug: slug.trim(),
      category: category.trim() || "Umum",
      brand: brand.trim(),
      description: description.trim(),
      google_category_id: googleCategory ? Number(googleCategory.id) : null,
      google_category_path: googleCategory?.detail?.replace(/^\d+ · /, "") ?? "",
      image_url: imageUrl,
      is_active: active,
      variants: payloadVariants,
    };
    try {
      const response = await fetch("/api/admin/products", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success)
        throw new Error(result.error || "Produk gagal disimpan.");
      setStatusTone("success");
      setStatus(result.message || "Produk berhasil disimpan.");
      window.location.assign("/admin/products");
    } catch (reason) {
      setStatusTone("error");
      setStatus(
        reason instanceof Error ? reason.message : "Produk gagal disimpan.",
      );
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div
        className="h-96 animate-pulse rounded-xl bg-slate-100"
        aria-label="Memuat formulir produk"
        aria-busy="true"
      />
    );
  if (loadError)
    return (
      <section
        className="rounded-xl border border-rose-200 bg-slate-50 p-8 text-center shadow-sm"
        role="alert"
      >
        <h2 className="text-base font-semibold text-slate-950">
          Produk gagal dimuat
        </h2>
        <p className="mt-2 text-sm text-slate-600">{loadError}</p>
        <a
          href="/admin/products"
          className="btn-primary mt-5 bg-emerald-700 hover:bg-emerald-800 focus-visible:outline-emerald-700"
        >
          Kembali ke katalog
        </a>
      </section>
    );

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"
      noValidate
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-base font-semibold text-slate-950">
              Informasi produk
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Identitas katalog dan status storefront.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                Nama produk
              </span>
              <Input
                required
                maxLength={160}
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                className="admin-input-flat focus-visible:border-emerald-700 focus-visible:ring-emerald-700/20"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                Slug
              </span>
              <Input
                required
                maxLength={180}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                value={slug}
                onChange={(event) => {
                  setSlug(slugify(event.target.value));
                }}
                className="admin-input-flat font-mono focus-visible:border-emerald-700 focus-visible:ring-emerald-700/20"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Huruf kecil, angka, dan tanda hubung.
              </span>
            </label>
            <div className="md:col-span-2">
              <div className="mb-1.5 flex items-center gap-2">
                <label htmlFor="google-category" className="text-xs font-semibold text-slate-700">
                  Kategori Google
                </label>
                {googleCategory && categorySource === "auto" && <Badge variant="secondary">Otomatis</Badge>}
                {googleCategory && categorySource === "manual" && <Badge variant="outline">Manual</Badge>}
              </div>
              <DistrictCombobox
                id="google-category"
                value={googleCategory}
                onChange={chooseCategory}
                search={searchGoogleCategory}
                minChars={2}
                placeholder="Cari: sabun, serum wajah, cuka, lampu… atau ID"
                searchingText="Mencari kategori…"
                emptyText="Kategori tidak ditemukan. Coba kata lain atau istilah Inggris."
                describedBy="google-category-hint"
              />
              <span id="google-category-hint" className="mt-1 block text-xs text-slate-500">
                {googleCategory?.detail
                  ? categorySource === "auto"
                    ? `Dipilih otomatis dari nama produk: ${googleCategory.detail}. Periksa, lalu ganti bila kurang tepat.`
                    : googleCategory.detail
                  : "Taksonomi resmi Google. ID-nya dikirim apa adanya ke feed Google Merchant dan katalog Meta."}
              </span>
              {suggestions.some(([id]) => String(id) !== googleCategory?.id) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500">Saran lain:</span>
                  {suggestions
                    .filter(([id]) => String(id) !== googleCategory?.id)
                    .map((row) => (
                      <Button
                        key={row[0]}
                        type="button"
                        variant="outline"
                        size="sm"
                        title={`${row[0]} · ${row[1]}`}
                        onClick={() => chooseCategory(taxonomyOption(row))}
                      >
                        {taxonomyLeaf(row[1])}
                      </Button>
                    ))}
                </div>
              )}
            </div>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                Label kategori di toko
              </span>
              <Input
                maxLength={120}
                value={category}
                placeholder="Contoh: Perawatan Wajah"
                onChange={(event) => setCategory(event.target.value)}
                className="admin-input-flat focus-visible:border-emerald-700 focus-visible:ring-emerald-700/20"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Nama yang dilihat pembeli di breadcrumb dan kartu produk.
              </span>
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                Merek
              </span>
              <Input
                maxLength={70}
                value={brand}
                placeholder={storeName ? `Default: ${storeName}` : "Default: nama toko"}
                onChange={(event) => setBrand(event.target.value)}
                className="admin-input-flat focus-visible:border-emerald-700 focus-visible:ring-emerald-700/20"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Kosong = nama toko. Isi merek pabrikan bila produk punya merek sendiri.
              </span>
            </label>
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                Deskripsi produk
              </span>
              <Textarea
                maxLength={5000}
                rows={5}
                value={description}
                placeholder="Bahan, ukuran, cara pakai, isi paket. Tulis fakta produk, bukan ajakan beli."
                onChange={(event) => setDescription(event.target.value)}
                className="admin-input-flat min-h-36 focus-visible:border-emerald-700 focus-visible:ring-emerald-700/20"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Tampil di halaman produk dan dikirim ke feed Google/Meta. {description.trim().length}/5000
              </span>
            </label>
            <div className="md:col-span-2">
              <span
                id="product-image-label"
                className="mb-1.5 block text-xs font-semibold text-slate-700"
              >
                Foto produk
              </span>
              {/* One drop target for drag-and-drop and click. The native file
                  input stays in the DOM, visually hidden, so keyboard and
                  screen-reader users reach it through the buttons below. */}
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!uploading) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file && !uploading) void uploadImage(file);
                }}
                data-drag={dragOver ? "true" : undefined}
                className="grid grid-cols-1 gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 transition-colors data-[drag=true]:border-emerald-600 data-[drag=true]:bg-emerald-50 sm:grid-cols-[136px_1fr] sm:items-center"
              >
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  aria-label={imageUrl ? "Ganti foto produk" : "Pilih foto produk"}
                  className="relative flex aspect-square w-full max-w-[136px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={`Pratinjau ${title || "produk"}`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="flex flex-col items-center gap-1.5 px-2 text-center text-xs font-medium text-slate-500">
                      <ImagePlus className="size-6 text-slate-400" aria-hidden="true" />
                      Belum ada foto
                    </span>
                  )}
                  {uploading && (
                    <span className="absolute inset-0 flex items-center justify-center bg-white/80">
                      <LoaderCircle className="size-6 animate-spin text-emerald-700" aria-hidden="true" />
                    </span>
                  )}
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {uploading
                      ? "Mengunggah foto…"
                      : imageUrl
                        ? "Foto tersimpan di produk"
                        : "Tarik foto ke sini, atau pilih dari perangkat"}
                  </p>
                  <p
                    id="product-image-hint"
                    className="mt-1 text-xs leading-5 text-slate-500"
                  >
                    JPG, PNG, WebP, AVIF atau GIF, maksimal 2 MB. Otomatis dikonversi ke WebP.
                    Disarankan persegi 1:1, minimal 800×800 px, latar polos — dipakai juga oleh
                    feed Google dan Meta.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => fileInput.current?.click()}
                    >
                      {imageUrl ? <RefreshCw aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
                      {imageUrl ? "Ganti foto" : "Pilih foto"}
                    </Button>
                    {imageUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={uploading}
                        onClick={() => setImageUrl("")}
                        className="text-rose-700 hover:text-rose-800"
                      >
                        <Trash2 aria-hidden="true" />
                        Hapus foto
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileInput}
                    id="product-image"
                    aria-labelledby="product-image-label"
                    aria-describedby="product-image-hint"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadImage(file);
                      event.target.value = "";
                    }}
                    className="sr-only"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Varian produk
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                ID varian dibuat otomatis saat disimpan; atur nama, SKU, harga, dan berat.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setVariants((current) => [
                  ...current,
                  emptyVariant(`new-${nextVariantKey.current++}`),
                ])
              }
              className="btn-secondary"
            >
              Tambah varian
            </button>
          </div>
          <div className="space-y-4 p-5">
            {variants.map((variant, index) => (
              <fieldset
                key={variant.key}
                className="rounded-xl border border-slate-200"
              >
                {/* The variant's identity is its header: name, its saved ID (or
                    "Baru"), and its remove action. The ID used to sit in a grey
                    box inside the input grid, a different height from every
                    field beside it. */}
                <legend className="sr-only">Varian {index + 1}</legend>
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      Varian {index + 1}
                    </span>
                    {variant.id ? (
                      <Badge variant="outline" className="font-mono">
                        ID {variant.id}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Baru</Badge>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={variants.length === 1}
                    onClick={() =>
                      setVariants((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    aria-label={`Hapus varian ${index + 1}`}
                    className="text-rose-700 hover:text-rose-800"
                  >
                    <Trash2 aria-hidden="true" />
                    Hapus
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-x-3 gap-y-4 p-4 sm:grid-cols-6">
                  <label className="sm:col-span-3">
                    <span className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                      Nama varian
                      <span className={variant.title.length > 15 ? "font-semibold text-red-600" : "font-medium text-slate-400"}>
                        {variant.title.length}/15
                      </span>
                    </span>
                    <Input
                      required
                      maxLength={15}
                      value={variant.title}
                      placeholder="500 ml / Isi 3"
                      onChange={(event) =>
                        updateVariant(index, "title", event.target.value)
                      }
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      Ukuran atau isi paket, mis. 500 ml, 1 Liter, Isi 3.
                    </span>
                  </label>
                  <label className="sm:col-span-3">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">
                      SKU
                    </span>
                    <Input
                      required
                      maxLength={80}
                      value={variant.sku}
                      onChange={(event) =>
                        updateVariant(
                          index,
                          "sku",
                          event.target.value.toUpperCase(),
                        )
                      }
                      className="font-mono uppercase"
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      Kode stok internal untuk gudang dan order.
                    </span>
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">
                      Harga jual
                    </span>
                    <InputGroup>
                      <InputGroupAddon>
                        <InputGroupText>Rp</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        required
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={variant.price}
                        onChange={(event) =>
                          updateVariant(index, "price", event.target.value)
                        }
                      />
                    </InputGroup>
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">
                      Harga coret
                    </span>
                    <InputGroup>
                      <InputGroupAddon>
                        <InputGroupText>Rp</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={variant.compare_price}
                        onChange={(event) =>
                          updateVariant(
                            index,
                            "compare_price",
                            event.target.value,
                          )
                        }
                      />
                    </InputGroup>
                    <span className="mt-1 block text-xs text-slate-500">
                      {Number(variant.compare_price) > Number(variant.price) && Number(variant.price) > 0
                        ? `Hemat ${Math.round((1 - Number(variant.price) / Number(variant.compare_price)) * 100)}%`
                        : "Opsional, harus lebih tinggi dari harga jual."}
                    </span>
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">
                      Berat kirim
                    </span>
                    <InputGroup>
                      <InputGroupInput
                        required
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        max="50000"
                        placeholder="Contoh: 250"
                        aria-describedby={`variant-weight-hint-${variant.key}`}
                        value={variant.weight_grams}
                        onChange={(event) =>
                          updateVariant(index, "weight_grams", event.target.value)
                        }
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>gram</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                    <span
                      id={`variant-weight-hint-${variant.key}`}
                      className="mt-1 block text-xs text-slate-500"
                    >
                      Dipakai untuk ongkir Mengantar
                      {Number(variant.weight_grams) > 0
                        ? ` · ${formatKg(Number(variant.weight_grams))}`
                        : ""}
                    </span>
                  </label>
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      </div>
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {imageUrl && (
            <div className="flex aspect-[16/9] items-center justify-center border-b border-slate-100 bg-slate-50 p-4">
              <img
                src={imageUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            </div>
          )}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Ringkasan
                </p>
                <h2 className="mt-2 break-words text-xl font-semibold text-slate-950">
                  {title || (editing ? "Produk tanpa nama" : "Produk baru")}
                </h2>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
              >
                {active ? "Aktif" : "Draft"}
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-slate-500">Product / Content ID</dt>
                <dd className="mt-1 font-mono font-semibold text-slate-900">
                  {/* `catalogProductId` throws on a row that predates the
                      five-digit scheme, and a throw in a React render blanks
                      the whole form — leaving the operator unable to open, see
                      or repair the very product that needs it. That failure is
                      what `catalogProductIdOrNull` was written for; it was
                      applied to ProductCatalog and missed here. */}
                  {productId ? catalogProductIdOrNull(productId) ?? "—" : "Otomatis"}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-slate-500">Varian</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {variants.length}
                </dd>
              </div>
              <div className="col-span-2 rounded-lg bg-slate-50 p-3">
                <dt className="text-slate-500">Slug</dt>
                <dd className="mt-1 break-all font-mono font-semibold text-slate-900">
                  {slug || "Belum diisi"}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-slate-500">Kategori</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {category || "Umum"}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-slate-500">Foto</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {imageUrl ? "Tersimpan" : "Belum ada"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Product ID menjadi <code>content_id</code> untuk tracking Meta
              dan Google.
            </p>
            <button
              type="submit"
              disabled={saving || uploading}
              className="btn-primary mt-6 w-full bg-emerald-700 hover:bg-emerald-800 focus-visible:outline-emerald-700"
            >
              {saving ? "Menyimpan…" : "Simpan Produk"}
            </button>
            <a
              href="/admin/products"
              className="btn-secondary mt-2 w-full"
            >
              Batal
            </a>
            <p
              className={`mt-4 min-h-5 text-xs font-semibold ${statusTone === "error" ? "text-rose-700" : statusTone === "success" ? "text-emerald-700" : "text-slate-500"}`}
              role="status"
              aria-live="polite"
            >
              {status}
            </p>
          </div>
        </section>
      </aside>
    </form>
  );
}
