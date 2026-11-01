import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { Warehouse } from "../../lib/warehouses";
import { INDONESIAN_PROVINCES, getProvinceName, normalizeProvinceCode } from "../../lib/province";
import { normalizePhone } from "../../lib/validation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { useConfirm } from "./useConfirm";
import WarehouseOriginPicker, { type WarehouseOrigin } from "./WarehouseOriginPicker";

const ENDPOINT = "/api/admin/warehouses";

type ApiAnswer = { data?: Warehouse[]; max?: number; error?: string };

type Draft = {
  id: number | null;
  name: string;
  contact_name: string;
  contact_phone: string;
  origin_area_id: string;
  origin_label: string;
  pickup_address_id: string;
  address: string;
  city: string;
  province: string;
  served_provinces: string[];
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  contact_name: "",
  contact_phone: "",
  origin_area_id: "",
  origin_label: "",
  pickup_address_id: "",
  address: "",
  city: "",
  province: "",
  served_provinces: [],
};

async function send(method: string, body?: unknown): Promise<{ rows: Warehouse[]; max: number }> {
  const response = await fetch(ENDPOINT, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => ({}))) as ApiAnswer;
  if (!response.ok) throw new Error(answer.error || "Permintaan gagal. Coba lagi.");
  return { rows: answer.data ?? [], max: answer.max ?? 10 };
}

const provinceNames = (codes: string[]) => codes.map((code) => getProvinceName(code) || code).join(", ");

/**
 * Pengaturan → Gudang (PRD A42). Each warehouse's quote area is its served
 * provinces; a buyer outside every list is quoted from the same island group,
 * else from the primary. Every refusal (ten warehouses, the primary's guard,
 * a warehouse with orders) is shown in the server's own words.
 */
