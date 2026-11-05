import { buildMetaAdvancedMatching } from "../lib/meta-identity.ts";
import { META_EXTERNAL_ID_COOKIE } from "../lib/click-ids.ts";
import { formatIdr } from "../lib/format-idr";
import { normalizePhone } from "../lib/validation";
import { buyerPaymentAdminFee, calculateCodFeeBreakdown } from "../lib/payment-fee-policy";
import { paymentBrandAsset } from "../lib/payment-brand";

import { formatDeliveryLocation, groupLocationResults } from "../lib/location-search";
import { pushGtmEcomEvent } from "../lib/gtm";
import { isValidWa62, missingCheckoutContact } from "../lib/validation";
import { normalizeProvinceCode } from "../lib/province";
import { navigateAfterCheckout } from "../lib/checkout-navigation";
import {
  AbandonedLeadCaptureGate,
  createAbandonedLeadFingerprint,
  readAbandonedLeadFingerprints,
  writeAbandonedLeadFingerprint,
} from "../lib/abandoned-lead-session";

type HybridConfig = {
  instanceId: string;
  productSlug: string;
  productId: string;
  productName: string;
  province?: string;
  codDisabledProvinceCodes: string[];
};

type PaymentOption = {
  code: string;
  paymentMethod: "cod" | "bank_transfer" | "qris" | "manual_transfer";
  channelCode?: string;
  sellerBankAccountId?: number;
  bankCode?: string;
  logoUrl?: string;
  label: string;
  desc: string;
  adminFee: number;
  adminFeeRate: number;
  adminFeeVatRate: number;
  feeBearer: "buyer" | "seller";
};

type ShippingOption = {
  courier_service_id: string;
  name: string;
  shipment_provider_code: string;
  warehouse_unique_id: string;
  shipping_cost: number;
};

type SubmitOrderResponse = {
  success?: boolean;
  error?: unknown;
  message?: unknown;
  order?: {
    id?: unknown;
    order_id?: unknown;
    order_number?: unknown;
    unique_id?: unknown;
    status_token?: unknown;
    payment_method?: unknown;
    payment_status?: unknown;
    payment_url?: unknown;
    status?: unknown;
    total_payment?: unknown;
    cod_service_fee?: unknown;
    cod_service_fee_vat?: unknown;
    cod_fee_bearer?: unknown;
  };
  payment?: {
    channel_code?: unknown;
    fee_bearer?: unknown;
    status?: unknown;
    amount?: unknown;
    admin_fee?: unknown;
    total_amount?: unknown;
    virtual_account?: unknown;
    qr_payload?: unknown;
    payment_code?: unknown;
    account_holder?: unknown;
    bank_name?: unknown;
    manual_transfer?: unknown;
    payment_url?: unknown;
    expires_at?: unknown;
    error?: unknown;
  } | null;
};
type DistrictOption = {
  id: string;
  label: string;
  district: string;
  subdistrict: string;
  city: string;
  province: string;
  postal_code: string;
  location_id?: string;
};

type CheckoutState = {
  paymentMethod: "cod" | "bank_transfer" | "qris" | "manual_transfer";
  paymentChannel: string;
  sellerBankAccountId: number | null;
  location: DistrictOption | null;
  shipping: ShippingOption | null;
  paymentOptions: PaymentOption[];
  visiblePaymentOptions: PaymentOption[];
  districtLoading: boolean;
  shippingLoading: boolean;
  submitting: boolean;
  selectedProvince: string;
  selectedCity: string;
  selectedPostalCode: string;
  geoProvince: string;
  locationId: string;
  courierServiceId: string;
  shipmentProviderCode: string;
  warehouseUniqueId: string;
  submitToken?: string;
};

const FALLBACK_PAYMENT_OPTIONS: PaymentOption[] = [
  {
    code: "cod",
    adminFee: 0,
    adminFeeRate: 0,
    adminFeeVatRate: 0.11,
    feeBearer: "buyer",
    paymentMethod: "cod",
    label: "COD (Bayar di Tempat)",
    desc: "Bayar tunai saat barang tiba",
  },
];
const parsePaymentOptions = (payload: unknown): PaymentOption[] => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  ) {
    return [];
  }
  return payload.data.flatMap((row): PaymentOption[] => {
    if (typeof row !== "object" || row === null || row.is_active === false) {
      return [];
    }
    const rawMethod = String(row.payment_method || "").toLowerCase();
    const paymentMethod =
      rawMethod === "cod"
        ? "cod"
        : rawMethod === "bank_transfer"
          ? "bank_transfer"
          : rawMethod === "qris"
            ? "qris"
            : rawMethod === "manual_transfer"
              ? "manual_transfer"
              : undefined;
    const code = String(row.code || "").trim();
    if (!paymentMethod || !code) return [];
    return [
      {
        code,
        paymentMethod,
        channelCode: row.channel_code
          ? String(row.channel_code).trim().toUpperCase()
          : undefined,
        sellerBankAccountId: row.seller_bank_account_id
          ? Number(row.seller_bank_account_id)
          : undefined,
        bankCode: row.bank_code
          ? String(row.bank_code).trim().toUpperCase()
          : undefined,
        logoUrl: row.logo_url ? String(row.logo_url).trim() : undefined,
        label: String(row.name || code),
        // A manual transfer's description names the account holder; showing
        // only the fee text hid who the buyer is paying.
        desc:
          paymentMethod === "manual_transfer"
            ? [row.fee_description, row.description].filter(Boolean).join(" · ")
            : String(row.fee_description || row.description || ""),
        adminFee: Number(row.admin_fee || 0),
        adminFeeRate: Number(row.admin_fee_rate || 0),
        adminFeeVatRate: Number(row.admin_fee_vat_rate || 0),
        feeBearer: row.fee_bearer === "seller" ? "seller" : "buyer",
      },
    ];
  });
};

const fmt = formatIdr;
const createId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const postMetaEvent = (payload: Record<string, unknown>) =>
  fetch("/api/meta-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);

function readStablePromoStock(productSlug: string) {
  const fallback = 11;
  try {
    const stockKey = `promo_stock_${productSlug}`;
    const existing = Number(sessionStorage.getItem(stockKey) || "");
    if (Number.isFinite(existing) && existing >= 5 && existing <= 18)
      return existing;
    const generated = Math.floor(Math.random() * 14) + 5;
    sessionStorage.setItem(stockKey, String(generated));
    return generated;
  } catch {
    return fallback;
  }
}

function applyPromoStock(root: Document | HTMLElement, productSlug: string) {
  const stockLeft = readStablePromoStock(productSlug);
  const stockEl = root.querySelector<HTMLElement>("[data-stock-left]");
  const progressEl = root.querySelector<HTMLElement>("[data-stock-progress]");
  if (stockEl) stockEl.textContent = String(stockLeft);
  if (progressEl) {
    const progressWidth = `${Math.max(10, Math.min(95, Math.round((stockLeft / 18) * 100)))}%`;
    progressEl.style.width = progressWidth;
  }
}

function parseConfig(root?: Document | HTMLElement): HybridConfig | null {
  const scope = root || document;
  let node = scope.querySelector("[data-hybrid-form-config]");

  if (!node && root instanceof HTMLElement) {
    const instanceId = root.dataset.instanceId || "";
    node = instanceId ? document.getElementById(`${instanceId}-config`) : null;
  }

  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as HybridConfig;
  } catch {
    return null;
  }
}

const initializedHybridRoots = new WeakSet<HTMLElement>();

export function initPromoSessionStock(root?: Document | HTMLElement) {
  const scope = root || document;
  const forms = scope.querySelectorAll<HTMLElement>("[data-hybrid-form-root]");
  forms.forEach((formRoot) => {
    const config = parseConfig(formRoot);
    if (!config) return;
    applyPromoStock(formRoot, config.productSlug);
  });
}

