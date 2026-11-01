import { formatIdr } from "@/lib/format-idr";
import { isVoidOrder } from "@/lib/order-lifecycle";
import { acceptedShipmentId, isDispatchOutcomeUnknown } from "@/lib/payment-dispatch-policy";
import { useConfirm } from "./useConfirm";
import { calculateCodCustomerTotal, calculateCodFeeBreakdown } from "@/lib/payment-fee-policy";
import { TrafficSourceBadge } from "./TrafficSourceBadge";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWaUrl, defaultCrmTemplates, renderCrmMessage } from "../../lib/crm-template";
import { CrmActionGroup } from "./CrmActionGroup";
import { PaymentSwitchDialog } from "./PaymentSwitchDialog";
import { MengantarPushDialog } from "./MengantarPushDialog";
import type { MengantarPickupChoice } from "@/lib/mengantar-order";
import { CRM_STEPS } from "./CrmActionButton";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { toast } from "sonner";
import { SHIPPING_STATUS_LABELS } from "@/lib/shipping-status";
import { courierServiceLabel } from "@/lib/courier-names";
import { DistrictCombobox, type DistrictOption } from "@/components/admin/DistrictCombobox";
import { FilterSelect } from "@/components/admin/filter-bar";
import { etaLabel } from "@/lib/rate-check";
import {
  CURRENT_WEIGHT_LABEL,
  RECORDED_WEIGHT_LABEL,
  formatGrams,
  formatWeight,
  quoteUnitWeightKg,
  summarizeOrderWeight,
} from "@/lib/weight";
import { cn } from "@/lib/utils";
import { groupLocationResults } from "../../lib/location-search";
import {
  ArrowLeft,
  Copy,
  Check,
  Phone,
  MapPin,
  Package,
  Truck,
  CreditCard,
  ShieldAlert,
  MessageSquare,
  Trash2,
  ExternalLink,
  RefreshCw,
  Edit3,
  Loader2,
  Lock as LockIcon,
  Send,
} from "lucide-react";

type OrderItem = {
  id: number | string;
  variant_id: number;
  quantity: number;
  unit_price: number;
  variant_title: string | null;
  variant_sku: string | null;
  variant_compare_price?: number | null;
  weight_grams?: number | null;
  weight_recorded?: boolean;
  product_title: string | null;
};

type ReceiverPerformance = {
  checkedAt?: string;
  grade?: string | null;
  totals?: {
    total?: number;
    delivered?: number;
    rts?: number;
    undelivered?: number;
    inProgress?: number;
  };
};

type PaymentDetails = {
  provider_transaction_id: string | null;
  reference_id: string;
  channel_code: string;
  status: string;
  amount: number;
  admin_fee: number;
  total_amount: number;
  expires_at: string | null;
  paid_at: string | null;
  failed_reason: string | null;
};

type Order = {
  id: number | string;
  order_number: string;
  warehouse_id: number | null;
  warehouse_name: string | null;
  customer_name: string;
  customer_phone: string;
  address: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  postal_code: string | null;
  destination_area_id: string | null;
  total_amount: number;
  shipping_cost: number;
  discount_amount?: number;
  cod_service_fee: number;
  cod_service_fee_vat: number;
  cod_fee_bearer: "buyer" | "seller";
  payment_method: string;
  /** Set when an operator moved this order off COD (src/lib/payment-switch.ts). */
  payment_switched_from?: string | null;
  payment_switched_at?: string | null;
  payment_switched_by?: string | null;
  /** COD only: whether it can still move to transfer/VA, and the total then. */
  payment_switch?: { available: boolean; reason: string | null; total_amount: number } | null;
  /** The buyer's /payment page for an unpaid prepaid order (fragment locator). */
  payment_link?: string | null;
  /** Follow-up context served with the order (templates, store, accounts, buyer links). */
  crm?: {
    templates?: Record<string, string>;
    seller_name?: string;
    bank_accounts?: string;
    epayment_link?: string | null;
    order_details_link?: string | null;
  };
  payment_status: string;
  shipping_status: string;
  /** Set once the order is void; see `isVoidOrder`. */
  stock_restored_at?: string | null;
  confirmed_at: string | null;
  courier_code: string | null;
  courier_service: string | null;
  cnote_no: string | null;
  provider_order_id: string | null;
  provider_dispatch_error: string | null;
  dispatchEligible?: boolean;
  dispatchReason?: string | null;
  receiver_delivery_rate: number | null;
  receiver_risk_label: string | null;
  receiver_performance: ReceiverPerformance | null;
  /** "not-whitelisted" when Mengantar refused the lookup for this account. */
  receiver_performance_unavailable?: string | null;
  receiver_performance_checked_at: string | null;
  ad_click_ids?: string | null;
  source_page_path?: string | null;
  created_at: string;
  kelola?: KelolaSync | null;
  payment: PaymentDetails | null;
  items: OrderItem[];
};

type KelolaSync = {
  configured: boolean;
  synced_at: string | null;
  attempts: number;
  last_error: string | null;
  voided: boolean;
};

type LocationOption = {
  id: string;
  label: string;
  district: string;
  subdistrict_name?: string;
  city: string;
  province: string;
  postal_code?: string;
};

type ShippingRate = {
  courier_service_id: number;
  courier_code: string;
  courier_service: string;
  shipping_cost: number;
  estimated_days?: string;
};

const shippingLabels = SHIPPING_STATUS_LABELS;