export default function Warehouses() {
  const [rows, setRows] = useState<Warehouse[] | null>(null);
  const [max, setMax] = useState(10);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [changingOrigin, setChangingOrigin] = useState(false);
  const editorRef = useRef<HTMLFormElement | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    send("GET")
      .then(({ rows: next, max: limit }) => {
        setRows(next);
        setMax(limit);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  // The origin picker announces a pick as a window event (its page used to be
  // static Astro); the editor turns it into the draft's origin.
  useEffect(() => {
    const onOrigin = (event: Event) => {
      const origin = (event as CustomEvent<WarehouseOrigin>).detail;
      setDraft((current) =>
        current
          ? { ...current, origin_area_id: origin.id, origin_label: origin.label, city: origin.city, province: origin.province }
          : current,
      );
      setChangingOrigin(false);
    };
    window.addEventListener("warehouse-origin", onOrigin);
    return () => window.removeEventListener("warehouse-origin", onOrigin);
  }, []);

  useEffect(() => {
    if (draft) editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [draft?.id, draft === null]);

  async function run(action: () => Promise<{ rows: Warehouse[]; max: number }>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const { rows: next, max: limit } = await action();
      setRows(next);
      setMax(limit);
      if (success) setMessage({ tone: "success", text: success });
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openEditor(row?: Warehouse) {
    setMessage(null);
    setChangingOrigin(!row?.origin_area_id);
    setDraft(
      row
        ? {
            id: row.id,
            name: row.name,
            contact_name: row.contact_name,
            contact_phone: normalizePhone(row.contact_phone),
            origin_area_id: row.origin_area_id,
            origin_label: row.origin_label,
            pickup_address_id: row.pickup_address_id,
            address: row.address,
            city: row.city,
            province: row.province,
            // Extras only: the server always adds the (possibly new) own province.
            served_provinces: row.served_provinces.filter((code) => code !== row.province_code),
          }
        : { ...EMPTY_DRAFT },
    );
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.origin_area_id) {
      setMessage({ tone: "error", text: "Pilih kecamatan origin dari pencarian Mengantar." });
      return;
    }
    if (!event.currentTarget.reportValidity()) return;
    const payload = { ...draft, contact_phone: normalizePhone(draft.contact_phone) };
    const ok = await run(
      () => (draft.id ? send("PATCH", { ...payload, action: "update" }) : send("POST", payload)),
      draft.id ? "Gudang tersimpan." : "Gudang ditambahkan.",
    );
    if (ok) setDraft(null);
  }

  async function remove(row: Warehouse) {
    const ok = await confirm({
      title: `Hapus ${row.name}?`,
      description: "Gudang yang sudah dipakai order tidak bisa dihapus; nonaktifkan saja agar tidak dipilih untuk order baru.",
      confirmLabel: "Hapus gudang",
    });
    if (ok) await run(() => send("DELETE", { id: row.id }), "Gudang dihapus.");
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
        {loadError}
      </div>
    );
  }
  if (!rows) {
    return (
      <div role="status" aria-busy="true" className="h-64 animate-pulse rounded-xl bg-slate-100">
        <span className="sr-only">Memuat daftar gudang.</span>
      </div>
    );
  }

  const full = rows.length >= max;
  const ownCode = draft ? normalizeProvinceCode(draft.province) : "";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="warehouse-list-title">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between md:p-6">
          <div className="min-w-0">
            <h2 id="warehouse-list-title" className="text-sm font-semibold text-slate-900">
              {rows.length} dari {max} gudang
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Ongkir dihitung dari gudang yang melayani provinsi pembeli, lalu gudang di pulau yang sama, lalu gudang
              utama. Hanya gudang yang siap di Mengantar yang dipilih.
            </p>
          </div>
          <Button type="button" disabled={busy || full || draft !== null} onClick={() => openEditor()}>
            <Plus aria-hidden="true" />
            Tambah gudang
          </Button>
        </div>

        {full && (
          <p className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500 md:px-6">
            Maksimal {max} gudang. Hapus gudang yang belum dipakai untuk menambah yang baru.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 md:p-6">Belum ada gudang — tambahkan gudang pertama agar ongkir bisa dihitung.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:px-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{row.name}</p>
                    {row.is_primary && (
                      <Badge>
                        <Star aria-hidden="true" />
                        Utama
                      </Badge>
                    )}
                    {row.ready ? (
                      <Badge variant="secondary">Siap di Mengantar</Badge>
                    ) : (
                      <Badge variant="destructive">Belum lengkap</Badge>
                    )}
                    {!row.is_active && <Badge variant="outline">Nonaktif</Badge>}
                  </div>
                  <p className="mt-1 flex items-start gap-1 break-words text-xs text-slate-600">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{[row.city, row.province].filter(Boolean).join(", ") || "Origin belum dipilih"}</span>
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-500">
                    Melayani: {provinceNames(row.served_provinces) || "—"}
                    {row.order_count > 0 ? ` · ${row.order_count} order` : ""}
                  </p>
                  {!row.ready && (
                    <p className="mt-1 text-xs text-rose-700">
                      {row.origin_area_id ? "Pickup address Mengantar belum terdaftar." : "Origin Mengantar belum dipilih."}{" "}
                      Gudang ini tidak dipakai untuk ongkir sampai dilengkapi.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!row.is_primary && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || !row.ready || !row.is_active}
                      onClick={() => run(() => send("PATCH", { id: row.id, action: "primary" }), `${row.name} sekarang gudang utama.`)}
                    >
                      Jadikan utama
                    </Button>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <Switch
                      checked={row.is_active}
                      disabled={busy || row.is_primary}
                      aria-label={`${row.is_active ? "Nonaktifkan" : "Aktifkan"} ${row.name}`}
                      onCheckedChange={(checked) =>
                        run(() => send("PATCH", { id: row.id, action: checked ? "activate" : "deactivate" }))
                      }
                    />
                    Aktif
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    disabled={busy || draft !== null}
                    aria-label={`Ubah ${row.name}`}
                    onClick={() => openEditor(row)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  {!row.is_primary && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      disabled={busy}
                      aria-label={`Hapus ${row.name}`}
                      onClick={() => remove(row)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {message && !draft && <Notice message={message} />}
      </section>

      {draft && (
        <form
          ref={editorRef}
          onSubmit={save}
          className="scroll-mt-4 rounded-xl border border-slate-200 bg-white shadow-sm"
          aria-labelledby="warehouse-editor-title"
          aria-busy={busy}
        >
          <div className="border-b border-slate-100 p-5 md:p-6">
            <h2 id="warehouse-editor-title" className="text-sm font-semibold text-slate-900">
              {draft.id ? `Ubah ${draft.name || "gudang"}` : "Gudang baru"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Alamat pickup didaftarkan ke Mengantar saat disimpan.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 border-b border-slate-100 p-5 md:grid-cols-2 md:p-6">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Nama gudang</span>
              <Input
                required
                maxLength={120}
                placeholder="Contoh: Gudang Surabaya"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Nama PIC</span>
              <Input
                required
                maxLength={120}
                autoComplete="name"
                placeholder="Contoh: Rini"
                value={draft.contact_name}
                onChange={(event) => setDraft({ ...draft, contact_name: event.target.value })}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Nomor HP PIC</span>
              <Input
                required
                type="tel"
                inputMode="numeric"
                maxLength={16}
                autoComplete="tel"
                placeholder="08xxxxxxxxxx"
                className="font-mono"
                value={draft.contact_phone}
                onChange={(event) => setDraft({ ...draft, contact_phone: normalizePhone(event.target.value) })}
              />
            </label>
          </div>

          <div className="space-y-3 border-b border-slate-100 p-5 md:p-6">
            <p className="text-xs font-semibold text-slate-700">Kecamatan origin (Mengantar)</p>
            {draft.origin_area_id && !changingOrigin ? (
              <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-blue-900">
                    {draft.origin_label || [draft.city, draft.province].filter(Boolean).join(", ")}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-blue-700">
                    Area ID: {draft.origin_area_id} · {draft.city}, {draft.province}
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setChangingOrigin(true)}>
                  Ganti
                </Button>
              </div>
            ) : (
              <div>
                <label htmlFor="originSearch" className="sr-only">
                  Cari kecamatan atau kelurahan origin
                </label>
                <WarehouseOriginPicker />
                <p id="originSearchHint" className="mt-1.5 text-xs text-slate-500">
                  Pilih kecamatan atau kelurahan gudang dari database Mengantar.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 border-b border-slate-100 p-5 md:p-6">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Alamat jalan</span>
              <Textarea
                required
                maxLength={500}
                rows={2}
                autoComplete="street-address"
                placeholder="Contoh: Jl. Branjangan 18A"
                value={draft.address}
                onChange={(event) => setDraft({ ...draft, address: event.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                Pickup Address ID <span className="font-medium text-slate-400">(opsional)</span>
              </span>
              <Input
                maxLength={120}
                autoComplete="off"
                placeholder="Dibuat otomatis jika kosong"
                className="font-mono"
                value={draft.pickup_address_id}
                onChange={(event) => setDraft({ ...draft, pickup_address_id: event.target.value })}
              />
            </label>
          </div>

          <fieldset className="border-b border-slate-100 p-5 md:p-6">
            <legend className="sr-only">Provinsi yang dilayani</legend>
            <p className="text-xs font-semibold text-slate-700">Provinsi yang dilayani</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Provinsi gudang sendiri selalu dilayani. Tambahkan provinsi lain yang lebih dekat ke gudang ini daripada
              ke gudang lain.
            </p>
            <div className="mt-3 grid max-h-72 grid-cols-1 gap-x-4 gap-y-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {INDONESIAN_PROVINCES.map((province) => {
                const own = province.code === ownCode;
                const checked = own || draft.served_provinces.includes(province.code);
                return (
                  <label key={province.code} className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                    <Checkbox
                      checked={checked}
                      disabled={own}
                      onCheckedChange={(next) =>
                        setDraft({
                          ...draft,
                          served_provinces: next
                            ? [...draft.served_provinces, province.code]
                            : draft.served_provinces.filter((code) => code !== province.code),
                        })
                      }
                    />
                    <span className="truncate">
                      {province.name}
                      {own ? " (gudang)" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {message && <Notice message={message} />}
          <div className="flex flex-col-reverse gap-3 p-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Menyimpan…" : "Simpan gudang"}
            </Button>
          </div>
        </form>
      )}
      {dialog}
    </div>
  );
}

function Notice({ message }: { message: { tone: "error" | "success"; text: string } }) {
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`mx-5 mt-4 rounded-lg px-3 py-2 text-sm font-medium md:mx-6 ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-blue-50 text-blue-800"}`}
    >
      {message.text}
    </p>
  );
}
