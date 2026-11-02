import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
  CheckCircle2,
  Package,
  Eye,
  Code,
  Sparkles,
  Settings,
  Smartphone,
  Globe,
  Image,
  List,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { formatIdr } from "../../lib/format-idr";
import { MAX_ENCODED_BYTES, convertImageToWebP, uploadCardDerivative } from "../../lib/client-image";

type Variant = {
  id: number;
  sku?: string;
  title: string;
  price: number;
  compare_price?: number | null;
};

type Product = {
  id: number | string;
  title: string;
  slug: string;
  category?: string;
  image_url?: string | null;
  is_active?: boolean;
  variants?: Variant[];
};

type FormConfig = {
  mode?: "hybrid" | "middle" | "full";
  selected_variant_id?: string;
  section_title?: string;
  button_text?: string;
};

type ContentConfig = {
  text?: string;
  align?: "left" | "center" | "right";
  size?: "small" | "medium" | "large";
  items?: string[];
  src?: string;
  alt?: string;
};

type Section = {
  id: string;
  type: "html" | "form" | "headline" | "paragraph" | "numbered_list" | "bullet_list" | "image";
  content_html?: string;
  form_config?: FormConfig;
  content_config: ContentConfig;
};

type Props = {
  landingPageId?: string;
};

const SHORTCODES = [
  { code: "{{product_name}}", label: "Nama Produk" },
  { code: "{{product_price}}", label: "Harga Promo" },
  { code: "{{compare_price}}", label: "Harga Coret" },
  { code: "{{discount_percent}}", label: "Diskon %" },
  { code: "{{cs_whatsapp}}", label: "No. WA CS" },
];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function sanitizePreviewHtml(value: string) {
  if (typeof DOMParser === "undefined") return escapeHtml(value);

  const parsedDocument = new DOMParser().parseFromString(value, "text/html");
  parsedDocument
    .querySelectorAll(
      "script, style, template, iframe, object, embed, link, meta, base, form, input, button, select, textarea",
    )
    .forEach((element) => element.remove());

  const allowedTags: Record<string, true> = {
    a: true,
    abbr: true,
    b: true,
    blockquote: true,
    br: true,
    div: true,
    em: true,
    figcaption: true,
    figure: true,
    h1: true,
    h2: true,
    h3: true,
    h4: true,
    h5: true,
    h6: true,
    hr: true,
    i: true,
    img: true,
    li: true,
    ol: true,
    p: true,
    section: true,
    small: true,
    span: true,
    strong: true,
    sub: true,
    sup: true,
    table: true,
    tbody: true,
    td: true,
    th: true,
    thead: true,
    tr: true,
    u: true,
    ul: true,
  };
  const commonAttributes: Record<string, true> = {
    class: true,
    role: true,
    title: true,
  };
  const attributesByTag: Record<string, Record<string, true>> = {
    a: { href: true },
    img: {
      alt: true,
      decoding: true,
      height: true,
      loading: true,
      src: true,
      width: true,
    },
    td: { colspan: true, rowspan: true },
    th: { colspan: true, rowspan: true, scope: true },
  };

  for (const element of Array.from(parsedDocument.body.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    if (!allowedTags[tag]) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const allowed =
        commonAttributes[name] ||
        name.startsWith("aria-") ||
        attributesByTag[tag]?.[name];
      if (!allowed) element.removeAttribute(attribute.name);
    }

    if (tag === "a" || tag === "img") {
      const urlAttribute = tag === "a" ? "href" : "src";
      const rawUrl = element.getAttribute(urlAttribute);
      if (rawUrl) {
        try {
          const url = new URL(rawUrl, window.location.href);
          if (!["http:", "https:"].includes(url.protocol)) {
            element.removeAttribute(urlAttribute);
          }
        } catch {
          element.removeAttribute(urlAttribute);
        }
      }
    }

    if (tag === "a" && element.hasAttribute("href")) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  return parsedDocument.body.innerHTML;
}

// Both preview strips spelled out the reference store's domain, so an operator
// was shown a URL that belongs to someone else's shop. This island is mounted
// `client:only`, so it already runs on the store's own origin — no prop needs
// threading through two pages to say so.
const previewOrigin =
  typeof window === "undefined" ? "" : window.location.origin;

/**
 * Tailscale serves local dev over HTTP, where Web Crypto's randomUUID is not
 * exposed. These IDs exist only inside unsaved React state; D1 assigns durable
 * IDs on save, so a time/random fallback is sufficient here.
 */
function createSectionId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function LandingPageEditor({ landingPageId }: Props) {
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [productId, setProductId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [sections, setSections] = useState<Section[]>([]);

  // Section editing states inside 480px canvas
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [uploadingSectionId, setUploadingSectionId] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts();
    if (landingPageId) fetchLandingPage();
  }, [landingPageId]);

  async function fetchProducts() {
    try {
      // Same ceiling as the catalogue (see ProductCatalog): the newest 200.
      const res = await fetch("/api/admin/products?limit=200");
      if (!res.ok) throw new Error("Failed to fetch products");
      const { data } = await res.json();
      setProducts(data || []);
    } catch (err) {
      toast.error("Gagal memuat daftar produk");
    }
  }

  async function fetchLandingPage() {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/landing-pages/${landingPageId}`);
      if (!res.ok) throw new Error("Failed to fetch landing page");
      const { data } = await res.json();

      setTitle(data.title || "");
      setSlug(data.slug || "");
      setProductId(String(data.product_id || ""));
      setIsActive(data.is_active === 1 || data.is_active === true);
      setMetaTitle(data.meta_title || "");
      setMetaDescription(data.meta_description || "");

      if (Array.isArray(data.sections)) {
        setSections(
          data.sections.map((s: Section) => ({
            id: createSectionId(),
            type: s.type,
            content_html: s.content_html || "",
            form_config: s.form_config || {},
            content_config: s.content_config ?? {},
          }))
        );
      }
    } catch (err) {
      toast.error("Gagal memuat data landing page");
    } finally {
      setLoading(false);
    }
  }

  const generateSlug = (val: string) => {
    return val
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!landingPageId) {
      setSlug(generateSlug(val));
    }
  };

  const addHtmlSection = () => {
    const id = createSectionId();
    setSections((current) => [...current, { id, type: "html", content_html: "", content_config: {} }]);
    setEditingSectionId(id);
    toast.success("HTML section ditambahkan ke canvas.");
  };

  const addFormSection = () => {
    const id = createSectionId();
    setSections((current) => [...current, { id, type: "form", form_config: { mode: "hybrid" }, content_config: {} }]);
    setEditingSectionId(id);
    toast.success("Form COD ditambahkan ke canvas.");
  };

  const addSection = (type: Section["type"]) => {
    const id = createSectionId();
    const content_config: ContentConfig =
      type === "headline" ? { text: "", align: "left", size: "medium" } :
      type === "paragraph" ? { text: "", align: "left" } :
      type === "numbered_list" || type === "bullet_list" ? { items: [""] } :
      type === "image" ? { src: "", alt: "" } : {};
    setSections((current) => [...current, { id, type, content_config }]);
    setEditingSectionId(id);
    toast.success(`${type === "headline" ? "Headline" : type === "paragraph" ? "Paragraf" : type === "numbered_list" ? "Daftar angka" : type === "bullet_list" ? "Bullet" : "Gambar"} ditambahkan ke canvas.`);
  };

  async function uploadImage(sectionId: string, file: File) {
    if (file.size > MAX_ENCODED_BYTES) return toast.error("Ukuran file maksimal 2 MB.");
    setUploadingSectionId(sectionId);
    try {
      const image = await convertImageToWebP(file);
      const formData = new FormData();
      formData.set("file", image);
      const response = await fetch("/api/admin/upload-r2", { method: "POST", body: formData });
      const payload = await response.json();
      // The route answers `{ success, url, fileName }`. This read a nested `data.url`
      // from 2026-08-28: R2 stored the file, then the editor threw and never set
      // the section's image.
      if (!response.ok || !payload.success || !payload.url) throw new Error(payload.error || "Gagal mengunggah gambar.");
      setSections((current) =>
        current.map((section) =>
          section.id === sectionId
            ? { ...section, content_config: { ...section.content_config, src: String(payload.url) } }
            : section,
        ),
      );
      // The first image section is the page's card on /landing-page.
      if (!(await uploadCardDerivative(image, String(payload.fileName || "")))) {
        toast.warning("Gambar tersimpan, tetapi versi kartu gagal dibuat. Kartu memakai gambar penuh.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengolah gambar.");
    } finally {
      setUploadingSectionId(null);
    }
  }

  function focusSection(id: string) {
    setEditingSectionId(id);
    requestAnimationFrame(() => {
      document.getElementById(`landing-section-${id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  const moveSection = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index > 0) {
      const newSections = [...sections];
      const temp = newSections[index - 1];
      newSections[index - 1] = newSections[index];
      newSections[index] = temp;
      setSections(newSections);
    } else if (direction === "down" && index < sections.length - 1) {
      const newSections = [...sections];
      const temp = newSections[index + 1];
      newSections[index + 1] = newSections[index];
      newSections[index] = temp;
      setSections(newSections);
    }
  };

  const removeSection = (index: number) => {
    const newSections = [...sections];
    newSections.splice(index, 1);
    setSections(newSections);
  };

  const updateSection = (id: string, partial: Partial<Section>) => {
    setSections(sections.map((s) => (s.id === id ? { ...s, ...partial } : s)));
  };

  async function handleSave() {
    if (!title.trim() || !slug.trim() || !productId) {
      return toast.error("Mohon lengkapi Judul, Slug, dan Produk Terkait di panel kiri.");
    }

    try {
      setLoading(true);
      const payload = {
        title: title.trim(),
        slug: slug.trim(),
        product_id: productId,
        is_active: isActive ? 1 : 0,
        meta_title: metaTitle.trim(),
        meta_description: metaDescription.trim(),
        sections: sections.map(({ type, content_html, form_config, content_config }) => ({
          type,
          content_html,
          form_config,
          // A list is authored as free text, one item per line, so the
          // operator's closing Enter leaves a trailing empty item and the
          // server refuses the whole save. Filtering while they type would
          // make Enter impossible to press, so it is done once, here.
          content_config: content_config.items
            ? {
                ...content_config,
                items: content_config.items.map((item) => item.trim()).filter(Boolean),
              }
            : content_config,
        })),
      };

      const url = landingPageId
        ? `/api/admin/landing-pages/${landingPageId}`
        : `/api/admin/landing-pages`;
      const method = landingPageId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const { data, error } = await res.json();
      if (!res.ok) throw new Error(error || "Gagal menyimpan landing page");

      toast.success("Landing page berhasil disimpan!");
      if (!landingPageId && data?.id) {
        window.location.assign(`/admin/landing-pages/${data.id}/edit`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan saat menyimpan";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const selectedProduct = products.find((p) => String(p.id) === productId);

  return (
    <div className="space-y-6 pb-24 text-slate-900">
      {/* Fixed Top Action Header */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-semibold text-sm shrink-0 shadow-xs">
            480
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900 flex items-center gap-2">
              {title || (landingPageId ? "Edit Landing Page" : "Buat Landing Page Baru")}
              {isActive ? (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs px-2 py-0.5">
                  Published
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs px-2 py-0.5">Draft</Badge>
              )}
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              {slug ? `${previewOrigin}/${slug}` : "Lengkapi konfigurasi judul & produk di panel kiri"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {slug && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(`/${slug}?preview=1`, "_blank")}
            >
              <Eye aria-hidden="true" /> Preview
            </Button>
          )}

          <Button
            onClick={handleSave}
            disabled={loading}
          >
            <CheckCircle2 aria-hidden="true" />
            {loading ? "Menyimpan…" : "Simpan landing page"}
          </Button>
        </div>
      </div>

      {/* Unified 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Metadata & Product Settings */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="bg-slate-50/50 pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-600" />
                Metadata & Produk Catalog
              </CardTitle>
              <CardDescription className="text-xs">
                Hubungkan landing page ini dengan produk katalog D1 dan set URL slug.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {/* Judul Halaman */}
              <div className="space-y-1.5">
                <label htmlFor="landing-title" className="text-xs font-semibold text-slate-700">
                  Judul Landing Page <span className="text-red-500">*</span>
                </label>
                <Input
                  id="landing-title"
                  placeholder="Contoh: Promo Spesial Asahan Portable"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  
                />
              </div>

              {/* URL Slug */}
              <div className="space-y-1.5">
                <label htmlFor="landing-slug" className="text-xs font-semibold text-slate-700">
                  URL Slug <span className="text-red-500">*</span>
                </label>
                <div className="flex rounded-md shadow-xs">
                  <span className="inline-flex items-center px-2.5 rounded-l-md border border-r-0 border-slate-300 bg-slate-50 text-slate-500 text-xs font-mono">
                    /
                  </span>
                  <Input
                    id="landing-slug"
                    className="rounded-l-none font-mono"
                    placeholder="promo-asahan-portable"
                    value={slug}
                    onChange={(e) => setSlug(generateSlug(e.target.value))}
                  />
                </div>
              </div>

              {/* Product Select Dropdown (Shadcn Select - Unclipped Portal) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-blue-600" />
                  Produk Katalog (D1) <span className="text-red-500">*</span>
                </label>
                <Select
                  items={Object.fromEntries(products.map((product) => [String(product.id), product.title]))}
                  value={productId}
                  onValueChange={(value) => {
                    if (value) setProductId(value);
                  }}
                >
                  <SelectTrigger className="w-full" aria-invalid={!productId || undefined}>
                    <SelectValue placeholder="Pilih produk" />
                  </SelectTrigger>
                  {/* Five rows, then scroll: the catalogue can hold hundreds. */}
                  <SelectContent alignItemWithTrigger={false} className="max-h-[17.5rem] w-(--anchor-width) min-w-80">
                    {products.map((p) => {
                      const prices = p.variants?.map((v) => v.price) || [];
                      const minPrice = prices.length ? Math.min(...prices) : 0;
                      const maxPrice = prices.length ? Math.max(...prices) : 0;
                      const priceLabel =
                        minPrice === 0
                          ? `ID: #${p.id}`
                          : minPrice === maxPrice
                          ? formatIdr(minPrice)
                          : `${formatIdr(minPrice)} - ${formatIdr(maxPrice)}`;

                      return (
                        <SelectItem
                          key={p.id}
                          value={String(p.id)}
                          className="py-2"
                        >
                          <div className="flex w-full min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                              {p.image_url ? (
                                <img
                                  src={p.image_url}
                                  alt=""
                                  className="size-9 shrink-0 rounded-md border object-cover"
                                />
                              ) : (
                                <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-slate-100">
                                  <Package className="w-4 h-4 text-slate-400" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1 text-left">
                                <div className="truncate font-medium text-slate-900" title={p.title}>
                                  {p.title}
                                </div>
                                {/* The price rides the second line so a range never squeezes the title. */}
                                <div className="truncate text-xs text-slate-500">
                                  <span className="font-medium text-slate-700 tabular-nums">{priceLabel}</span>
                                  {p.category && <span className="capitalize"> · {p.category}</span>}
                                  <span> · {p.variants?.length || 0} varian</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {selectedProduct && (
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    {selectedProduct.image_url ? (
                      <img
                        src={selectedProduct.image_url}
                        alt={selectedProduct.title}
                        className="size-9 shrink-0 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-slate-100">
                        <Package className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-900" title={selectedProduct.title}>
                        {selectedProduct.title}
                      </div>
                      <div className="truncate text-slate-500">
                        <span className="font-mono">/{selectedProduct.slug}</span> · {selectedProduct.variants?.length || 0} varian aktif
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Status Switch */}
              <div className="pt-2 border-t flex items-center justify-between">
                <div>
                  <span id="landing-publish-label" className="text-xs font-semibold text-slate-700 block">Status Terbit</span>
                  <span id="landing-publish-hint" className="text-xs text-slate-500">Aktifkan untuk akses publik</span>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  aria-labelledby="landing-publish-label"
                  aria-describedby="landing-publish-hint"
                />
              </div>
            </CardContent>
          </Card>

          {/* SEO Metadata Card */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="bg-slate-50/50 pb-3 border-b border-slate-100">
              <CardTitle className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-slate-500" /> SEO & Social Share (Opsional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              <div className="space-y-1">
                <label htmlFor="landing-meta-title" className="text-xs font-medium text-slate-600">Meta Title</label>
                <Input
                  id="landing-meta-title"
                  placeholder="Judul SEO Google..."
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="landing-meta-description" className="text-xs font-medium text-slate-600">Meta Description</label>
                <Textarea
                  id="landing-meta-description"
                  placeholder="Deskripsi singkat untuk pencarian Google & WhatsApp preview..."
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  className="min-h-[60px]"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: 480px Mobile Canvas Viewport Editor */}
        <div className="lg:col-span-8">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <Smartphone className="w-4 h-4 text-blue-600" />
                Mobile preview (<strong>480px</strong>)
              </span>
              <span className="text-xs text-slate-500">{sections.length} section{sections.length === 1 ? "" : "s"}</span>
            </div>

            {sections.length > 0 && (
              <nav aria-label="Navigasi section" className="flex max-w-[480px] mx-auto gap-1 overflow-x-auto pb-1">
                {sections.map((section, index) => (
                  <Button key={section.id} type="button" variant={editingSectionId === section.id ? "secondary" : "outline"} size="sm" onClick={() => focusSection(section.id)} className="shrink-0 px-2">
                    {index + 1}
                  </Button>
                ))}
              </nav>
            )}
            {/* Stable Centered Mobile Device Mockup Frame */}
            <div className="w-full max-w-[480px] mx-auto bg-white border border-slate-300 rounded-xl shadow-sm overflow-hidden min-h-[680px] flex flex-col">
              {/* Device Header Bar */}
              <div className="bg-slate-900 px-4 py-2 text-white flex items-center justify-between text-xs font-mono">
                <span className="truncate max-w-[300px] text-slate-300">
                  {previewOrigin}/{slug || "preview"}
                </span>
                <Badge variant="outline" className="text-xs px-1.5 py-0 bg-slate-800 text-slate-200 border-slate-700">
                  480px Storefront
                </Badge>
              </div>

              {/* Sections Canvas Body */}
              <div className="p-3 space-y-3 flex-1 bg-slate-50/60">
                {sections.map((section, index) => {
                  const isEditing = editingSectionId === section.id;

                  return (
                    <div
                      id={`landing-section-${section.id}`}
                      key={section.id}
                      onClick={() => setEditingSectionId(section.id)}
                      className={`rounded-xl border bg-white shadow-sm transition-all overflow-hidden cursor-pointer ${
                        isEditing ? "border-blue-400 ring-4 ring-blue-50" : "border-slate-200 hover:border-slate-400"
                      }`}
                    >
                      {/* Section Header */}
                      <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                          <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-xs flex items-center justify-center font-semibold">
                            {index + 1}
                          </span>
                          {section.type === "html" ? (
                            <span className="flex items-center gap-1 text-blue-700"><Code className="w-3.5 h-3.5" /> HTML Content</span>
                          ) : section.type === "form" ? (
                            <span className="flex items-center gap-1 text-emerald-700"><Sparkles className="w-3.5 h-3.5" /> Native Form COD</span>
                          ) : (
                            <span className="flex items-center gap-1 text-slate-700">
                              {section.type === "image" ? <Image className="w-3.5 h-3.5" /> : section.type.includes("list") ? <List className="w-3.5 h-3.5" /> : <Type className="w-3.5 h-3.5" />}
                              {section.type === "headline" ? "Headline" : section.type === "paragraph" ? "Paragraf" : section.type === "numbered_list" ? "Daftar angka" : section.type === "bullet_list" ? "Bullet" : "Gambar"}
                            </span>
                          )}
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => moveSection(index, "up")}
                            disabled={index === 0}
                            className="p-1.5 hover:bg-slate-200/50 rounded-md disabled:opacity-30 text-slate-500 hover:text-slate-900 transition-colors"
                            title="Geser Ke Atas"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSection(index, "down")}
                            disabled={index === sections.length - 1}
                            className="p-1.5 hover:bg-slate-200/50 rounded-md disabled:opacity-30 text-slate-500 hover:text-slate-900 transition-colors"
                            title="Geser Ke Bawah"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSectionId(isEditing ? null : section.id)}
                            className={`p-1.5 rounded-md transition-colors ${
                              isEditing ? "bg-blue-100 text-blue-700" : "hover:bg-slate-200/50 text-slate-500 hover:text-slate-900"
                            }`}
                            title="Edit Section"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSection(index)}
                            className="p-1.5 hover:bg-red-50 rounded-md text-slate-500 hover:text-red-600 transition-colors"
                            title="Hapus Section"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Section Content */}
                      <div className="p-3">
                        {section.type === "html" && (
                          <div className="space-y-2">
                            {isEditing && (
                              <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-100">
                                {SHORTCODES.map((item) => (
                                  <button
                                    key={item.code}
                                    type="button"
                                    onClick={() => {
                                      const el = document.getElementById(`html-${section.id}`) as HTMLTextAreaElement;
                                      if (el) {
                                        const start = el.selectionStart;
                                        const end = el.selectionEnd;
                                        const currentVal = section.content_html || "";
                                        const newContent = currentVal.substring(0, start) + item.code + currentVal.substring(end);
                                        updateSection(section.id, { content_html: newContent });
                                      } else {
                                        updateSection(section.id, { content_html: (section.content_html || "") + item.code });
                                      }
                                    }}
                                    className="text-xs px-2 py-1 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 rounded-md font-mono border border-slate-200 shadow-sm transition-colors cursor-pointer"
                                  >
                                    {item.code}
                                  </button>
                                ))}
                              </div>
                            )}

                            {isEditing ? (
                              <Textarea
                                data-code-editor
                                id={`html-${section.id}`}
                                placeholder="<div class='py-4 text-center'><h2>{{product_name}}</h2></div>"
                                className="font-mono text-[13px] min-h-[160px] bg-slate-900 text-slate-100 p-3 rounded-md border-slate-800 focus:ring-blue-500/20"
                                value={section.content_html || ""}
                                onChange={(e) => updateSection(section.id, { content_html: e.target.value })}
                              />
                            ) : (
                              <div
                                className="text-xs text-slate-800 p-2 rounded bg-slate-50/80 border border-slate-100 min-h-[48px] overflow-hidden"
                                dangerouslySetInnerHTML={{
                                  __html: sanitizePreviewHtml(
                                    (section.content_html || "<span class='text-slate-400 italic'>HTML Section Kosong</span>")
                                      .replace(/\{\{product_name\}\}/g, selectedProduct?.title || "Nama Produk")
                                      .replace(/\{\{product_price\}\}/g, "Rp149.000"),
                                  ),
                                }}
                              />
                            )}
                          </div>
                        )}
                        {section.type !== "html" && section.type !== "form" && (
                          <div className="space-y-3 text-xs">
                            {isEditing ? (
                              <>
                                {(section.type === "headline" || section.type === "paragraph") && (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <label className="text-xs font-semibold text-slate-600">Perataan</label>
                                        <Select value={section.content_config.align ?? "left"} onValueChange={(align) => align && updateSection(section.id, { content_config: { ...section.content_config, align } })}>
                                          <SelectTrigger aria-label="Perataan teks" ><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="left">Rata kiri</SelectItem>
                                            <SelectItem value="center">Tengah</SelectItem>
                                            <SelectItem value="right">Rata kanan</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      {section.type === "headline" ? (
                                        <div className="space-y-1">
                                          <label className="text-xs font-semibold text-slate-600">Ukuran</label>
                                          <Select value={section.content_config.size ?? "medium"} onValueChange={(size) => size && updateSection(section.id, { content_config: { ...section.content_config, size } })}>
                                            <SelectTrigger aria-label="Ukuran headline" ><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="small">Kecil</SelectItem>
                                              <SelectItem value="medium">Sedang</SelectItem>
                                              <SelectItem value="large">Besar</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      ) : <p className="flex items-end text-slate-500">Body text</p>}
                                    </div>
                                    <Textarea
                                      aria-label={section.type === "headline" ? "Headline" : "Paragraf"}
                                      value={section.content_config.text ?? ""}
                                      onChange={(event) => updateSection(section.id, { content_config: { ...section.content_config, text: event.target.value } })}
                                      placeholder={section.type === "headline" ? "Headline utama..." : "Tulis paragraf..."}
                                      className="min-h-20"
                                    />
                                  </div>
                                )}
                                {(section.type === "numbered_list" || section.type === "bullet_list") && (
                                  <Textarea
                                    aria-label="Item daftar, satu baris per item"
                                    value={(section.content_config.items ?? []).join("\n")}
                                    onChange={(event) => updateSection(section.id, { content_config: { items: event.target.value.split("\n") } })}
                                    placeholder="Satu manfaat per baris"
                                    className="min-h-24"
                                  />
                                )}
                                {section.type === "image" && (
                                  <div className="space-y-2">
                                    <Input aria-label="Upload gambar" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingSectionId === section.id} onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      if (file) void uploadImage(section.id, file);
                                      event.target.value = "";
                                    }} />
                                    {uploadingSectionId === section.id && <p className="text-slate-500" role="status">Mengolah dan mengunggah gambar…</p>}
                                    {section.content_config.src && <img src={section.content_config.src} alt="" className="max-w-full h-auto rounded-lg border" />}
                                    <Input aria-label="Deskripsi gambar" disabled={uploadingSectionId === section.id} value={section.content_config.alt ?? ""} onChange={(event) => updateSection(section.id, { content_config: { ...section.content_config, alt: event.target.value } })} placeholder="Deskripsi gambar" />
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                {section.type === "headline" && <h2 className="text-xl font-semibold">{section.content_config.text || "Headline belum diisi"}</h2>}
                                {section.type === "paragraph" && <p className="leading-relaxed">{section.content_config.text || "Paragraf belum diisi"}</p>}
                                {(section.type === "numbered_list" || section.type === "bullet_list") && (
                                  section.type === "numbered_list"
                                    ? <ol className="list-decimal pl-5 space-y-1">{(section.content_config.items ?? []).map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>
                                    : <ul className="list-disc pl-5 space-y-1">{(section.content_config.items ?? []).map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                                )}
                                {section.type === "image" && section.content_config.src && <img src={section.content_config.src} alt={section.content_config.alt ?? ""} className="max-w-full h-auto rounded-lg" />}
                              </>
                            )}
                          </div>
                        )}


                        {section.type === "form" && (
                          <div className="space-y-3">
                            {isEditing ? (
                              <div className="space-y-2 text-xs">
                                <div>
                                  <label className="text-xs font-semibold text-slate-600">Layout Mode</label>
                                  <Select
                                    value={section.form_config?.mode || "hybrid"}
                                    onValueChange={(value) => {
                                      if (!value) return;
                                      updateSection(section.id, {
                                        form_config: { ...section.form_config, mode: value },
                                      });
                                    }}
                                  >
                                    <SelectTrigger >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="hybrid">Hybrid (Accordion Varian Auto-detect)</SelectItem>
                                      <SelectItem value="middle">Middle (Form Ringkas Instant)</SelectItem>
                                      <SelectItem value="full">Full (Form Detail Lengkap)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div>
                                  <label className="text-xs font-semibold text-slate-600">Varian Default</label>
                                  <Select
                                    value={section.form_config?.selected_variant_id || "none"}
                                    onValueChange={(value) =>
                                      updateSection(section.id, {
                                        form_config: {
                                          ...section.form_config,
                                          selected_variant_id:
                                            !value || value === "none" ? undefined : value,
                                        },
                                      })
                                    }
                                  >
                                    <SelectTrigger >
                                      <SelectValue placeholder="Semua varian" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-64 p-1 shadow-lg rounded-xl border border-slate-200">
                                      <SelectItem value="none" className="text-xs py-2 px-3 font-medium text-slate-700">
                                        Semua Varian Tersedia
                                      </SelectItem>
                                      {selectedProduct?.variants?.map((v) => (
                                        <SelectItem
                                          key={v.id}
                                          value={String(v.id)}
                                          className="text-xs py-2 px-3 border-b border-slate-100/80 last:border-b-0 cursor-pointer focus:bg-slate-100/90 rounded-lg transition-colors my-0.5"
                                        >
                                          <div className="flex items-start justify-between w-full gap-3 min-w-0">
                                            <span className="font-medium text-slate-900 line-clamp-2 whitespace-normal break-words leading-snug">{v.title}</span>
                                            <span className="shrink-0 font-mono font-semibold text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md self-start">
                                              {formatIdr(v.price)}
                                            </span>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            ) : (
                              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                                  <div>
                                    <span className="font-semibold">Native Form Checkout COD</span>
                                    <div className="text-xs text-emerald-700">
                                      Mode: {section.form_config?.mode || "hybrid"} • Anchor: #checkout-form
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {sections.length === 0 && (
                  <div className="text-center py-20 border border-dashed rounded-xl bg-white space-y-2">
                    <Package className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs text-slate-500 font-medium">Canvas Halaman Masih Kosong</p>
                    <p className="text-xs text-slate-400">Klik tombol di bawah untuk menambah section</p>
                  </div>
                )}
              </div>

              {/* Add Section Buttons */}
              <div className="p-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-center gap-2">
                <p className="w-full text-center text-xs font-medium text-slate-600">Tambah section ke canvas</p>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => addSection("headline")} ><Type className="w-3.5 h-3.5 mr-1" />Headline</Button>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => addSection("paragraph")} ><Type className="w-3.5 h-3.5 mr-1" />Paragraf</Button>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => addSection("numbered_list")} ><List className="w-3.5 h-3.5 mr-1" />Daftar angka</Button>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => addSection("bullet_list")} ><List className="w-3.5 h-3.5 mr-1" />Bullet</Button>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => addSection("image")} ><Image className="w-3.5 h-3.5 mr-1" />Gambar</Button>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={addHtmlSection} ><Code className="w-3.5 h-3.5 mr-1" />HTML</Button>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={addFormSection} ><Plus className="w-3.5 h-3.5 mr-1" />Form COD</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