const shippingStatusBadges: Record<string, string> = {
  abandoned: "bg-rose-50 text-rose-900 border-rose-200",
  pending: "bg-amber-50 text-amber-900 border-amber-200",
  processing: "bg-sky-50 text-sky-900 border-sky-200",
  shipped: "bg-blue-50 text-blue-900 border-blue-200",
  delivered: "bg-emerald-50 text-emerald-900 border-emerald-200",
  returned: "bg-rose-100 text-rose-950 border-rose-300",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

const shippingStatusDots: Record<string, string> = {
  abandoned: "bg-rose-500",
  pending: "bg-amber-500",
  processing: "bg-sky-500",
  shipped: "bg-blue-500",
  delivered: "bg-emerald-500",
  returned: "bg-rose-600",
  cancelled: "bg-slate-400",
};

const paymentLabels: Record<string, string> = {
  unpaid: "Belum dibayar",
  pending: "Menunggu pembayaran",
  paid: "Lunas",
  settled: "Lunas",
  success: "Lunas",
  expired: "Kedaluwarsa",
  failed: "Gagal",
  refunded: "Dikembalikan",
};

const paymentMethodLabels: Record<string, string> = {
  cod: "COD",
  manual_transfer: "Transfer bank manual",
  bank_transfer: "Virtual Account",
  qris: "QRIS",
  invoice: "Pembayaran online",
};

const currency = formatIdr;

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date)} WIB`;
};

function EditCustomerDialog({
  order,
  onUpdated,
}: {
  order: Order;
  onUpdated: (order: Order) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!order.provider_order_id && new URLSearchParams(window.location.search).get("edit") === "shipping") {
      setOpen(true);
    }
  }, [order.provider_order_id]);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [useSubdistrict] = useState(false);
  const [selectedCourierServiceId, setSelectedCourierServiceId] = useState("");
  const [formData, setFormData] = useState({
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || "",
    address: order.address || "",
    district: order.district || "",
    city: order.city || "",
    province: order.province || "",
    postal_code: order.postal_code || "",
    destination_area_id: order.destination_area_id || "",
  });

  useEffect(() => {
    setFormData({
      customer_name: order.customer_name || "",
      customer_phone: order.customer_phone || "",
      address: order.address || "",
      district: order.district || "",
      city: order.city || "",
      province: order.province || "",
      postal_code: order.postal_code || "",
      destination_area_id: order.destination_area_id || "",
    });
    setShowValidation(false);
  }, [order, open]);

  useEffect(() => {
    if (submitError) submitErrorRef.current?.focus();
  }, [submitError]);

  const customerEditable = !order.provider_order_id;
  const courierEditable =
    customerEditable &&
    order.payment_method === "cod" &&
    order.shipping_status === "pending";
  const locationEditable = courierEditable;
  const firstItem = order.items?.[0];

  // The combobox shows labels; saving needs the full row behind one.
  const locationRows = useRef(new Map<string, LocationOption>());
  const searchLocations = useCallback(
    async (query: string, signal: AbortSignal): Promise<DistrictOption[]> => {
      const response = await fetch(`/api/locations?search=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" }, signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || "Gagal mencari kecamatan");
      const items = ((payload.items && payload.items.length ? payload.items : payload.alternatives) || payload.locations || []) as LocationOption[];
      const rows = useSubdistrict ? items : groupLocationResults(items).map((group) => group.items[0]);
      for (const row of rows) locationRows.current.set(String(row.id), row);
      return rows.map((row) => ({ id: String(row.id), label: row.label, detail: [row.district, row.city, row.province].filter(Boolean).join(", ") }));
    },
    [useSubdistrict],
  );

  useEffect(() => {
    if (
      !open ||
      !courierEditable ||
      !formData.destination_area_id ||
      !firstItem
    ) {
      setShippingRates([]);
      setSelectedCourierServiceId("");
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      destination_id: formData.destination_area_id,
      payment_method: order.payment_method || "cod",
      quantity: String(firstItem?.quantity || 1),
    });
    // The weight recorded on the order line, not the variant's current one:
    // the save re-quotes and dispatch ships at this weight (A-397). Sent in kg,
    // which the rate route reads as kg up to 100 kg a unit.
    // lazy: a unit over 100 kg would be read as grams; the save caps variants
    // at 50 kg (A-398). Upgrade path: an explicit unit on the rate route.
    const unitWeightKg = quoteUnitWeightKg(firstItem.weight_grams);
    if (unitWeightKg === null) params.set("variant_id", String(firstItem.variant_id || 1));
    else params.set("weight", String(unitWeightKg));
    // The same warehouse the save re-quotes from (PRD A42, REQ-241): the
    // order's own while it is active, else the one chosen by province.
    if (order.warehouse_id) params.set("warehouse_id", String(order.warehouse_id));
    if (formData.province) params.set("province", formData.province);
    setRatesLoading(true);
    void fetch(`/api/shipping-rates?${params}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Tarif pengiriman gagal dimuat.");
        }
        const rates = ((payload.items || payload.rates || []) as ShippingRate[]);
        setShippingRates(rates);
        const current = rates.find(
          (rate) =>
            rate.courier_code === order.courier_code &&
            rate.courier_service === order.courier_service
        );
        setSelectedCourierServiceId(
          current ? String(current.courier_service_id) : ""
        );
      })
      .catch((reason) => {
        if (!(reason instanceof Error && reason.name === "AbortError")) {
          setShippingRates([]);
          setSelectedCourierServiceId("");
          toast.error(
            reason instanceof Error
              ? reason.message
              : "Tarif pengiriman gagal dimuat."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRatesLoading(false);
      });
    return () => controller.abort();
  }, [
    firstItem,
    formData.destination_area_id,
    formData.province,
    open,
    order.warehouse_id,
    order.courier_code,
    order.courier_service,
    courierEditable,
  ]);

  const selectedRate = shippingRates.find(
    (rate) => String(rate.courier_service_id) === selectedCourierServiceId
  );
  const editableFields = [
    "customer_name",
    "customer_phone",
    "address",
    "district",
    "city",
    "province",
    "postal_code",
    "destination_area_id",
  ] as const;
  const customerDirty = editableFields.some(
    (field) => formData[field].trim() !== String(order[field] || "").trim(),
  );
  const isFieldDirty = (field: (typeof editableFields)[number]) =>
    formData[field].trim() !== String(order[field] || "").trim();
  const fieldErrors = {
    customer_name:
      isFieldDirty("customer_name") && formData.customer_name.trim().length < 2
        ? "Nama minimal 2 karakter."
        : "",
    customer_phone:
      isFieldDirty("customer_phone") &&
      !/^(08|628)\d{8,11}$/.test(formData.customer_phone.replace(/[^\d]/g, ""))
        ? "Nomor HP harus berisi 10–13 digit, misalnya 081234567890."
        : "",
    address:
      isFieldDirty("address") && formData.address.trim().length < 10
        ? "Alamat lengkap minimal 10 karakter."
        : "",
    district:
      isFieldDirty("district") && formData.district.trim().length < 2
        ? "Pilih kecamatan dari hasil pencarian."
        : "",
    city:
      isFieldDirty("city") && formData.city.trim().length < 2
        ? "Kota/kabupaten belum valid."
        : "",
    province:
      isFieldDirty("province") && formData.province.trim().length < 2
        ? "Provinsi belum valid."
        : "",
    postal_code:
      isFieldDirty("postal_code") &&
      Boolean(formData.postal_code) &&
      !/^\d{5}$/.test(formData.postal_code)
        ? "Kode pos harus 5 digit."
        : "",
    destination_area_id: "",
  } satisfies Record<(typeof editableFields)[number], string>;
  const selectedRateChanged = Boolean(
    courierEditable &&
    selectedRate &&
    (selectedRate.courier_code !== order.courier_code ||
      selectedRate.courier_service !== order.courier_service ||
      formData.destination_area_id !== String(order.destination_area_id || "")),
  );
  const locationChanged =
    formData.destination_area_id.trim() !==
    String(order.destination_area_id || "").trim();
  const rateRequired = courierEditable && locationChanged && !selectedRate;
  const formValid =
    !Object.values(fieldErrors).some(Boolean) &&
    !rateRequired;

  const handleSubmit = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>
  ) => {
    event.preventDefault();
    setShowValidation(true);
    if (!customerEditable || (!customerDirty && !selectedRateChanged)) return;
    if (!formValid) {
      window.requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-validation-error="true"]')
          ?.focus();
      });
      return;
    }
    setLoading(true);
    setSubmitError("");
    try {
      const customerPayload = Object.fromEntries(
        editableFields
          .filter((field) => formData[field].trim() !== String(order[field] || "").trim())
          .map((field) => [field, formData[field].trim()]),
      );
      const shippingPayload =
        selectedRateChanged && selectedRate
          ? {
              destination_area_id: formData.destination_area_id,
              courier_code: selectedRate.courier_code,
              courier_service_id: selectedRate.courier_service_id,
            }
          : {};
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(String(order.id))}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...customerPayload, ...shippingPayload }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Gagal menyimpan data.");
      }
      onUpdated({ ...order, ...payload.data });
      setOpen(false);
      toast.success("Data pembeli dan pengiriman berhasil diperbarui.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
    {!customerEditable && (
      <span className="hidden items-center gap-1 text-xs text-slate-500 lg:inline-flex">
        <LockIcon className="size-3.5" aria-hidden="true" /> Terkunci, shipment sudah dibuat
      </span>
    )}
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!loading) {
        setSubmitError("");
        setOpen(nextOpen);
      }
    }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={!customerEditable}
          title={!customerEditable ? "Data terkunci karena shipment Mengantar sudah dibuat." : undefined}
        >
          <Edit3 aria-hidden="true" />
          Edit pembeli & alamat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto p-0 sm:max-w-4xl rounded-xl">
        <DialogHeader className="border-b border-slate-100 px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold text-slate-900">
            Edit Pembeli & Pengiriman
          </DialogTitle>
          <DialogDescription className="text-xs">
            Data pembeli dapat diperbarui sebelum shipment dibuat. Kurir hanya dapat diganti untuk order COD yang masih menunggu.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-6 px-6 py-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          {/* Two columns: what the operator edits on the left, what it costs
              and the save action on the right, where they stay in view. */}
          <div className="min-w-0 space-y-4">
          {submitError && (
            <div ref={submitErrorRef} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800" role="alert" tabIndex={-1}>
              {submitError}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>Nama Lengkap</span>
              <Input
                id="edit-customer-name"
                name="customer_name"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                autoComplete="name"
                maxLength={100}
                aria-invalid={showValidation && Boolean(fieldErrors.customer_name)}
                aria-describedby={fieldErrors.customer_name ? "edit-customer-name-error" : undefined}
                className="font-semibold"
              />
              {showValidation && fieldErrors.customer_name && (
                <span id="edit-customer-name-error" className="block text-xs font-semibold text-rose-700">
                  {fieldErrors.customer_name}
                </span>
              )}
            </label>
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>Nomor WhatsApp / HP</span>
              <Input
                id="edit-customer-phone"
                name="customer_phone"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={40}
                aria-invalid={showValidation && Boolean(fieldErrors.customer_phone)}
                aria-describedby={fieldErrors.customer_phone ? "edit-customer-phone-error" : undefined}
                className="font-semibold font-mono"
              />
              {showValidation && fieldErrors.customer_phone && (
                <span id="edit-customer-phone-error" className="block text-xs font-semibold text-rose-700">
                  {fieldErrors.customer_phone}
                </span>
              )}
            </label>
          </div>

          <label className="block space-y-1 text-xs font-semibold text-slate-700">
            <span>Alamat Jalan / Rumah</span>
            <Textarea
              id="edit-customer-address"
              name="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              autoComplete="street-address"
              maxLength={500}
              aria-invalid={showValidation && Boolean(fieldErrors.address)}
              aria-describedby={fieldErrors.address ? "edit-customer-address-error" : undefined}
              rows={2}
              className="resize-y"
              placeholder="Contoh: Jl. Merdeka No. 12 RT 01/02"
            />
            {showValidation && fieldErrors.address && (
              <span id="edit-customer-address-error" className="block text-xs font-semibold text-rose-700">
                {fieldErrors.address}
              </span>
            )}
          </label>

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <div className="space-y-1.5">
              <label htmlFor="edit-customer-location-search" className="text-sm font-medium text-slate-700">Kecamatan tujuan</label>
              <DistrictCombobox
                id="edit-customer-location-search"
                minChars={2}
                disabled={!locationEditable}
                placeholder="Ketik minimal 2 huruf, misalnya Kebayoran Baru"
                value={formData.destination_area_id ? { id: formData.destination_area_id, label: [formData.district, formData.city].filter(Boolean).join(", ") } : null}
                onChange={(option) => {
                  const loc = option ? locationRows.current.get(option.id) : undefined;
                  if (!loc) return;
                  setFormData({
                    ...formData,
                    district: loc.district || "",
                    city: loc.city || "",
                    province: loc.province || "",
                    postal_code: loc.postal_code || formData.postal_code || "",
                    destination_area_id: String(loc.id || (loc as any).location_id || "").trim(),
                  });
                }}
                search={searchLocations}
              />
            </div>

            <p className="text-xs text-slate-500">
              {formData.district
                ? [formData.district, formData.city, formData.province, formData.postal_code].filter(Boolean).join(", ")
                : "Belum ada kecamatan tujuan."}
            </p>
          </div>

          {/* Opsi Kurir & Biaya Pengiriman (Ongkir) */}
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Truck className="size-4 text-emerald-600" />
                <span>Pilih Kurir & Biaya Pengiriman (Ongkir)</span>
              </span>
              {ratesLoading && (
                <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1 animate-pulse">
                  <Loader2 className="size-3 animate-spin" /> Memuat tarif...
                </span>
              )}
            </div>

            {ratesLoading ? (
              <div className="space-y-2">
                <div className="h-12 w-full rounded-xl bg-slate-100 animate-pulse border border-slate-200" />
                <div className="h-12 w-full rounded-xl bg-slate-100 animate-pulse border border-slate-200" />
              </div>
            ) : shippingRates.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Pilihan kurir dan ongkir">
                {shippingRates.map((rate) => {
                  const isSelected = String(rate.courier_service_id) === selectedCourierServiceId;
                  return (
                    <button
                      key={rate.courier_service_id}
                      type="button"
                      onClick={() => setSelectedCourierServiceId(String(rate.courier_service_id))}
                      role="radio"
                      aria-checked={isSelected}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border p-2.5 text-left transition-colors",
                        isSelected
                          ? "border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600/30 shadow-xs"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "size-4 rounded-full border flex items-center justify-center transition-colors shrink-0",
                            isSelected ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white"
                          )}
                        >
                          {isSelected && <Check className="size-2.5 text-white stroke-[3]" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              {courierServiceLabel(rate.courier_code, rate.courier_service)}
                            </span>
                          </div>
                          {etaLabel(rate.estimated_days ?? "") && (
                            <span className="mt-0.5 block text-xs text-slate-500">{etaLabel(rate.estimated_days ?? "")}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-semibold text-xs text-emerald-700">
                          {currency(rate.shipping_cost)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : !courierEditable ? (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <span className="font-semibold block text-slate-800">Biaya Ongkir Terkunci</span>
                <span>
                  Layanan pengiriman & ongkir saat ini:{" "}
                  <strong className="text-slate-900">
                    {order.courier_code ? courierServiceLabel(order.courier_code, order.courier_service) : "Belum ditentukan"}
                  </strong>{" "}
                  ({currency(order.shipping_cost || 0)})
                </span>
              </div>
            ) : formData.destination_area_id ? (
              <p className="text-xs text-amber-700 font-semibold bg-amber-50 p-3 rounded-xl border border-amber-200">
                Tidak ada pilihan kurir otomatis yang tersedia untuk lokasi ini ({formData.district || formData.destination_area_id}). Silakan ketik dan pilih ulang kecamatan dari menu pencarian di atas.
              </p>
            ) : (
              <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200 font-medium">
                Cari & pilih kecamatan pada kolom pencarian di atas untuk menampilkan opsi kurir & biaya pengiriman.
              </p>
            )}
            {showValidation && rateRequired && (
              <p
                tabIndex={-1}
                data-validation-error="true"
                className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800"
                role="alert"
              >
                Pilih layanan kurir untuk lokasi COD yang baru sebelum menyimpan.
              </p>
            )}
          </div>

          </div>
          <aside className="space-y-3 md:sticky md:top-0 md:self-start">
          {/* Ringkasan Real-Time Total Order (Preview) */}
          {(() => {
            const itemTotal =
              (order.items || []).reduce(
                (acc, item) => acc + Number(item.unit_price || 0) * Number(item.quantity || 1),
                0
              ) || Math.max(0, Number(order.total_amount || 0) - Number(order.shipping_cost || 0));
            const newShippingCost = selectedRate
              ? Number(selectedRate.shipping_cost || 0)
              : Number(order.shipping_cost || 0);
            const discount = Number(order.discount_amount || 0);
            const orderAmount = Math.max(0, itemTotal - discount + newShippingCost);
            const codFee = order.payment_method === "cod"
              ? calculateCodFeeBreakdown(orderAmount)
              : null;
            const newTotalAmount = order.payment_method === "cod"
              ? calculateCodCustomerTotal(orderAmount, order.cod_fee_bearer)
              : orderAmount;
            return (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-1.5 text-xs">
                <span className="block text-sm font-semibold text-slate-900">Total setelah disimpan</span>
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal Produk</span>
                  <span className="font-semibold text-slate-900">{currency(itemTotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Ongkir</span>
                  <span className="font-semibold text-emerald-700">{currency(newShippingCost)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Diskon</span>
                    <span className="font-semibold text-slate-900">−{currency(discount)}</span>
                  </div>
                )}
                {codFee && order.cod_fee_bearer === "buyer" && (
                  <div className="flex justify-between text-slate-600">
                    <span>Fee COD + PPN</span>
                    <span className="font-semibold text-slate-900">{currency(codFee.totalFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-sm text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Total tagihan</span>
                  <span className="text-emerald-700">{currency(newTotalAmount)}</span>
                </div>
              </div>
            );
          })()}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="w-full"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={loading || (!customerDirty && !selectedRateChanged)}
              className="w-full"
            >
              {loading ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
          </aside>
        </form>
      </DialogContent>
    </Dialog>
    </div>
  );
}

export function OrderDetail({
  invoice,
  mayReleaseDispatch = false,
}: {
  invoice: string;
  // Owner and admin only; the API refuses anyone else (403).
  mayReleaseDispatch?: boolean;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const pushAccepted = useRef(false);
  const [notice, setNotice] = useState("");
  const [copiedTarget, setCopiedTarget] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    void fetch(`/api/admin/orders/${encodeURIComponent(invoice)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) throw new Error(payload.error || "Detail order tidak ditemukan.");
        return payload.data as Order;
      })
      .then((data) => {
        setOrder(data);
      })
      .catch((reason) => {
        if (!(reason instanceof Error && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Detail order gagal dimuat.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [invoice, reloadKey]);

  const allCrmMessages = useMemo<Record<string, string>>(() => {
    if (!order) return {};
    const crm = order.crm;
    const safePhone = String(order.customer_phone || "").trim();
    const items = Array.isArray(order.items) ? order.items : [];
    const messages: Record<string, string> = {};
    for (const step of CRM_STEPS) {
      messages[step.key] = renderCrmMessage(crm?.templates?.[step.key] || defaultCrmTemplates[step.key] || "", {
        customerName: order.customer_name || "Pelanggan",
        customerPhone: safePhone,
        address: order.address || undefined,
        district: order.district || "",
        city: order.city || undefined,
        province: order.province || "",
        postalCode: order.postal_code || undefined,
        orderNumber: order.order_number,
        productName:
          items
            .map((item) => item.product_title || item.variant_title)
            .filter(Boolean)
            .join(", ") || "Produk",
        items: items.map((item) => ({
          productName: item.product_title || item.variant_title,
          variantName: item.variant_title,
          quantity: item.quantity || 1,
          unitPrice: item.unit_price || 0,
          comparePrice: item.variant_compare_price ?? null,
        })),
        productPrice: items.reduce(
          (total, item) =>
            total + (item.quantity || 1) * (item.unit_price || 0),
          0,
        ),
        shippingCost: order.shipping_cost || 0,
        totalAmount: order.total_amount || 0,
        courierCode: order.courier_code || "",
        cnoteNo: order.cnote_no || undefined,
        sellerName: crm?.seller_name || "",
        bankAccounts: crm?.bank_accounts || "",
        epaymentLink: crm?.epayment_link || "",
        orderDetailsLink: crm?.order_details_link || "",
      });
    }
    return messages;
  }, [order]);

  const allCrmUrls = useMemo<Record<string, string>>(() => {
    if (!order) return {};
    const safePhone = String(order.customer_phone || "").trim();
    return Object.fromEntries(
      CRM_STEPS.map((step) => [
        step.key,
        buildWaUrl(safePhone, allCrmMessages[step.key] || ""),
      ]),
    );
  }, [allCrmMessages, order]);

  const copyToClipboard = async (
    text: string,
    target: string,
    label: string,
  ) => {
    if (!text.trim()) {
      toast.error(`${label} belum tersedia.`);
      return;
    }
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API tidak tersedia");
      }
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      toast.success(`${label} berhasil disalin.`);
      window.setTimeout(
        () =>
          setCopiedTarget((current) => (current === target ? "" : current)),
        2000,
      );
    } catch {
      toast.error(`${label} gagal disalin. Periksa izin clipboard browser.`);
    }
  };

  const updateStatus = async (shippingStatus: string) => {
    if (!order) return;
    const previous = order.shipping_status;
    setOrder({ ...order, shipping_status: shippingStatus });
    setSaving(true);
    setNotice("Menyimpan status pengiriman…");
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(String(order.id))}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipping_status: shippingStatus }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Status pengiriman gagal diperbarui.");
      }
      setNotice(payload.message || "Status pengiriman berhasil diperbarui.");
      toast.success("Status pengiriman berhasil diperbarui.");
    } catch (reason) {
      setOrder((current) => (current ? { ...current, shipping_status: previous } : current));
      const msg = reason instanceof Error ? reason.message : "Status pengiriman gagal diperbarui.";
      setNotice(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // A manual transfer lands in the seller's own account, so the operator is the
  // only one who can confirm it. Marking it paid also sends the order's Meta
  // Purchase from the server: the buyer left /thanks long before.
  const confirmManualTransfer = async () => {
    if (!order) return;
    if (
      !(await confirm({
        title: `Transfer ${order.order_number} sudah masuk?`,
        description: `Pastikan ${currency(order.total_amount || 0)} sudah diterima di rekening toko. Order ditandai lunas dan Purchase dikirim ke Meta.`,
        confirmLabel: "Ya, transfer diterima",
        tone: "default",
      }))
    ) {
      return;
    }
    setSaving(true);
    setNotice("Menyimpan konfirmasi transfer…");
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(String(order.id))}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_status: "paid" }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Konfirmasi transfer gagal disimpan.");
      }
      // A paid order has nothing left to pay: the FU chips must stop sending
      // the payment link, as the server stops issuing one (buyerPaymentPath).
      setOrder((current) =>
        current
          ? { ...current, ...payload.data, crm: current.crm && { ...current.crm, epayment_link: null } }
          : current,
      );
      setNotice(payload.message || "Transfer dikonfirmasi.");
      toast.success(payload.message || "Transfer dikonfirmasi.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Konfirmasi transfer gagal disimpan.";
      setNotice(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  // The push opens the dialog first: drop-off or a scheduled pickup (PRD A46).
  const pushToMengantar = () => {
    if (order) setPushOpen(true);
  };
  const submitPush = async (pickup: MengantarPickupChoice) => {
    if (!order) throw new Error("Order belum dimuat.");
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(String(order.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dispatch-order", pickup }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Order gagal dikirim ke Mengantar.");
      }
      setOrder((current) => (current ? { ...current, ...payload.data } : current));
      pushAccepted.current = true;
      const message = payload.message || "Shipment diterima Mengantar.";
      setNotice(message);
      return {
        message,
        results: [{ orderId: order.id, status: payload.data?.dispatch_status || "dispatched", cnoteNo: payload.data?.cnote_no || undefined }],
      };
    } finally {
      setSaving(false);
    }
  };
  const closePush = (open: boolean) => {
    if (open) return;
    setPushOpen(false);
    if (pushAccepted.current && order) window.location.assign(`/admin/shipping?order=${encodeURIComponent(order.order_number)}`);
  };

  const linkAcceptedDispatch = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(String(order.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link-accepted-dispatch" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || "Gagal menautkan paket Mengantar.");
      toast.success(payload.message || "Paket Mengantar ditautkan.");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Gagal menautkan paket Mengantar.");
    } finally {
      setSaving(false);
    }
  };
  const releaseUnknownDispatch = async () => {
    if (!order) return;
    if (!(await confirm({
      title: "Izinkan push ulang?",
      description: `Pastikan ${order.order_number} tidak ada di dashboard Mengantar. Kalau ternyata sudah ada, push ulang membuat paket kedua.`,
      confirmLabel: "Sudah dicek, izinkan",
    }))) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(String(order.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release-dispatch-unknown" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || "Gagal mengizinkan push ulang.");
      toast.success(payload.message || "Order boleh di-push ulang.");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Gagal mengizinkan push ulang.");
    } finally {
      setSaving(false);
    }
  };

  const deleteOrder = async () => {
    if (!order) return;
    if (!(await confirm({ title: `Hapus pesanan ${order.order_number}?`, description: "Pesanan terhapus permanen dan tidak dapat dikembalikan.", confirmLabel: "Hapus pesanan" }))) {
      return;
    }
    setSaving(true);
    setNotice("Menghapus order…");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(String(order.id))}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Gagal menghapus order.");
      }
      toast.success(`Order ${order.order_number} berhasil dihapus.`);
      window.location.assign("/admin/orders");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Gagal menghapus order.";
      setNotice(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };
  const refreshRtsScoring = async () => {
    if (!order) return;
    setSaving(true);
    setNotice("Memeriksa risiko RTS dari Mengantar…");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(String(order.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh-scoring" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
        data?: Partial<typeof order>;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Gagal memperbarui risiko RTS dari Mengantar.");
      }
      toast.success(payload.message || "Risiko RTS berhasil diperbarui dari Mengantar.");
      setNotice(payload.message || "");
      if (payload.data) {
        setOrder((prev) => (prev ? { ...prev, ...payload.data } : prev));
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Gagal memperbarui risiko RTS.";
      setNotice(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const [kelolaPending, setKelolaPending] = useState(false);
  const pushToKelola = async () => {
    if (!order) return;
    setKelolaPending(true);
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(String(order.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push-kelola" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
        data?: { kelola?: KelolaSync };
      };
      if (payload.data?.kelola) {
        const kelola = payload.data.kelola;
        setOrder((prev) => (prev ? { ...prev, kelola } : prev));
      }
      if (!response.ok || !payload.success) throw new Error(payload.error || "Gagal mengirim order ke Kelola.");
      toast.success(payload.message || "Order terkirim ke Kelola.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Gagal mengirim order ke Kelola.");
    } finally {
      setKelolaPending(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-xl bg-slate-200/70" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-48 animate-pulse rounded-xl bg-slate-200/70" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-200/70" />
          </div>
          <div className="space-y-6">
            <div className="h-40 animate-pulse rounded-xl bg-slate-200/70" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-200/70" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <section className="rounded-xl border border-rose-200 bg-white p-8 text-center shadow-sm max-w-xl mx-auto my-12" role="alert">
        <ShieldAlert className="size-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-xl font-semibold text-slate-950">Detail Order Tidak Ditemukan</h2>
        <p className="mt-2 text-xs font-semibold text-slate-600">{error || "Sistem tidak dapat menemukan record invoice ini."}</p>
        <a href="/admin/orders" className={buttonVariants({ className: "mt-6" })}>
          <ArrowLeft className="size-4" />
          Kembali ke Daftar Order
        </a>
      </section>
    );
  }

  const safePhone = String(order.customer_phone || "").trim();
  const waNumber = safePhone.replace(/\D/g, "").replace(/^0/, "62");
  const riskValue = String(order.receiver_risk_label || "").toUpperCase();
  const risk = riskValue.includes("HIGH")
    ? { label: "Risiko tinggi", style: "bg-rose-50 text-rose-800 border-rose-200", dot: "bg-rose-500" }
    : riskValue.includes("MEDIUM")
    ? { label: "Risiko sedang", style: "bg-amber-50 text-amber-900 border-amber-200", dot: "bg-amber-500" }
    : riskValue.includes("LOW")
    ? { label: "Risiko rendah", style: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" }
    : { label: "Belum dinilai", style: "bg-slate-50 text-slate-700 border-slate-200", dot: "bg-slate-400" };

  const paymentStatus = String(order.payment_status || "unpaid").toLowerCase();
  const paymentPaid = ["paid", "settled", "success"].includes(paymentStatus);
  const paymentFailed = ["failed", "expired"].includes(paymentStatus);
  const paymentRefunded = paymentStatus === "refunded";

  const paymentDotColor = paymentPaid
    ? "bg-emerald-500"
    : paymentFailed
      ? "bg-rose-500"
      : paymentRefunded
        ? "bg-purple-500"
        : "bg-amber-500";

  const paymentStatusStyle = paymentPaid
    ? "bg-emerald-50 text-emerald-900 border-emerald-200"
    : paymentFailed
      ? "bg-rose-50 text-rose-900 border-rose-200"
      : paymentRefunded
        ? "bg-purple-50 text-purple-900 border-purple-200"
        : "bg-amber-50 text-amber-900 border-amber-200";

  const paymentReady =
    order.payment_method === "cod" ||
    ["paid", "settled", "success"].includes(order.payment_status);

  const shippingDataComplete = Boolean(
    order.address &&
      order.address.trim().length >= 10 &&
      order.district &&
      order.city &&
      order.province &&
      order.destination_area_id &&
      order.courier_code &&
      order.courier_service &&
      order.warehouse_id
  );

  const canConfirm =
    order.shipping_status === "pending" &&
    paymentReady &&
    shippingDataComplete &&
    !order.provider_order_id;

  const statusOptions =
    order.shipping_status === "pending"
      ? ["pending", "cancelled"]
      : order.shipping_status === "cancelled"
      ? ["cancelled"]
      : ["processing", "shipped", "delivered", "returned", "cancelled"];

  const items = Array.isArray(order.items) ? order.items : [];
  const weight = summarizeOrderWeight(items);
  const formattedAddress = [
    order.address,
    order.district,
    order.city,
    order.province,
    order.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  const deliveryTotals = order.receiver_performance?.totals;

  return (
    <div className="space-y-6 pb-16">
      {confirmDialog}
      <MengantarPushDialog
        open={pushOpen}
        onOpenChange={closePush}
        orderLabels={[{ id: order.id, label: order.order_number }]}
        submit={submitPush}
      />
      {/* Top Navigation & Action Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <a
            href="/admin/orders"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Kembali ke daftar order</span>
          </a>

          <div className="flex items-center gap-2">
            <EditCustomerDialog order={order} onUpdated={setOrder} />

            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteOrder()}
              disabled={saving}
            >
              <Trash2 aria-hidden="true" />
              Hapus
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`gap-1.5 text-xs font-medium ${paymentStatusStyle}`}>
                <span className={`size-1.5 shrink-0 rounded-full ${paymentDotColor}`} aria-hidden="true" />
                {paymentLabels[paymentStatus] || order.payment_status}
              </Badge>
              <Badge variant="outline" className={`gap-1.5 text-xs font-medium ${shippingStatusBadges[order.shipping_status] || "bg-slate-100 text-slate-800"}`}>
                <span className={`size-1.5 shrink-0 rounded-full ${shippingStatusDots[order.shipping_status] || "bg-slate-400"}`} aria-hidden="true" />
                {shippingLabels[order.shipping_status] || order.shipping_status}
              </Badge>
              <Badge variant="outline" className={`gap-1.5 text-xs font-medium ${risk.style}`}>
                <span className={`size-1.5 shrink-0 rounded-full ${risk.dot}`} aria-hidden="true" />
                {risk.label}
              </Badge>
              <TrafficSourceBadge adClickIds={order.ad_click_ids} />
              {order.source_page_path && (
                <Badge variant="outline" className="max-w-full gap-1.5 truncate border-violet-200 bg-violet-50 text-xs font-medium text-violet-700" title={order.source_page_path}>
                  <span className="size-1.5 shrink-0 rounded-full bg-current opacity-80" aria-hidden="true" />
                  {order.source_page_path}
                </Badge>
              )}
            </div>

            <div className="mt-2 flex items-center gap-3">
              <h2 className="font-mono text-xl font-semibold tracking-tight text-slate-950 md:text-2xl">
                {order.order_number}
              </h2>
              <button
                type="button"
                onClick={() =>
                  void copyToClipboard(
                    order.order_number,
                    "invoice",
                    "Nomor order",
                  )
                }
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md transition-colors"
                title="Salin nomor order"
              >
                {copiedTarget === "invoice" ? (
                  <Check className="size-3.5 text-emerald-600" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                <span>{copiedTarget === "invoice" ? "Tersalin" : "Salin"}</span>
              </button>
            </div>

            <p className="mt-1 text-xs text-slate-500">
              Dibuat pada {formatDate(order.created_at)} · ID Internal <span className="font-mono font-semibold">{order.id}</span>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">Status</span>
              <div className="w-52">
                <FilterSelect
                  id="order-shipping-status"
                  ariaLabel="Status pengiriman"
                  icon={Truck}
                  value={order.shipping_status}
                  onValueChange={(value) => void updateStatus(value)}
                  disabled={saving}
                  options={statusOptions.map((value) => ({ value, label: shippingLabels[value] || value }))}
                />
              </div>
            </div>

            {safePhone && (
              <a
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9.5 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
              >
                <Phone className="size-3.5" />
                <span>Chat WhatsApp</span>
              </a>
            )}
          </div>
        </div>

        {notice && (
          <div className="mt-3 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-700 flex items-center justify-between">
            <span>{notice}</span>
            {saving && <RefreshCw className="size-3.5 animate-spin text-slate-500" />}
          </div>
        )}
      </section>

      {/* Main Grid: Left Column (Details) + Right Column (Summary & Actions) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Customer, Address & Products */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Address Card */}
          <Card className="rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-4 sm:px-6">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <MapPin className="size-4 text-slate-600" />
                <span>Pembeli & alamat</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs text-slate-500">Nama Lengkap</span>
                  <p className="mt-1 text-base font-semibold text-slate-950">{order.customer_name || "—"}</p>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">Nomor HP / WhatsApp</span>
                  <p className="mt-1 font-mono text-sm font-semibold text-slate-950">{safePhone || "—"}</p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="block text-xs text-slate-500">
                    Alamat Jalan
                  </span>
                  <button
                    type="button"
                    disabled={!formattedAddress}
                    onClick={() =>
                      void copyToClipboard(
                        formattedAddress,
                        "address",
                        "Alamat pelanggan",
                      )
                    }
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Salin alamat lengkap pelanggan"
                  >
                    {copiedTarget === "address" ? (
                      <Check className="size-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copiedTarget === "address" ? "Tersalin" : "Salin alamat"}
                  </button>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-800 leading-relaxed">
                  {order.address || "Alamat jalan belum diisi"}
                </p>
                <p className="mt-1 text-xs text-slate-500 font-medium">
                  {[order.district, order.city, order.province].filter(Boolean).join(", ")} {order.postal_code || ""}
                </p>
                {order.destination_area_id && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-mono text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
                    <span>ID Area Mengantar:</span>
                    <strong className="font-semibold text-slate-800">{order.destination_area_id}</strong>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Ordered Products Card */}
          <Card className="rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-4 sm:px-6 flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Package className="size-4 text-slate-600" />
                <span>Produk</span>
              </CardTitle>
              <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {items.length} item
              </span>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-100">
              {items.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 font-semibold">
                  Rincian item produk belum tersedia.
                </div>
              ) : (
                items.map((item, index) => {
                  const itemWeight = weight.items[index];
                  return (
                  <div key={item.id} className="p-4 sm:p-5 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-slate-950 truncate">
                        {item.product_title || "Produk"}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 font-medium">
                        {item.variant_title || "Standard"}
                        {item.variant_sku ? ` · SKU: ${item.variant_sku}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Berat:{" "}
                        {itemWeight?.unit != null && itemWeight.line != null ? (
                          <>
                            {item.quantity > 1 ? `${item.quantity} x ${formatGrams(itemWeight.unit)} = ` : ""}
                            <span className="font-semibold text-slate-700">
                              {formatWeight(itemWeight.line)}
                            </span>
                            {` · ${itemWeight.recorded ? RECORDED_WEIGHT_LABEL : CURRENT_WEIGHT_LABEL}`}
                          </>
                        ) : (
                          "tidak diketahui (varian sudah dihapus)"
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-sm text-slate-950">
                        {currency(item.unit_price * item.quantity)}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-slate-500">
                        {item.quantity} x {currency(item.unit_price)}
                      </p>
                    </div>
                  </div>
                  );
                })
              )}
              {items.length > 0 && (
                <div className="p-4 sm:px-5 bg-slate-50/50">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium text-slate-600">Total berat</span>
                    <span className="font-semibold text-slate-950">
                      {weight.total != null ? formatWeight(weight.total) : "Tidak diketahui"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {weight.recorded
                      ? "Berat saat order, dipakai saat kirim ke Mengantar."
                      : "Berat varian saat ini, dipakai saat kirim ke Mengantar."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mengantar Expedition & Tracking Card */}
          <Card className="rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-4 sm:px-6">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Truck className="size-4 text-slate-600" />
                <span>Pengiriman</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs text-slate-500">Kurir & Layanan</span>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {order.courier_code ? courierServiceLabel(order.courier_code, order.courier_service) : "Belum dipilih"}
                  </p>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">Nomor Resi</span>
                  <div className="mt-1 flex items-center gap-2">
                    <p className={`min-w-0 break-all font-mono text-sm font-semibold ${order.cnote_no ? "text-emerald-700" : "text-amber-700"}`}>
                      {order.cnote_no || "Belum diterbitkan"}
                    </p>
                    {order.cnote_no && (
                      <button
                        type="button"
                        onClick={() =>
                          void copyToClipboard(
                            order.cnote_no || "",
                            "tracking",
                            "Nomor resi",
                          )
                        }
                        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title="Salin resi"
                      >
                        {copiedTarget === "tracking" ? (
                          <Check className="size-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div>
                  <span className="block text-xs text-slate-500">Gudang Pengirim</span>
                  <p className="mt-1 text-xs font-semibold text-slate-800">
                    {order.warehouse_name || "Default Warehouse"}
                  </p>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">ID Provider Order</span>
                  <p className="mt-1 break-all font-mono text-xs font-semibold text-slate-800">
                    {order.provider_order_id || "—"}
                  </p>
                </div>
              </div>

              {order.provider_dispatch_error && isDispatchOutcomeUnknown(order.provider_dispatch_error) ? (
                // Audit 2026-10-31 M-1: Mengantar may have created the shipment.
                <div role="status" className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Hasil push ke Mengantar belum pasti</p>
                  {acceptedShipmentId(order.provider_dispatch_error) ? (
                    <>
                      <p className="leading-relaxed">Mengantar sudah menerima paket ini (ID {acceptedShipmentId(order.provider_dispatch_error)}), tetapi hasilnya gagal disimpan di sini. Jangan push ulang: tautkan paketnya, lalu resi terisi saat sinkron status.</p>
                      <Button type="button" variant="outline" className="self-start" disabled={saving} onClick={() => void linkAcceptedDispatch()}>
                        Tautkan paket Mengantar
                      </Button>
                    </>
                  ) : (
                    <p className="leading-relaxed">Koneksi terputus atau respons tidak terbaca, jadi paket mungkin sudah dibuat. Cari {order.order_number} di dashboard Mengantar. Push ulang hanya kalau paketnya memang belum ada, supaya tidak terkirim dua kali.</p>
                  )}
                  {acceptedShipmentId(order.provider_dispatch_error) ? null : mayReleaseDispatch ? (
                    <Button type="button" variant="outline" className="self-start" disabled={saving} onClick={() => void releaseUnknownDispatch()}>
                      Sudah dicek, izinkan push ulang
                    </Button>
                  ) : (
                    <p className="leading-relaxed">Setelah dicek, owner atau admin yang dapat mengizinkan push ulang.</p>
                  )}
                </div>
              ) : order.provider_dispatch_error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                  <p className="font-semibold text-rose-900">Gagal Push ke Mengantar:</p>
                  <p className="mt-0.5 font-normal leading-relaxed">{order.provider_dispatch_error}</p>
                </div>
              ) : null}

              {order.shipping_status === "pending" ? (
                <div className="pt-2">
                  <Button
                    type="button"
                    onClick={pushToMengantar}
                    disabled={saving || !canConfirm}
                    className="w-full"
                  >
                    {!paymentReady
                      ? order.payment_method === "manual_transfer"
                        ? "Menunggu Konfirmasi Transfer"
                        : "Menunggu Pembayaran Online"
                      : !shippingDataComplete
                      ? "Lengkapi Alamat & Ekspedisi"
                      : "Push Order ke Mengantar"}
                  </Button>
                </div>
              ) : (
                <a
                  href={`/admin/shipping?order=${encodeURIComponent(order.order_number)}`}
                  className={buttonVariants({ variant: "outline", className: "mt-2 w-full" })}
                >
                  <ExternalLink className="mr-1.5 size-3.5" />
                  Lihat Manajemen Resi & Tracking
                </a>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Financials, Risk & CRM */}
        <div className="space-y-6">
          {/* Payment Summary Card */}
          <Card className="rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-4 sm:px-6">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CreditCard className="size-4 text-slate-600" />
                <span>Pembayaran</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Metode Pembayaran</span>
                <span className="font-semibold text-slate-900">
                  {paymentMethodLabels[order.payment_method] || String(order.payment_method || "COD").toUpperCase()}
                </span>
              </div>

              {order.payment_switched_at && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
                  Diganti dari {String(order.payment_switched_from || "cod").toUpperCase()} pada {formatDate(order.payment_switched_at)}
                  {order.payment_switched_by ? ` oleh ${order.payment_switched_by}` : ""}.
                </p>
              )}
              {order.payment_switch?.available ? (
                <PaymentSwitchDialog
                  invoice={order.order_number}
                  totalAmount={order.payment_switch.total_amount}
                  onSwitched={() => setReloadKey((value) => value + 1)}
                />
              ) : order.payment_switch?.reason && !isVoidOrder(order) ? (
                <p className="text-slate-500">Ganti ke transfer/VA tidak tersedia: {order.payment_switch.reason}</p>
              ) : null}
              {order.payment_link && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(`${window.location.origin}${order.payment_link}`)
                      .then(() => toast.success("Link pembayaran disalin. Kirim ke pembeli."))
                      .catch(() => toast.error("Link gagal disalin."));
                  }}
                >
                  Salin link pembayaran
                </Button>
              )}

              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Status Pembayaran</span>
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${paymentStatusStyle}`}>
                  <span className={`size-1.5 shrink-0 rounded-full ${paymentDotColor}`} aria-hidden="true" />
                  {paymentLabels[paymentStatus] || order.payment_status}
                </span>
              </div>

              {order.payment_method === "manual_transfer" &&
                !paymentPaid &&
                !paymentFailed &&
                !isVoidOrder(order) && (
                  <Button
                    type="button"
                    onClick={() => void confirmManualTransfer()}
                    disabled={saving}
                    className="w-full"
                  >
                    Transfer Diterima
                  </Button>
                )}

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Subtotal Produk</span>
                  <span className="font-semibold text-slate-900">
                    {currency(items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0))}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Biaya Ongkir</span>
                  <span className="font-semibold text-slate-900">{currency(order.shipping_cost || 0)}</span>
                </div>

                {order.payment_method === "cod" && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Biaya COD (3%)</span>
                      <span className="font-semibold text-slate-900">{currency(order.cod_service_fee || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">PPN 11% (dari Fee COD)</span>
                      <span className="font-semibold text-slate-900">{currency(order.cod_service_fee_vat || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Penanggung Fee COD</span>
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${order.cod_fee_bearer === "buyer" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>
                        {order.cod_fee_bearer === "buyer" ? "Pembeli" : "Seller"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="border-t-2 border-slate-900 pt-3 flex justify-between items-center">
                <span className="font-semibold text-slate-950 text-sm">Total Tagihan</span>
                <span className="font-semibold text-emerald-700 text-lg">
                  {currency(order.total_amount || 0)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Receiver Risk Card */}
          <Card className="rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-4 sm:px-6">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldAlert className="size-4 text-slate-600" />
                <span>Riwayat penerima (RTS)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-3 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xl font-semibold text-slate-950">
                  {order.receiver_delivery_rate == null ? "—" : `${order.receiver_delivery_rate}%`}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${risk.style}`}>
                  {risk.label}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {order.receiver_performance?.grade && order.receiver_performance.grade !== "-"
                  ? `Skor Mengantar ${order.receiver_performance.grade} dari seluruh riwayat nomor ini.`
                  : "Paket terkirim dari seluruh riwayat nomor ini."}
              </p>

              {order.receiver_performance_unavailable === "not-whitelisted" && !order.receiver_risk_label && (
                <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  Akses skor penerima Mengantar belum aktif untuk akun ini. Minta whitelist
                  Receiver Score ke CS Mengantar; order akan dinilai otomatis setelah akses dibuka.
                </p>
              )}

              {deliveryTotals && typeof deliveryTotals === "object" && (
                <dl className="grid grid-cols-3 gap-2 border-y py-2 text-center">
                  <div><dt className="text-xs text-slate-500">Terkirim</dt><dd className="font-mono text-base font-semibold text-emerald-700">{deliveryTotals.delivered ?? 0}</dd></div>
                  <div><dt className="text-xs text-slate-500">RTS</dt><dd className="font-mono text-base font-semibold text-rose-700">{deliveryTotals.rts ?? 0}</dd></div>
                  <div><dt className="text-xs text-slate-500">Diproses</dt><dd className="font-mono text-base font-semibold text-sky-700">{deliveryTotals.inProgress ?? 0}</dd></div>
                </dl>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => void refreshRtsScoring()}
                disabled={saving}
                className="w-full"
              >
                <RefreshCw className={cn(saving && "animate-spin")} aria-hidden="true" />
                {saving ? "Memeriksa…" : "Perbarui riwayat"}
              </Button>
            </CardContent>
          </Card>

          {order.kelola?.configured && (
            <Card className="rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-4 sm:px-6">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Send className="size-4 text-slate-600" />
                  <span>Kelola CRM</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 sm:p-6 space-y-3 text-xs">
                {order.kelola.synced_at ? (
                  <>
                    <p className="flex items-center gap-2 font-medium text-emerald-700">
                      <Check className="size-4" aria-hidden="true" />
                      Terkirim {formatDate(order.kelola.synced_at)}
                    </p>
                    {/* Kelola answers a resend of the same order code as a
                        duplicate, so a switch after the push cannot reach it. */}
                    {order.payment_switched_at && order.payment_switched_at > order.kelola.synced_at && (
                      <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 font-medium text-amber-900">
                        Pembayaran diganti ke {paymentMethodLabels[order.payment_method] || order.payment_method} setelah order terkirim. Kelola masih mencatat COD — perbarui pembayaran dan nilai COD di Kelola secara manual.
                      </p>
                    )}
                  </>
                ) : order.kelola.voided ? (
                  <p className="text-slate-500">Order dibatalkan, tidak dikirim ke Kelola.</p>
                ) : (
                  <>
                    <p className={cn("font-medium", order.kelola.attempts > 0 ? "text-rose-700" : "text-slate-600")}>
                      {order.kelola.attempts > 0
                        ? `Belum diterima Kelola (${order.kelola.attempts}× dicoba)`
                        : "Belum terkirim ke Kelola"}
                    </p>
                    {order.kelola.last_error && (
                      <p className="break-words rounded-lg bg-rose-50 px-3 py-2 font-mono text-rose-800">{order.kelola.last_error}</p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void pushToKelola()}
                      disabled={kelolaPending}
                      className="w-full"
                    >
                      <RefreshCw className={cn(kelolaPending && "animate-spin")} aria-hidden="true" />
                      {kelolaPending ? "Mengirim…" : order.kelola.attempts > 0 ? "Kirim ulang ke Kelola" : "Kirim ke Kelola"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* CRM WhatsApp Quick Actions */}
          <Card className="rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-4 sm:px-6 flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <MessageSquare className="size-4 text-slate-600" />
                <span>Follow-up WhatsApp</span>
              </CardTitle>
              <a href="/admin/settings/crm" className="text-xs font-semibold text-emerald-700 hover:underline">
                Pengaturan
              </a>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <CrmActionGroup
                crmUrls={allCrmUrls}
                orderId={order.id}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