function initHybridOrderFormInstance(formRoot: HTMLElement) {
  if (initializedHybridRoots.has(formRoot)) return;
  const config = parseConfig(formRoot);
  const form = formRoot.querySelector("form") as HTMLFormElement | null;
  if (!config || !form) return;
  initializedHybridRoots.add(formRoot);

  const COD_DISABLED_PROVINCE_CODES = Array.isArray(
    config.codDisabledProvinceCodes,
  )
    ? config.codDisabledProvinceCodes
        .map((item) => normalizeProvinceCode(item))
        .filter(Boolean)
    : [];
  const districtSearchCache = new Map<
    string,
    { items: DistrictOption[]; source: string }
  >();
  const shippingOptionsCache = new Map<
    string,
    { items: ShippingOption[]; postalCode: string; source: string }
  >();

  const phoneInput = formRoot.querySelector(
    '[data-field="hybrid-phone"]',
  ) as HTMLInputElement | null;
  const districtInput = formRoot.querySelector(
    '[data-field="district-search"]',
  ) as HTMLInputElement | null;
  const districtList = formRoot.querySelector(
    "#district-list",
  ) as HTMLDivElement | null;
  const districtPicked = formRoot.querySelector(
    "#district-picked",
  ) as HTMLDivElement | null;
  const districtPickedSubtitle = formRoot.querySelector(
    "#district-picked-subtitle",
  );
  const shippingAddressLine = formRoot.querySelector("#shipping-address-line");
  const districtEditButton = formRoot.querySelector(
    "#district-edit-button",
  ) as HTMLButtonElement | null;
  const districtHelp = formRoot.querySelector<HTMLElement>("#district-help");
  const locationIdInput = formRoot.querySelector(
    "#location-id",
  ) as HTMLInputElement | null;
  const postalCodeInput = formRoot.querySelector(
    "#postal-code",
  ) as HTMLInputElement | null;
  const provinceInput = formRoot.querySelector(
    "#province-name",
  ) as HTMLInputElement | null;
  const cityInput = formRoot.querySelector(
    "#city-name",
  ) as HTMLInputElement | null;
  const paymentMethodBlock = formRoot.querySelector(
    "#payment-method-block",
  ) as HTMLElement | null;
  const paymentOptionsEl = formRoot.querySelector(
    "#payment-options",
  ) as HTMLDivElement | null;
  const courierServiceIdInput = formRoot.querySelector(
    "#courier-service-id",
  ) as HTMLInputElement | null;
  const shipmentProviderCodeInput = formRoot.querySelector(
    "#shipment-provider-code",
  ) as HTMLInputElement | null;
  const warehouseUniqueIdInput = formRoot.querySelector(
    "#warehouse-unique-id",
  ) as HTMLInputElement | null;
  const errorEl = formRoot.querySelector(
    "#hybrid-error",
  ) as HTMLParagraphElement | null;
  const submitButton = formRoot.querySelector(
    "#submit-button",
  ) as HTMLButtonElement | null;
  const submitButtonLabel = submitButton?.querySelector(".submit-main-label");
  const customerNameInput = formRoot.querySelector(
    '[data-field="customer-name"]',
  ) as HTMLInputElement | null;
  const addressInput = formRoot.querySelector<HTMLTextAreaElement>(
    'textarea[name="address"]',
  );
  const summaryLabel = formRoot.querySelector("#summary-label");
  const summaryCompare = formRoot.querySelector("#summary-compare");
  const summaryPriceValue = formRoot.querySelector("#summary-price-value");
  const summaryCompareRow = formRoot.querySelector<HTMLElement>("#summary-compare-row");
  const summaryShipping = formRoot.querySelector("#summary-shipping");
  const summaryAdminFeeRow = formRoot.querySelector<HTMLElement>("#summary-admin-fee-row");
  const summaryAdminFeeLabel = formRoot.querySelector("#summary-admin-fee-label");
  const summaryAdminFee = formRoot.querySelector("#summary-admin-fee");
  const summaryTotalNote = formRoot.querySelector("#summary-total-note");
  const summaryTotal = formRoot.querySelector("#summary-total");
  const districtSearchContainer = formRoot.querySelector(
    "#district-search-container",
  ) as HTMLDivElement | null;
  const trackedFlags = new Set<string>();

  const getSelectedVariantMeta = () => {
    const checked = form.querySelector<HTMLInputElement>(
      'input[name="variant"]:checked',
    );
    const variantUniqueId = String(checked?.value || "");
    // Ads identity is product-level: Product ID, Meta content_id, Google item_id
    // and feed <g:id> are byte-identical. The selected variant remains a separate
    // commerce field and never changes catalog identity.
    const productId = String(config.productId || "");
    return {
      productId,
      variantUniqueId,
      contentId: productId,
      contentName: String(checked?.dataset.label || config.productName),
      value: Number(checked?.dataset.price || 1),
    };
  };

  const getCookieValue = (name: string) =>
    document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${name}=`))
      ?.split("=")[1] || "";

  const ensureMetaAdvancedMatching = async (
    extraUserData?: Record<string, unknown>,
  ) => {
    const pixelId = (window as any).__META_PIXEL_ID__;
    if (!(window as any).fbq || !pixelId) return;
    const advancedMatching = await buildMetaAdvancedMatching({
      ...extraUserData,
      external_id:
        getCookieValue(META_EXTERNAL_ID_COOKIE) || extraUserData?.external_id,
    });
    const signature = JSON.stringify(advancedMatching);
    if ((window as any).__META_AM_SIGNATURE__ === signature) return;
    (window as any).__META_AM_SIGNATURE__ = signature;
    // Routed into the one init `MetaPixelBase` owns, never a second `fbq('init')`.
    // fbevents honours advanced matching once per pixel id and discards later
    // calls silently, so this used to hash a full matching object and throw it
    // away. On a form page the pixel has already initialised by the time the
    // buyer types anything, so this returns false and the browser leg keeps the
    // `external_id` it was initialised with — the phone and name still reach
    // Meta on the CAPI leg, which reads them server-side and is not subject to
    // this constraint. Deleting the call instead would lose the one case that
    // does land: a buyer who fills the form before the pixel has initialised.
    (window as any).__PS_META_INIT__?.(advancedMatching);
  };

  const trackMeta = async (
    eventName: "AddToCart" | "InitiateCheckout",
    extraUserData?: Record<string, unknown>,
  ) => {
    if (trackedFlags.has(eventName)) return;
    trackedFlags.add(eventName);
    const eventId = createId(
      `${eventName.toLowerCase()}_${config.productSlug}`,
    );
    const meta = getSelectedVariantMeta();
    const metaTrack = (window as any).__PS_META_TRACK__;
    if (typeof metaTrack === "function") {
      await ensureMetaAdvancedMatching(extraUserData);
      // Ordered behind MetaPixelBase's single init (meta-pixel-ordering.test.ts).
      metaTrack(
        eventName,
        {
          content_name: meta.contentName,
          content_ids: meta.contentId ? [meta.contentId] : undefined,
          content_type: "product",
          value: meta.value,
          currency: "IDR",
        },
        { eventID: eventId },
      );
    }
    postMetaEvent({
      event_name: eventName,
      event_id: eventId,
      lp_name: config.productSlug,
      product_id: meta.productId || undefined,
      content_name: meta.contentName,
      value: meta.value,
      currency: "IDR",
      content_type: "product",
      event_source_url: window.location.href,
      user_data: {
        ...extraUserData,
        external_id:
          getCookieValue(META_EXTERNAL_ID_COOKIE) || extraUserData?.external_id,
        fbp: getCookieValue("_fbp"),
        fbc: getCookieValue("_fbc"),
      },
    });
    pushGtmEcomEvent(
      eventName === "AddToCart" ? "add_to_cart" : "begin_checkout",
      {
        currency: "IDR",
        value: meta.value,
        item_id: meta.productId,
        item_name: meta.contentName,
        item_variant: meta.variantUniqueId || undefined,
        event_id: eventId,
      },
    );
    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
      try {
        const parentOrigin = document.referrer ? new URL(document.referrer).origin : "*";
        window.parent.postMessage(
          {
            type: eventName === "AddToCart" ? "adsbook:add-to-cart" : "adsbook:initiate-checkout",
            content_name: meta.contentName,
            content_ids: meta.contentId ? [meta.contentId] : undefined,
            content_type: "product",
            value: meta.value,
            currency: "IDR",
            eventId,
          },
          parentOrigin,
        );
      } catch {}
    }
  };

  const hasQualifiedIdentity = () => {
    const customerName = customerNameInput?.value.trim() || "";
    const customerPhone = normalizePhone(phoneInput?.value || "");
    return customerName.length >= 3 && isValidWa62(customerPhone);
  };

  const maybeTrackAddToCart = (force = false) => {
    if (!force && !hasQualifiedIdentity()) return;
    const customerName = customerNameInput?.value.trim() || "";
    const customerPhone = normalizePhone(phoneInput?.value || "");
    void trackMeta("AddToCart", {
      ...(customerName ? { customer_name: customerName } : {}),
      ...(customerPhone ? { customer_phone: customerPhone } : {}),
      country: "id",
    });
  };
  const abandonedCapture = new AbandonedLeadCaptureGate(
    readAbandonedLeadFingerprints(sessionStorage),
  );
  let abandonedTimer: number | undefined;

  const maybeRecordAbandonedLead = () => {
    const customerName = String(customerNameInput?.value || "").trim();
    const customerPhone = normalizePhone(String(phoneInput?.value || ""));
    if (customerName.length < 3 || !isValidWa62(customerPhone)) return;

    const selectedVariant = getSelectedVariant();
    const variantId = selectedVariant ? Number(selectedVariant.value) : undefined;
    const fingerprint = createAbandonedLeadFingerprint({
      customerName,
      customerPhone,
      productId: config.productId,
      variantId,
    });
    if (!abandonedCapture.shouldStart(fingerprint)) return;

    window.clearTimeout(abandonedTimer);
    abandonedTimer = window.setTimeout(() => {
      if (!abandonedCapture.start(fingerprint)) return;
      const variantPrice = getSelectedPrice();
      const totalAmount =
        variantPrice > 0
          ? variantPrice + (state.shipping?.shipping_cost || 0)
          : undefined;
      void fetch("/api/record-abandoned-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          website: String(
            new FormData(form).get("contact_url_confirm") || "",
          ),
          customer_phone: customerPhone,
          product_id: config.productId,
          variant_id:
            Number.isFinite(variantId) && (variantId ?? 0) > 0
              ? variantId
              : undefined,
          total_amount:
            typeof totalAmount === "number" && totalAmount > 0
              ? totalAmount
              : undefined,
          product_title: config.productName,
          address: addressInput ? addressInput.value.trim() : "",
          province: state.selectedProvince || state.geoProvince || "",
        }),
      })
        .then((response) => {
          if (!response.ok) throw new Error("Abandoned capture rejected.");
          abandonedCapture.finish(fingerprint, true);
          writeAbandonedLeadFingerprint(sessionStorage, fingerprint);
        })
        .catch(() => {
          abandonedCapture.finish(fingerprint, false);
        });
    }, 600);
  };

  const ensureFieldFeedback = (
    field: HTMLInputElement | HTMLTextAreaElement,
  ) => {
    const wrapper = field.closest(".form-field") || field.parentElement;
    if (!wrapper) return null;
    let feedback = wrapper.querySelector<HTMLElement>(".field-feedback");
    if (!feedback) {
      feedback = document.createElement("small");
      feedback.className = "field-feedback";
      feedback.hidden = true;
      wrapper.appendChild(feedback);
    }
    return feedback;
  };

  const setFieldError = (
    field: HTMLInputElement | HTMLTextAreaElement,
    message = "",
  ) => {
    const feedback = ensureFieldFeedback(field);
    const wrapper = field.closest(".form-field");
    const hasValue = Boolean(String(field.value || "").trim());
    field.classList.toggle("field-invalid", Boolean(message));
    field.classList.toggle("field-valid", !message && hasValue);
    wrapper?.classList.toggle("has-error", Boolean(message));
    wrapper?.classList.toggle("has-success", !message && hasValue);
    field.setAttribute("aria-invalid", message ? "true" : "false");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.hidden = !message;
  };

  const validateField = (field: HTMLInputElement | HTMLTextAreaElement) => {
    setIdValidationMessage(field);
    const message = field.validationMessage || "";
    setFieldError(field, message);
    return !message;
  };

  const focusFieldWithScroll = (
    field: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  ) => {
    if (!field) return;
    requestAnimationFrame(() => {
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      field.focus({ preventScroll: true });
    });
  };

  if (
    !phoneInput ||
    !districtInput ||
    !districtList ||
    !districtPicked ||
    !paymentOptionsEl ||
    !submitButton ||
    !errorEl ||
    !districtSearchContainer
  ) {
    return;
  }

  let state: CheckoutState = {
    paymentMethod: "cod",
    paymentChannel: "",
    sellerBankAccountId: null,
    location: null,
    shipping: null,
    paymentOptions: [FALLBACK_PAYMENT_OPTIONS[0]],
    visiblePaymentOptions: [FALLBACK_PAYMENT_OPTIONS[0]],
    districtLoading: false,
    shippingLoading: false,
    submitting: false,
    selectedProvince: String(config.province || ""),
    selectedCity: "",
    selectedPostalCode: "",
    geoProvince: "",
    locationId: "",
    courierServiceId: "",
    shipmentProviderCode: "",
    warehouseUniqueId: "",
  };


  let districtSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let districtSearchSeq = 0;
  let districtSearchController: AbortController | null = null;
  let providerPrecisionSearch = false;

  const timerKey = `promo_end_${config.productSlug}_hybrid`;
  const now = Date.now();
  // A storage that throws (blocked site data) must not take the order form
  // down with a promo countdown; it just restarts per visit.
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(timerKey) || 0);
  } catch {}
  const end = stored > now ? stored : now + 30 * 60 * 1000;
  try {
    localStorage.setItem(timerKey, String(end));
  } catch {}

  const getSelectedVariant = () =>
    form.querySelector<HTMLInputElement>('input[name="variant"]:checked');
  const getSelectedPrice = () =>
    Number(getSelectedVariant()?.dataset.price || 0);
  const setNodeText = (el: Element | null | undefined, text: string) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  const syncShippingAddressSummary = () => {
    setNodeText(
      shippingAddressLine,
      addressInput?.value.trim() || "Alamat lengkap belum diisi.",
    );
    if (!state.location) return;
    setNodeText(
      districtPickedSubtitle,
      formatDeliveryLocation({
        district: state.location.district,
        city: state.location.city,
        province: state.location.province,
        postalCode: state.location.postal_code,
      }),
    );
  };

  const tick = () => {
    const minutesEl = formRoot.querySelector("[data-countdown-minutes]");
    const secondsEl = formRoot.querySelector("[data-countdown-seconds]");
    if (!minutesEl || !secondsEl) return;
    const diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
    minutesEl.textContent = String(Math.floor((diff % 3600) / 60)).padStart(
      2,
      "0",
    );
    secondsEl.textContent = String(diff % 60).padStart(2, "0");
  };

  const getSubmitState = () => {
    const hasPaymentChoices =
      Array.isArray(state.visiblePaymentOptions) &&
      state.visiblePaymentOptions.length > 0;
    const missing = missingCheckoutContact({
      name: customerNameInput?.value || "",
      phone: phoneInput?.value || "",
      address: addressInput?.value || "",
    });

    if (state.submitting)
      return {
        disabled: true,
        label: submitButton.dataset.loadingLabel || "Memproses Pesanan...",
      };
    if (missing === "name")
      return { disabled: true, label: "Lengkapi Nama Terlebih Dahulu" };
    if (missing === "phone")
      return { disabled: true, label: "Lengkapi No. WA Terlebih Dahulu" };
    if (missing === "address")
      return { disabled: true, label: "Lengkapi Alamat Terlebih Dahulu" };
    if (!state.locationId)
      return { disabled: true, label: "Lengkapi kecamatan dulu" };
    if (state.districtLoading)
      return { disabled: true, label: "Mencari kecamatan..." };
    if (state.shippingLoading)
      return { disabled: true, label: "Menghitung ongkir..." };
    if (!state.courierServiceId)
      return { disabled: true, label: "Menyiapkan ongkir..." };
    if (!hasPaymentChoices)
      return { disabled: true, label: "Menyiapkan pembayaran..." };

    return { disabled: false, label: "Buat Order Sekarang" };
  };

  const syncSubmitButton = () => {
    const next = getSubmitState();
    // See form-middle.ts: natively disabled only while submitting, so a tap on
    // an incomplete form always reaches the handler that names what is missing.
    submitButton.disabled = state.submitting;
    submitButton.setAttribute("aria-disabled", String(next.disabled));
    submitButton.dataset.state = state.submitting
      ? "loading"
      : next.disabled
        ? "disabled"
        : "ready";
    if (submitButtonLabel) submitButtonLabel.textContent = next.label;
  };

  const setSubmitting = (isSubmitting: boolean, text = "") => {
    state.submitting = isSubmitting;
    submitButton.dataset.loadingLabel = text || "Memproses Pesanan...";
    syncSubmitButton();
  };

  const setDistrictHelp = (
    text = "",
    tone: "neutral" | "error" | "success" = "neutral",
  ) => {
    if (!districtHelp) return;
    districtHelp.textContent = text;
    districtHelp.dataset.tone = tone;
  };

  const setIdValidationMessage = (
    field: HTMLInputElement | HTMLTextAreaElement,
  ) => {
    const name = field.getAttribute("name");
    const value = String(field.value || "").trim();

    if (name === "customer_name") {
      if (!value) field.setCustomValidity("Maaf, nama Anda belum terisi.");
      else if (value.length < 3)
        field.setCustomValidity("Maaf, nama Anda masih terlalu singkat.");
      else if (!/[A-Za-zÀ-ÿ]/.test(value) || /\d/.test(value))
        field.setCustomValidity(
          "Maaf, nama Anda harus berupa huruf, bukan angka.",
        );
      else field.setCustomValidity("");
      return;
    }

    if (name === "customer_phone") {
      if (!value)
        field.setCustomValidity("Maaf, nomor WhatsApp Anda belum terisi.");
      else if (/[^\d]/.test(value))
        field.setCustomValidity(
          "Maaf, nomor WhatsApp Anda harus berupa angka saja.",
        );
      else if (!value.startsWith("62"))
        field.setCustomValidity("Maaf, nomor WhatsApp harus diawali 62.");
      else if (!isValidWa62(value))
        field.setCustomValidity(
          "Maaf, nomor WhatsApp harus nomor mobile Indonesia yang aktif. Contoh: 6281234567890.",
        );
      else field.setCustomValidity("");
      return;
    }

    if (name === "address") {
      if (!value)
        field.setCustomValidity("Maaf, alamat lengkap Anda belum terisi.");
      else if (value.length < 10)
        field.setCustomValidity(
          "Maaf, alamat lengkap Anda masih terlalu singkat.",
        );
      else if (!/[A-Za-zÀ-ÿ]/.test(value))
        field.setCustomValidity(
          "Maaf, alamat lengkap Anda belum terlihat valid.",
        );
      else field.setCustomValidity("");
      return;
    }

    if (name === "district") {
      if (!value)
        field.setCustomValidity("Maaf, kecamatan / area Anda belum terisi.");
      else if (!state.locationId)
        field.setCustomValidity(
          "Maaf, silakan pilih kecamatan dari daftar yang tersedia.",
        );
      else field.setCustomValidity("");
      return;
    }

    if (!value) {
      field.setCustomValidity("Maaf, kolom ini masih perlu dilengkapi.");
      return;
    }

    field.setCustomValidity("");
  };

  const isCodDisabledByProvince = () => {
    const provinceCode = normalizeProvinceCode(
      state.selectedProvince ||
        state.location?.province ||
        state.geoProvince ||
        "",
    );
    if (!provinceCode) return true;
    return COD_DISABLED_PROVINCE_CODES.includes(provinceCode);
  };

  const syncHiddenLocationFields = () => {
    if (locationIdInput) locationIdInput.value = state.locationId || "";
    if (postalCodeInput) postalCodeInput.value = state.selectedPostalCode || "";
    if (provinceInput) provinceInput.value = state.selectedProvince || "";
    if (cityInput) cityInput.value = state.selectedCity || "";
  };

  const syncHiddenShippingFields = () => {
    if (courierServiceIdInput)
      courierServiceIdInput.value = state.courierServiceId || "";
    if (shipmentProviderCodeInput)
      shipmentProviderCodeInput.value = state.shipmentProviderCode || "";
    if (warehouseUniqueIdInput)
      warehouseUniqueIdInput.value = state.warehouseUniqueId || "";
  };

  const syncPaymentFields = () => {
    if (paymentMethodBlock) paymentMethodBlock.hidden = !state.locationId;
  };

  const resetShippingState = () => {
    state.shipping = null;
    state.shippingLoading = false;
    state.courierServiceId = "";
    state.shipmentProviderCode = "";
    state.warehouseUniqueId = "";
    syncHiddenShippingFields();
    syncSubmitButton();
  };

  const closeDistrictList = () => {
    districtList.hidden = true;
    districtList.innerHTML = "";
  };

  const setDistrictLocked = (locked: boolean) => {
    districtSearchContainer.hidden = locked;
    districtPicked.hidden = !locked;
    if (locked) {
      closeDistrictList();
    } else {
      districtInput.value = "";
      setTimeout(() => districtInput.focus(), 50);
    }
  };

  const resetLocationState = () => {
    state.location = null;
    state.selectedProvince = "";
    state.selectedCity = "";
    state.selectedPostalCode = "";
    state.locationId = "";
    syncHiddenLocationFields();
    syncPaymentFields();
    resetShippingState();
    setDistrictLocked(false);
    syncSubmitButton();
  };

  const isPaymentOptionSelected = (item: PaymentOption) =>
    item.paymentMethod === state.paymentMethod &&
    (item.channelCode || "") === state.paymentChannel &&
    (item.sellerBankAccountId || null) === state.sellerBankAccountId;

  const syncVisiblePaymentOptions = () => {
    state.visiblePaymentOptions = isCodDisabledByProvince()
      ? state.paymentOptions.filter((item) => item.paymentMethod !== "cod")
      : [...state.paymentOptions];

    const selected = state.visiblePaymentOptions.find(isPaymentOptionSelected);
    if (!selected) {
      const first = state.visiblePaymentOptions[0];
      if (first) {
        state.paymentMethod = first.paymentMethod;
        state.paymentChannel = first.channelCode || "";
        state.sellerBankAccountId = first.sellerBankAccountId || null;
      }
    }
    syncPaymentFields();
  };

  const selectedPaymentAdminFee = (orderAmount: number) => {
    const option = state.visiblePaymentOptions.find(isPaymentOptionSelected);
    if (!option || option.feeBearer === "seller") return 0;
    if (option.paymentMethod === "cod") {
      return calculateCodFeeBreakdown(orderAmount).totalFee;
    }
    // The same fee the server asks AutoLaris for, so the bill equals this total.
    return buyerPaymentAdminFee(option.code, orderAmount)
      ?? (option.adminFeeRate > 0
        ? Math.ceil(orderAmount * option.adminFeeRate)
        : option.adminFee);
  };
  const paymentOptionDescription = (option: PaymentOption) => {
    if (option.feeBearer === "seller") {
      return option.paymentMethod === "manual_transfer"
        ? option.desc
        : "Tanpa biaya admin";
    }
    if (option.paymentMethod !== "cod" && option.adminFeeRate <= 0) {
      return option.desc;
    }
    if (state.shippingLoading) return "Biaya admin menunggu ongkir";
    if (!state.shipping) return "Biaya admin dihitung setelah ongkir dipilih";
    const orderAmount =
      getSelectedPrice() + Number(state.shipping.shipping_cost || 0);
    const adminFee =
      option.paymentMethod === "cod"
        ? calculateCodFeeBreakdown(orderAmount).totalFee
        : buyerPaymentAdminFee(option.code, orderAmount)
          ?? Math.ceil(orderAmount * option.adminFeeRate);
    return `Biaya admin ${fmt(adminFee)}`;
  };

  const syncPaymentOptionDescriptions = () => {
    paymentOptionsEl
      .querySelectorAll<HTMLInputElement>(".payment-option input")
      .forEach((input) => {
        const option = state.visiblePaymentOptions.find(
          (item) => item.code === input.value,
        );
        const description = input
          .closest(".payment-option")
          ?.querySelector(".payment-option-desc");
        if (option && description) {
          description.textContent = paymentOptionDescription(option);
        }
      });
  };

  const syncSummary = () => {
    const checked = getSelectedVariant();
    const productPrice = getSelectedPrice();
    const comparePrice = Number(checked?.dataset.compare || productPrice);
    const hasDiscount = comparePrice > productPrice;
    summaryCompareRow?.toggleAttribute("hidden", !hasDiscount);
    setNodeText(summaryLabel, checked?.dataset.label || config.productName);
    setNodeText(summaryCompare, fmt(comparePrice));
    setNodeText(summaryPriceValue, fmt(productPrice));
    const shippingLabel = state.shippingLoading
      ? "Menghitung..."
      : state.shipping
        ? `${fmt(state.shipping.shipping_cost)} (${state.shipping.name || state.shipping.shipment_provider_code || "Kurir"})`
        : "-";
    setNodeText(
      summaryAdminFeeLabel,
      state.paymentMethod === "cod" ? "Biaya COD" : "Biaya Admin",
    );
    setNodeText(summaryShipping, shippingLabel);
    const orderAmount =
      productPrice + Number(state.shipping?.shipping_cost || 0);
    const adminFee = selectedPaymentAdminFee(orderAmount);
    summaryAdminFeeRow?.toggleAttribute("hidden", adminFee <= 0);
    setNodeText(summaryAdminFee, fmt(adminFee));
    syncPaymentOptionDescriptions();
    setNodeText(
      summaryTotalNote,
      adminFee > 0
        ? state.paymentMethod === "cod"
          ? "Sudah termasuk produk + ongkir + biaya COD"
          : "Sudah termasuk produk + ongkir + biaya admin"
        : "Sudah termasuk produk + ongkir",
    );
    setNodeText(summaryTotal, fmt(orderAmount + adminFee));
    syncSubmitButton();
  };

  const applyQueryPrefill = () => {
    const params = new URLSearchParams(window.location.search);
    const variantId = String(
      params.get("variant_id") || params.get("variant") || "",
    ).trim();
    const customerName = String(params.get("customer_name") || "").trim();
    const customerPhone = String(params.get("customer_phone") || "").trim();
    const address = String(params.get("address") || "").trim();

    if (variantId) {
      const variantInput = form.querySelector<HTMLInputElement>(
        `input[name="variant"][value="${CSS.escape(variantId)}"]`,
      );
      if (variantInput) {
        variantInput.checked = true;
      }
    }

    if (customerNameInput && customerName) {
      customerNameInput.value = customerName
        .replace(/[^A-Za-zÀ-ÿ\s'.-]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    if (customerPhone) {
      phoneInput.value = normalizePhone(customerPhone);
    }

    if (address) {
      const addressInput = form.querySelector<HTMLTextAreaElement>(
        'textarea[name="address"]',
      );
      if (addressInput) {
        addressInput.value = address.trim();
      }
    }

    syncSummary();
  };

  const applyShippingSelection = (item: ShippingOption) => {
    state.shipping = item;
    state.courierServiceId = String(item?.courier_service_id || "1");
    state.shipmentProviderCode = String(
      item?.shipment_provider_code || "DEFAULT",
    );
    state.warehouseUniqueId = String(item?.warehouse_unique_id || "1");
    syncHiddenShippingFields();
    syncSubmitButton();
  };

  const applyShippingOptions = (list: ShippingOption[]) => {
    if (!state.location || !list.length) {
      state.shipping = null;
      state.courierServiceId = "";
      state.shipmentProviderCode = "";
      state.warehouseUniqueId = "";
      syncHiddenShippingFields();
      syncSummary();
      syncSubmitButton();
      return;
    }

    const sortedList = [...list].sort(
      (a, b) => Number(a.shipping_cost || 0) - Number(b.shipping_cost || 0),
    );
    applyShippingSelection(sortedList[0]);
    syncSummary();
  };
  let shippingRequestId = 0;
  const loadShippingOptions = async () => {
    const currentReqId = ++shippingRequestId;
    if (!state.location || !state.locationId) {
      applyShippingOptions([]);
      return;
    }

    const checked = getSelectedVariant();
    const cacheKey = [
      String(
        state.locationId ||
          state.location.id ||
          state.location.location_id ||
          "",
      ),
      String(checked?.value || ""),
      String(state.paymentMethod || "cod"),
    ].join("::");

    const cachedShipping = shippingOptionsCache.get(cacheKey);
    if (cachedShipping?.items?.length) {
      if (cachedShipping.postalCode && state.location) {
        state.location.postal_code = String(cachedShipping.postalCode);
        state.selectedPostalCode = String(cachedShipping.postalCode);
        syncHiddenLocationFields();
      }
      applyShippingOptions(cachedShipping.items);
      syncSubmitButton();
      return;
    }

    state.shippingLoading = true;
    syncSummary();
    syncSubmitButton();
    resetShippingState();
    try {
      const qs = new URLSearchParams({
        location_id: String(
          state.locationId ||
            state.location.id ||
            state.location.location_id ||
            "",
        ),
        variant_unique_id: String(checked?.value || ""),
        payment_method: String(state.paymentMethod || "cod"),
        city: String(state.selectedCity || state.location.city || ""),
      });

      const fetchShippingOnce = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        try {
          const resp = await fetch(`/api/shipping-options?${qs.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const data = (await resp.json().catch(() => ({}))) as any;
          if (!resp.ok || data?.success === false)
            throw new Error(data?.error || data?.message || "Fallback");
          return data;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      let data;
      try {
        data = await fetchShippingOnce();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
        data = await fetchShippingOnce();
      }
      if (currentReqId !== shippingRequestId) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) throw new Error("No shipping items");
      const sortedItems = items.sort(
        (a: ShippingOption, b: ShippingOption) =>
          Number(a.shipping_cost || 0) - Number(b.shipping_cost || 0),
      );
      if (data?.postal_code && state.location) {
        state.location.postal_code = String(data.postal_code);
        state.selectedPostalCode = String(data.postal_code);
        syncHiddenLocationFields();
      }
      shippingOptionsCache.set(cacheKey, {
        items: sortedItems,
        postalCode: data?.postal_code || "",
        source: "api",
      });
      applyShippingOptions(sortedItems);
    } catch {
      applyShippingOptions([]);
      setDistrictHelp(
        "Ongkir belum berhasil dihitung. Coba pilih kecamatan ulang atau ulangi beberapa saat lagi.",
        "error",
      );
    } finally {
      state.shippingLoading = false;
      syncSummary();
      syncSubmitButton();
    }
  };

  let bankGroupExpanded = false;
  let manualBankGroupExpanded = false;
  const syncPaymentGroupState = () => {
    paymentOptionsEl
      .querySelectorAll<HTMLElement>(".payment-group")
      .forEach((group) => {
        const paymentMethod = group.dataset.paymentMethod || "";
        const expanded =
          paymentMethod === "bank_transfer"
            ? bankGroupExpanded
            : manualBankGroupExpanded;
        const selectedOption = state.visiblePaymentOptions.find(
          (option) =>
            option.paymentMethod === paymentMethod &&
            isPaymentOptionSelected(option),
        );
        const head =
          group.querySelector<HTMLButtonElement>(".payment-group-head");
        const body =
          group.querySelector<HTMLDivElement>(".payment-group-body");
        const description = group.querySelector(
          ".payment-group-main .payment-option-desc",
        );
        group.classList.toggle("is-selected", Boolean(selectedOption));
        head?.setAttribute("aria-expanded", String(expanded));
        if (body) body.hidden = !expanded;
        if (description) {
          description.textContent =
            selectedOption?.label || group.dataset.emptyLabel || "";
        }
      });
  };

  const buildPaymentRow = (opt: PaymentOption, checked: boolean) => {
    const label = document.createElement("label");
    label.className = "payment-option";
    const brandCode = opt.bankCode || opt.channelCode || opt.code;
    const brandAsset = opt.logoUrl || paymentBrandAsset(brandCode);
    const badgeHtml = brandAsset
      ? `<span class="payment-brand-mark" aria-hidden="true"><img src="${brandAsset}" alt="" loading="lazy" /></span>`
      : opt.paymentMethod === "cod"
        ? `<span class="payment-brand-mark payment-brand-mark--text" aria-hidden="true">COD</span>`
        : "";

    label.innerHTML = `
      <input type="radio" name="payment_choice">
      <div class="payment-option-copy">
        <div class="payment-option-radio"></div>
        <div class="payment-option-main">
          <p class="payment-option-label"></p>
          <p class="payment-option-desc"></p>
        </div>
        ${badgeHtml}
      </div>
    `;
    const input = label.querySelector<HTMLInputElement>("input");
    if (input) {
      input.value = opt.code;
      input.checked = checked;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        state.paymentMethod = opt.paymentMethod;
        state.paymentChannel = opt.channelCode || "";
        state.sellerBankAccountId = opt.sellerBankAccountId || null;
        bankGroupExpanded = opt.paymentMethod === "bank_transfer";
        manualBankGroupExpanded = opt.paymentMethod === "manual_transfer";
        syncPaymentFields();
        syncPaymentGroupState();
        syncSummary();
        loadShippingOptions();
      });
    }
    const optionLabel = label.querySelector(".payment-option-label");
    const optionDescription = label.querySelector(".payment-option-desc");
    if (optionLabel) optionLabel.textContent = opt.label;
    if (optionDescription) optionDescription.textContent = paymentOptionDescription(opt);
    return label;
  };

  const renderPaymentOptions = () => {
    syncVisiblePaymentOptions();
    paymentOptionsEl.innerHTML = "";
    const options = state.visiblePaymentOptions;
    if (!options.length) {
      paymentOptionsEl.innerHTML =
        '<p class="rounded-none border border-[#f2c4c4] bg-[#fdf1f1] p-3 text-sm font-semibold text-[#a12626]">Metode pembayaran untuk wilayah ini belum tersedia. Hubungi admin untuk bantuan.</p>';
      syncSummary();
      syncSubmitButton();
      return;
    }

    const virtualAccountOptions = options.filter(
      (opt) => opt.paymentMethod === "bank_transfer",
    );
    const manualBankOptions = options.filter(
      (opt) => opt.paymentMethod === "manual_transfer",
    );
    const groupedOptions = new Set([
      ...virtualAccountOptions,
      ...manualBankOptions,
    ]);
    const qrisOptions = options.filter(
      (opt) => opt.paymentMethod === "qris",
    );
    const codOptions = options.filter(
      (opt) => opt.paymentMethod === "cod",
    );
    const otherDirectOptions = options.filter(
      (opt) =>
        !groupedOptions.has(opt) &&
        opt.paymentMethod !== "qris" &&
        opt.paymentMethod !== "cod",
    );
    const appendPaymentRows = (rows: PaymentOption[]) => {
      rows.forEach((opt) => {
        paymentOptionsEl.appendChild(
          buildPaymentRow(opt, isPaymentOptionSelected(opt)),
        );
      });
    };

    const appendPaymentGroup = (
      groupOptions: PaymentOption[],
      title: string,
      emptyLabel: string,
      expanded: boolean,
      toggle: () => void,
    ) => {
      if (!groupOptions.length) return;
      const groupSelected = groupOptions.some(isPaymentOptionSelected);
      const selectedOption = groupOptions.find(isPaymentOptionSelected);
      const group = document.createElement("div");
      group.className = `payment-group${groupSelected ? " is-selected" : ""}`;
      group.dataset.paymentMethod = groupOptions[0]?.paymentMethod || "";
      group.dataset.emptyLabel = emptyLabel;
      group.innerHTML = `
        <button type="button" class="payment-group-head" aria-expanded="${expanded}">
          <span class="payment-option-radio"></span>
          <span class="payment-group-main">
            <span class="payment-option-label">${title}</span>
            <span class="payment-option-desc"></span>
          </span>
          <svg class="payment-group-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="payment-group-body"></div>
      `;
      const head = group.querySelector<HTMLButtonElement>(".payment-group-head");
      const groupDesc = group.querySelector(".payment-group-main .payment-option-desc");
      const body = group.querySelector<HTMLDivElement>(".payment-group-body");
      if (groupDesc) {
        groupDesc.textContent =
          groupSelected && selectedOption ? selectedOption.label : emptyLabel;
      }
      if (body) {
        body.hidden = !expanded;
        groupOptions.forEach((opt) => {
          body.appendChild(buildPaymentRow(opt, isPaymentOptionSelected(opt)));
        });
      }
      head?.addEventListener("click", () => {
        toggle();
        syncPaymentGroupState();
      });
      paymentOptionsEl.appendChild(group);
    };

    appendPaymentRows(qrisOptions);
    // A group of one is an extra click in front of the only choice, so a
    // single account or bank renders as its own row.
    if (manualBankOptions.length === 1) appendPaymentRows(manualBankOptions);
    else
      appendPaymentGroup(
        manualBankOptions,
        "Transfer Bank",
        `${manualBankOptions.length} rekening tersedia`,
        manualBankGroupExpanded,
        () => {
          manualBankGroupExpanded = !manualBankGroupExpanded;
        },
      );
    if (virtualAccountOptions.length === 1) appendPaymentRows(virtualAccountOptions);
    else
      appendPaymentGroup(
        virtualAccountOptions,
        "Virtual Account",
        `${virtualAccountOptions.length} bank tersedia`,
        bankGroupExpanded,
        () => {
          bankGroupExpanded = !bankGroupExpanded;
        },
      );
    appendPaymentRows(codOptions);
    appendPaymentRows(otherDirectOptions);

    syncSummary();
    syncSubmitButton();
  };

  const applyDistrictSelection = (item: DistrictOption) => {
    providerPrecisionSearch = false;
    state.location = item;
    state.locationId = String(item.id || item.location_id || "");
    state.selectedProvince = String(item.province || "");
    state.selectedCity = String(item.city || "");
    state.selectedPostalCode = String(item.postal_code || "");
    syncHiddenLocationFields();
    syncPaymentFields();
    syncVisiblePaymentOptions();
    districtInput.value = item.label;
    syncShippingAddressSummary();
    closeDistrictList();
    setDistrictLocked(true);
    districtInput.setCustomValidity("");
    setFieldError(districtInput, "");
    setDistrictHelp("", "success");
    renderPaymentOptions();
    loadShippingOptions();
  };

  const attachProviderAlternatives = (
    catalogDistrict: string,
    items: DistrictOption[],
    help = `Nama Kecamatan ${catalogDistrict} berbeda di data Expedisi Pengiriman. Pilih kelurahan/desa tujuan yang sesuai.`,
  ) => {
    districtList.innerHTML = "";
    districtList.hidden = false;
    setDistrictHelp(help, "neutral");
    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "district-item";
      button.dataset.index = String(index);
      const title = document.createElement("strong");
      title.textContent = item.subdistrict
        ? `${item.district} — ${item.subdistrict}`
        : item.district;
      const detail = document.createElement("small");
      detail.textContent = [item.city, item.province, item.postal_code]
        .filter(Boolean)
        .join(", ");
      button.append(title, detail);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => applyDistrictSelection(item));
      districtList.appendChild(button);
    });
  };

  const attachDistrictItems = (items: DistrictOption[], query = "") => {
    districtList.innerHTML = "";
    districtList.hidden = false;
    if (!items.length) {
      districtList.innerHTML =
        '<div class="district-empty">Kecamatan tidak ditemukan.</div>';
      setDistrictHelp(
        "Kecamatan tidak ditemukan. Ketik nama kecamatan lebih lengkap.",
        "error",
      );
      return;
    }

    const groups = groupLocationResults(items);
    setDistrictHelp(
      `Ditemukan ${groups.length} kecamatan. Pilih kecamatan yang sesuai.`,
      "neutral",
    );
    groups.forEach((group, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "district-item";
      btn.dataset.index = String(index);
      if (
        groups.length === 1 &&
        group.district.localeCompare(query.trim(), "id-ID", {
          sensitivity: "base",
        }) === 0
      ) {
        btn.dataset.exactMatch = "true";
      }
      // Built as nodes, not markup: these three fields come back from the
      // shipping provider, and interpolating them into `innerHTML` put
      // third-party text through an HTML parser on the public checkout page.
      const districtName = document.createElement("strong");
      districtName.textContent = group.district;
      const districtArea = document.createElement("small");
      districtArea.textContent = `${group.city}, ${group.province}`;
      btn.replaceChildren(districtName, districtArea);
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
      });
      btn.addEventListener("click", async () => {
        closeDistrictList();
        districtInput.value = `${group.district}, ${group.city}, ${group.province}`;
        setNodeText(
          shippingAddressLine,
          addressInput?.value.trim() || "Alamat lengkap belum diisi.",
        );
        setNodeText(districtPickedSubtitle, `${group.district}, ${group.city}, ${group.province}`);
        setDistrictLocked(true);
        setDistrictHelp(
          `Menyiapkan ongkir Kecamatan ${group.district}...`,
          "neutral",
        );

        try {
          const params = new URLSearchParams({
            search: group.district,
            city: group.city,
            province: group.province,
            level: "resolve",
          });
          const response = await fetch(`/api/locations?${params.toString()}`, {
            cache: "no-store",
          });
          const data = (await response.json().catch(() => ({}))) as {
            items?: Array<Record<string, unknown>>;
            alternatives?: Array<Record<string, unknown>>;
          };
          const item =
            Array.isArray(data.items) && data.items.length > 0
              ? data.items[0]
              : Array.isArray(data.alternatives) && data.alternatives.length > 0
              ? data.alternatives[0]
              : null;
          const locId = String(
            item?.location_id || item?.id || item?._id || "",
          );
          if (!response.ok) throw new Error("District unresolved");
          if (!locId && Array.isArray(data.alternatives) && data.alternatives.length > 0) {
            const alternatives = data.alternatives.map((alternative) => {
              const id = String(
                alternative.location_id || alternative.id || alternative._id || "",
              );
              const district = String(
                alternative.district_name || alternative.district || "",
              );
              const subdistrict = String(alternative.subdistrict_name || "");
              const city = String(alternative.city_name || alternative.city || group.city);
              const province = String(
                alternative.province_name || alternative.province || group.province,
              );
              const postalCode = String(alternative.postal_code || "");
              return {
                id,
                location_id: id,
                label: [district, subdistrict, city, province].filter(Boolean).join(", "),
                district,
                subdistrict,
                city,
                province,
                postal_code: postalCode,
              } satisfies DistrictOption;
            }).filter((alternative) => alternative.id);
            if (alternatives.length > 0) {
              setDistrictLocked(false);
              attachProviderAlternatives(group.district, alternatives);
              return;
            }
          }
          if (!locId) throw new Error("District unresolved");
          applyDistrictSelection({
            id: locId,
            location_id: locId,
            label: `${group.district}, ${group.city}, ${group.province}`,
            district: group.district,
            subdistrict: String(item?.subdistrict_name || ""),
            city: group.city,
            province: group.province,
            postal_code: String(item?.postal_code || ""),
          });
        } catch {
          setDistrictLocked(false);
          providerPrecisionSearch = true;
          districtSearchCache.clear();
          setDistrictHelp(
            "Kecamatan ini belum tersedia sebagai tujuan pengiriman. Pilih rekomendasi kecamatan atau kelurahan/desa terkait.",
            "error",
          );
        }
      });
      districtList.appendChild(btn);
    });
    districtList
      .querySelector<HTMLButtonElement>('[data-exact-match="true"]')
      ?.click();
  };

  const renderDistrictOptions = async (query: string) => {
    const q = String(query || "").trim();
    const searchId = ++districtSearchSeq;
    if (districtSearchController) {
      districtSearchController.abort();
      districtSearchController = null;
    }
    if (q.length < 3) {
      closeDistrictList();
      setDistrictHelp(
        "Ketik minimal 3 huruf (kecamatan atau kota).",
        "neutral",
      );
      state.districtLoading = false;
      return;
    }

    const cacheKey = `${providerPrecisionSearch ? 'provider' : 'district'}:${q.toLowerCase()}`;
    const cachedDistricts = districtSearchCache.get(cacheKey);
    if (cachedDistricts) {
      if (providerPrecisionSearch) {
        attachProviderAlternatives(
          q,
          cachedDistricts.items,
          `Pilih tujuan Expedisi Pengiriman yang sesuai dengan kelurahan/desa "${q}".`,
        );
      } else {
        attachDistrictItems(cachedDistricts.items, q);
      }
      state.districtLoading = false;
      syncSubmitButton();
      return;
    }

    state.districtLoading = true;
    syncSubmitButton();
    setDistrictHelp(`Mencari lokasi untuk "${q}"...`, "neutral");
    districtList.hidden = false;
    districtList.innerHTML =
      '<div class="district-empty">Memuat hasil kecamatan...</div>';

    try {
      districtSearchController = new AbortController();
      const locationParams = new URLSearchParams({ search: q });
      if (!providerPrecisionSearch) locationParams.set("level", "district");
      const resp = await fetch(
        `/api/locations?${locationParams.toString()}`,
        {
          cache: "no-store",
          signal: districtSearchController.signal,
        },
      );
      const data = (await resp.json().catch(() => ({}))) as any;
      if (searchId !== districtSearchSeq) return;
      if (!resp.ok || data?.success === false) throw new Error("Fallback");
      const items = (Array.isArray(data?.items) ? data.items : []).map(
        (item: any) =>
          ({
            id: String(item.location_id || item.id || ""),
            label: String(item.label || ""),
            district: String(item.district_name || item.subdistrict_name || ""),
            subdistrict: String(item.subdistrict_name || ""),
            city: String(item.city_name || ""),
            province: String(item.province_name || ""),
            postal_code: String(item.postal_code || ""),
            location_id: String(item.location_id || item.id || ""),
          }) satisfies DistrictOption,
      );
      districtSearchCache.set(cacheKey, { items, source: "api" });
      if (providerPrecisionSearch) {
        attachProviderAlternatives(
          q,
          items,
          `Pilih tujuan Expedisi Pengiriman yang sesuai dengan kelurahan/desa "${q}".`,
        );
      } else {
        attachDistrictItems(items, q);
      }
    } catch (error: any) {
      if (searchId !== districtSearchSeq) return;
      if (error?.name === "AbortError") return;
      districtSearchCache.set(cacheKey, { items: [], source: "api" });
      attachDistrictItems([]);
      setDistrictHelp(
        "Pencarian kecamatan belum berhasil. Coba kata kunci lain atau ulangi beberapa saat lagi.",
        "error",
      );
    } finally {
      if (searchId === districtSearchSeq) {
        state.districtLoading = false;
        syncSubmitButton();
      }
      districtSearchController = null;
    }
  };

  const queueDistrictSearch = (value: string, immediate = false) => {
    if (districtSearchTimer) clearTimeout(districtSearchTimer);
    if (immediate) {
      renderDistrictOptions(value);
      return;
    }
    districtSearchTimer = setTimeout(() => renderDistrictOptions(value), 100);
  };

  applyQueryPrefill();
  renderPaymentOptions();
  applyQueryPrefill();
  syncSubmitButton();
  applyPromoStock(formRoot, config.productSlug);
  tick();
  if (
    formRoot.querySelector("[data-countdown-minutes]") &&
    formRoot.querySelector("[data-countdown-seconds]")
  ) {
    setInterval(tick, 1000);
  }
  form
    .querySelectorAll<HTMLInputElement>('input[name="variant"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        syncSummary();
        maybeTrackAddToCart(true);
        if (state.locationId) loadShippingOptions();
      });
    });


  districtInput.addEventListener("input", (e) => {
    const value = String((e.target as HTMLInputElement).value || "");
    if (!value.trim()) providerPrecisionSearch = false;
    if (state.locationId) resetLocationState();
    syncVisiblePaymentOptions();
    renderPaymentOptions();
    applyShippingOptions([]);

    if (value.trim().length >= 3) {
      districtList.hidden = false;
      districtList.innerHTML =
        '<div class="district-empty">Mencari kecamatan...</div>';
      queueDistrictSearch(value);
      return;
    }

    closeDistrictList();
    queueDistrictSearch(value);
  });

  districtEditButton?.addEventListener("click", resetLocationState);

  districtInput.addEventListener("focus", () => {
    const value = String(districtInput.value || "").trim();
    if (value.length >= 3 && !state.locationId) {
      districtList.hidden = false;
      districtList.innerHTML =
        '<div class="district-empty">Mencari kecamatan...</div>';
      queueDistrictSearch(value, true);
    }
  });

  districtInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !districtList.hidden) {
      const firstItem =
        districtList.querySelector<HTMLButtonElement>(".district-item");
      if (firstItem) {
        e.preventDefault();
        firstItem.click();
      }
    }
    if (e.key === "Escape") closeDistrictList();
  });

  document.addEventListener("click", (e) => {
    const target = e.target as Node | null;
    if (target && !districtList.contains(target) && target !== districtInput)
      closeDistrictList();
  });

  customerNameInput?.addEventListener("input", () => {
    customerNameInput.value = String(customerNameInput.value || "")
      .replace(/[^A-Za-zÀ-ÿ\s'.-]/g, "")
      .replace(/\s{2,}/g, " ");
    setIdValidationMessage(customerNameInput);
    syncSubmitButton();
    maybeTrackAddToCart();
  });
  addressInput?.addEventListener("input", () => {
    syncShippingAddressSummary();
    syncSubmitButton();
  });
  customerNameInput?.addEventListener("blur", () => {
    customerNameInput.value = String(customerNameInput.value || "").trim();
    validateField(customerNameInput);
    maybeTrackAddToCart();
    maybeRecordAbandonedLead();
  });
  customerNameInput?.addEventListener("invalid", () =>
    validateField(customerNameInput),
  );

  phoneInput.addEventListener("input", () => {
    const digits = String(phoneInput.value || "").replace(/\D/g, "");
    if (!digits) {
      phoneInput.value = "";
      phoneInput.setCustomValidity("");
      setFieldError(phoneInput, "");
      syncSubmitButton();
      return;
    }
    if (digits.startsWith("620")) phoneInput.value = `62${digits.slice(3)}`;
    else if (digits.startsWith("0")) phoneInput.value = `62${digits.slice(1)}`;
    else if (digits.startsWith("8")) phoneInput.value = `62${digits}`;
    else if (digits.startsWith("62")) phoneInput.value = digits;
    else phoneInput.value = digits;
    setIdValidationMessage(phoneInput);
    syncSubmitButton();
    maybeTrackAddToCart();
  });
  phoneInput.addEventListener("blur", () => {
    phoneInput.value = normalizePhone(phoneInput.value);
    validateField(phoneInput);
    maybeTrackAddToCart();
    maybeRecordAbandonedLead();
  });
  form
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input[required], textarea[required]",
    )
    .forEach((field) => {
      ensureFieldFeedback(field);
      field.addEventListener("blur", () => validateField(field));
      field.addEventListener("input", () => {
        if (field.getAttribute("name") === "district" && !state.locationId)
          return;
        field.setCustomValidity("");
        setFieldError(field, "");
      });
    });

  fetch("/api/geo-province", { cache: "no-store" })
    .then(async (r) => {
      const d = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || d?.success === false) throw new Error("fallback");
      const province = normalizeProvinceCode(d?.province || "");
      if (!province || state.selectedProvince || state.locationId) return;
      state.geoProvince = province;
    })
    .catch(() => {})
    .finally(() => {
      syncVisiblePaymentOptions();
      renderPaymentOptions();
      syncSummary();
      syncSubmitButton();
    });

  fetch("/api/payment-methods", { cache: "no-store" })
    .then(async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("success" in payload) ||
        payload.success === false
      ) {
        throw new Error("fallback");
      }
      const next = parsePaymentOptions(payload);
      state.paymentOptions = next.length ? next : [...FALLBACK_PAYMENT_OPTIONS];
    })
    .catch(() => {
      state.paymentOptions = [...FALLBACK_PAYMENT_OPTIONS];
    })
    .finally(() => {
      syncVisiblePaymentOptions();
      renderPaymentOptions();
      if (state.locationId) loadShippingOptions();
      syncSummary();
      syncSubmitButton();
    });

  // Autofill can set a value and fire only `change`.
  form.addEventListener("change", syncSubmitButton);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    setSubmitting(true, "Memvalidasi Data...");
    // Autofill stores numbers as 08…; normalise before validating, since the
    // `input`/`blur` handlers that usually do it may never have run.
    if (phoneInput.value) phoneInput.value = normalizePhone(phoneInput.value);

    const fd = new FormData(form);
    const customerName = String(fd.get("customer_name") || "").trim();
    const customerPhone = normalizePhone(
      String(fd.get("customer_phone") || ""),
    );
    const address = String(fd.get("address") || "").trim();
    const checked = getSelectedVariant();

    const requiredFields = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input[required], textarea[required]",
      ),
    );
    const invalidField = requiredFields.find((field) => !validateField(field));

    if (
      invalidField ||
      !checked ||
      !customerName ||
      !isValidWa62(customerPhone) ||
      !address
    ) {
      errorEl.textContent =
        "Maaf, masih ada data yang perlu dilengkapi dengan benar.";
      errorEl.hidden = false;
      focusFieldWithScroll(invalidField);
      setSubmitting(false);
      return;
    }
    if (state.districtLoading) {
      errorEl.textContent =
        "Maaf, tunggu sebentar. Sistem masih mencari kecamatan Anda.";
      errorEl.hidden = false;
      setSubmitting(false);
      return;
    }
    if (!state.location || !state.locationId) {
      errorEl.textContent =
        "Maaf, silakan pilih kecamatan dari daftar yang tersedia.";
      errorEl.hidden = false;
      focusFieldWithScroll(districtInput);
      setSubmitting(false);
      return;
    }
    if (state.shippingLoading) {
      errorEl.textContent = "Tunggu sebentar, ongkir sedang dihitung.";
      errorEl.hidden = false;
      setSubmitting(false);
      return;
    }
    if (!state.shipping || !state.courierServiceId) {
      errorEl.textContent = "Silakan pilih opsi pengiriman terlebih dahulu.";
      errorEl.hidden = false;
      setSubmitting(false);
      return;
    }
    // The button is tappable while incomplete, so every gate in
    // getSubmitState needs its guard here; without this one an order could
    // leave on the default "cod" before the payment choices loaded.
    if (!state.visiblePaymentOptions?.length) {
      errorEl.textContent = "Tunggu sebentar, metode pembayaran sedang disiapkan.";
      errorEl.hidden = false;
      setSubmitting(false);
      return;
    }

    phoneInput.value = customerPhone;
    maybeTrackAddToCart();
    if (hasQualifiedIdentity()) {
      void trackMeta("InitiateCheckout", {
        customer_name: customerName,
        customer_phone: customerPhone,
        country: "id",
        province: state.selectedProvince || state.location?.province,
        city: state.selectedCity || state.location?.city,
        district: state.location?.district,
        postal_code: state.selectedPostalCode || state.location?.postal_code,
      });
    }
    const price = Number(checked.dataset.price || 0);
    const label = String(checked.dataset.label || config.productName);
    const shippingCost = Number(state.shipping.shipping_cost || 0);
    const totalPayment = price + shippingCost;
    // eventId hanya untuk flow awal/funnel. Purchase tidak pernah memakai id
    // buatan browser: thanks page memakai order_number, sama persis dengan
    // event_id yang dipakai server CAPI, supaya Meta bisa dedup jadi 1 conversion.
    const eventId = createId(`lead_${config.productSlug}`);
    const guardToken = createId(`tg_${config.productSlug}`);
    if (!state.submitToken) {
      state.submitToken = createId(`sb_${config.productSlug}`);
    }
    const submitToken = state.submitToken;

    let orderId = `PS-${Date.now().toString().slice(-8)}`;
    let orderPk = `pk_${Date.now()}`;
    let statusToken = "";
    let paymentMethodFinal: string = state.paymentMethod;
    let paymentUrl = "";
    let orderStatus = "pending";
    let paymentResult: SubmitOrderResponse["payment"];
    let billedTotal = totalPayment;
    let paymentStatus = "unpaid";
    let codServiceFee = 0;
    let codServiceFeeVat = 0;
    let appliedFeeBearer: "buyer" | "seller" = "buyer";

    try {
      setSubmitting(true, "Membuat Order...");
      const resp = await fetch("/api/submit-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submit_token: `${submitToken}_${eventId}`,
          website: String(fd.get("contact_url_confirm") || ""),
          customer_name: customerName,
          seller_bank_account_id:
            state.paymentMethod === "manual_transfer"
              ? state.sellerBankAccountId || undefined
              : undefined,
          customer_phone: customerPhone,
          address,
          district: state.location.district,
          payment_method: state.paymentMethod,
          variant_id: String(checked.value || ""),
          payment_channel: state.paymentChannel || undefined,
          city: state.selectedCity || state.location.city || undefined,
          quantity: 1,
          location_id:
            state.locationId ||
            state.location.id ||
            state.location.location_id ||
            undefined,
          postal_code:
            state.selectedPostalCode || state.location.postal_code || undefined,
          courier_service_id:
            Number(
              state.courierServiceId || state.shipping.courier_service_id || 0,
            ) || undefined,
          warehouse_unique_id:
            state.warehouseUniqueId ||
            state.shipping.warehouse_unique_id ||
            undefined,
          shipment_provider_code:
            state.shipmentProviderCode ||
            state.shipping.shipment_provider_code ||
            undefined,
          shipping_cost: shippingCost,
          province:
            state.selectedProvince || state.location.province || undefined,
          source_page_path: window.location.pathname,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as SubmitOrderResponse;
      if (!resp.ok || data.success === false) {
        const apiMessage = String(data.error || data.message || "").trim();
        if (resp.status === 422 && /COD/i.test(apiMessage)) {
          errorEl.textContent = apiMessage;
          errorEl.hidden = false;
          const onlineOption = state.visiblePaymentOptions.find(
            (option) => option.paymentMethod !== "cod",
          );
          if (onlineOption) {
            state.paymentMethod = onlineOption.paymentMethod;
            state.paymentChannel = onlineOption.channelCode || "";
            state.sellerBankAccountId =
              onlineOption.sellerBankAccountId || null;
            renderPaymentOptions();
            loadShippingOptions();
          }
          setSubmitting(false);
          return;
        }
        if (resp.status === 409) {
          errorEl.textContent =
            apiMessage ||
            "Pesanan Anda sedang diproses. Mohon tunggu sebentar lalu cek kembali.";
          errorEl.hidden = false;
          setSubmitting(false);
          return;
        }
        errorEl.textContent =
          apiMessage || "Maaf, order belum berhasil dibuat. Silakan coba lagi.";
        errorEl.hidden = false;
        setSubmitting(false);
        return;
      }
      if (data.order) {
        const order = data.order;
        orderId = String(
          order.order_id || order.order_number || order.unique_id || orderId,
        );
        orderPk = String(order.id || orderPk);
        statusToken = String(order.status_token || "").trim();
        paymentMethodFinal = String(
          order.payment_method || paymentMethodFinal || "cod",
        ).toLowerCase();
        paymentUrl = String(order.payment_url || "").trim();
        orderStatus = String(
          order.status || orderStatus || "pending",
        ).toLowerCase();
        paymentStatus = String(
          order.payment_status || paymentStatus || "unpaid",
        ).toLowerCase();
        billedTotal = Number(order.total_payment || billedTotal);
        codServiceFee = Number(order.cod_service_fee || 0);
        codServiceFeeVat = Number(order.cod_service_fee_vat || 0);
        appliedFeeBearer =
          order.cod_fee_bearer === "seller" ? "seller" : "buyer";
      }
      paymentResult = data.payment;
      if (paymentResult) {
        paymentUrl = String(paymentResult.payment_url || paymentUrl).trim();
        billedTotal = Number(paymentResult.total_amount || totalPayment);
      }
    } catch {
      errorEl.textContent =
        "Maaf, koneksi ke server sedang bermasalah. Silakan coba lagi beberapa saat.";
      errorEl.hidden = false;
      setSubmitting(false);
      return;
    }

    const thanksState = {
      order_id: orderId,
      order_pk: orderPk,
      status_token: statusToken,
      payment_method: paymentMethodFinal,
      payment_url: paymentUrl,
      payment_channel: String(
        paymentResult?.channel_code || state.paymentChannel,
      ),
      payment_amount: Number(paymentResult?.amount || totalPayment),
      payment_admin_fee: Number(
        paymentResult?.admin_fee || codServiceFee + codServiceFeeVat,
      ),
      payment_fee_bearer:
        paymentResult?.fee_bearer === "seller" ||
        (!paymentResult && appliedFeeBearer === "seller")
          ? "seller"
          : "buyer",
      cod_service_fee: codServiceFee,
      cod_service_fee_vat: codServiceFeeVat,
      payment_virtual_account: String(paymentResult?.virtual_account || ""),
      payment_qr_payload: String(paymentResult?.qr_payload || ""),
      payment_code: String(paymentResult?.payment_code || ""),
      payment_expires_at: String(paymentResult?.expires_at || ""),
      payment_error: String(paymentResult?.error || ""),
      payment_account_holder: String(paymentResult?.account_holder || ""),
      payment_bank_name: String(paymentResult?.bank_name || ""),
      payment_manual_transfer: Boolean(paymentResult?.manual_transfer),
      order_status: orderStatus,
      payment_status: paymentStatus,
      event_id: eventId,
      value: price,
      name: customerName,
      phone: customerPhone,
      address,
      product_id: String(config.productId || ''),
      product_name: config.productName,
      product_price: price,
      quantity: 1,
      shipping_cost: shippingCost,
      total_payment: billedTotal,
      variant_unique_id: String(checked.value || ""),
      variant_label: label,
      district: state.location.district,
      city: state.selectedCity || state.location.city,
      province: state.selectedProvince || state.location.province,
      postal_code: state.selectedPostalCode || state.location.postal_code,
      guard_token: guardToken,
    };
    // The order already exists in D1 by this point, so nothing here may throw:
    // a storage write that fails must not cost the buyer their confirmation.
    // Safari's private mode has historically thrown on any write, and a browser
    // set to block site data does the same. Unguarded, that stranded a buyer on
    // the submitting spinner with a real order behind them — and because the
    // CAPI Purchase is only ever triggered from `/thanks`, neither leg fired.
    try {
      sessionStorage.setItem("thanks_state", JSON.stringify(thanksState));
    } catch {
      // The fragment locator below carries the order on its own.
    }

    const destinationPath =
      paymentMethodFinal !== "cod" &&
      !["paid", "settled", "success"].includes(paymentStatus)
        ? "/payment"
        : "/thanks";

    setSubmitting(
      true,
      destinationPath === "/payment"
        ? "Membuka Instruksi Pembayaran..."
        : "Mengalihkan ke Halaman Terima Kasih...",
    );
    // The payment locator rides in the URL fragment, which browsers never send
    // to a server or a referrer, so the instructions survive a lost tab or a
    // hand-off to another device without exposing the token to analytics.
    // Both destinations carry the locator, not just `/payment`. The fragment is
    // never sent to a server or a referrer, which is why it was chosen for the
    // payment instructions; `/thanks` needs the same carrier for the same
    // reason — it is the only other page that must survive a lost tab or a
    // storage write that never landed.
    const locator = `#o=${encodeURIComponent(String(thanksState.order_pk ?? ""))}&t=${encodeURIComponent(String(thanksState.status_token ?? ""))}`;
    navigateAfterCheckout(`${destinationPath}${locator}`);
  });
}

export function initHybridOrderForm(root?: Document | HTMLElement) {
  const scope = root || document;
  const forms = scope.querySelectorAll<HTMLElement>("[data-hybrid-form-root]");
  forms.forEach((formRoot) => initHybridOrderFormInstance(formRoot));
}
