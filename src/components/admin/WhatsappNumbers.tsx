import { useEffect, useState, type SubmitEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  formatWhatsappDisplay,
  normalizeWhatsappPhone,
  WHATSAPP_LABEL_MAX,
  WHATSAPP_NUMBERS_MAX,
  whatsappShareSummary,
  type WhatsappNumber,
} from "../../lib/whatsapp-numbers";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { useConfirm } from "./useConfirm";

const ENDPOINT = "/api/admin/whatsapp-numbers";
const PHONE_HINT = "Nomor Indonesia, contoh 081234567890.";

type ApiAnswer = { data?: WhatsappNumber[]; error?: string };

async function send(method: string, body?: unknown): Promise<WhatsappNumber[]> {
  const response = await fetch(ENDPOINT, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => ({}))) as ApiAnswer;
  if (!response.ok) throw new Error(answer.error || "Permintaan gagal. Coba lagi.");
  return answer.data ?? [];
}

/**
 * Pengaturan → Nomor WhatsApp (PRD A35). The list /thanks rotates COD buyers
 * through. Every server refusal (the 10-number cap, a duplicate, the last
 * active number) is shown in the server's own words.
 */
export default function WhatsappNumbers() {
  const [rows, setRows] = useState<WhatsappNumber[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WhatsappNumber | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    send("GET")
      .then(setRows)
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  async function run(action: () => Promise<WhatsappNumber[]>) {
    setBusy(true);
    setMessage(null);
    try {
      setRows(await action());
      return true;
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizeWhatsappPhone(phone)) {
      setPhoneError(PHONE_HINT);
      return;
    }
    setPhoneError(null);
    if (await run(() => send("POST", { label, phone }))) {
      setLabel("");
      setPhone("");
    }
  }

  async function saveEdit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (!normalizeWhatsappPhone(editPhone)) {
      setMessage(PHONE_HINT);
      return;
    }
    if (await run(() => send("PATCH", { id: editing.id, label: editLabel, phone: editPhone }))) {
      setEditing(null);
    }
  }

  async function remove(row: WhatsappNumber) {
    const ok = await confirm({
      title: "Hapus nomor WhatsApp?",
      description: `${formatWhatsappDisplay(row.phone)} tidak akan menerima order baru dari halaman terima kasih.`,
      confirmLabel: "Hapus nomor",
    });
    if (ok) await run(() => send("DELETE", { id: row.id }));
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
        <span className="sr-only">Memuat nomor WhatsApp.</span>
      </div>
    );
  }

  const active = rows.filter((row) => row.is_active).length;
  const full = rows.length >= WHATSAPP_NUMBERS_MAX;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5 md:p-6">
          <p className="text-sm font-semibold text-slate-900">{whatsappShareSummary(active)}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Setiap order tetap di nomor yang sama walau halaman dibuka ulang, jadi pembagiannya rata dalam jumlah
            banyak, bukan bergantian satu per satu. Nomor pertama yang aktif juga dipakai di halaman kontak.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 md:p-6">Belum ada nomor — tambahkan nomor CS pertama.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-4 md:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {row.label || "Tanpa label"}
                  </p>
                  <p className="font-mono text-sm text-slate-600">{formatWhatsappDisplay(row.phone)}</p>
                </div>
                <span className="text-xs text-slate-500">
                  {row.is_active ? whatsappShareLabel(active) : "Nonaktif"}
                </span>
                <Switch
                  checked={row.is_active}
                  disabled={busy}
                  aria-label={`${row.is_active ? "Nonaktifkan" : "Aktifkan"} ${formatWhatsappDisplay(row.phone)}`}
                  onCheckedChange={(checked) =>
                    run(() => send("PATCH", { id: row.id, is_active: checked }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  disabled={busy}
                  aria-label={`Ubah ${formatWhatsappDisplay(row.phone)}`}
                  onClick={() => {
                    setEditing(row);
                    setEditLabel(row.label);
                    setEditPhone(formatWhatsappDisplay(row.phone));
                  }}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  disabled={busy}
                  aria-label={`Hapus ${formatWhatsappDisplay(row.phone)}`}
                  onClick={() => remove(row)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {message && (
          <p role="alert" className="mx-5 mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 md:mx-6">
            {message}
          </p>
        )}
      </section>

      <form onSubmit={add} noValidate className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <p className="mb-4 text-sm font-semibold text-slate-900">Tambah nomor</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">Label (opsional)</span>
            <Input
              value={label}
              maxLength={WHATSAPP_LABEL_MAX}
              placeholder="Contoh: CS Sore"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">Nomor WhatsApp</span>
            <Input
              value={phone}
              inputMode="tel"
              autoComplete="tel"
              placeholder="081234567890"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby="wa-phone-hint"
              className="font-mono"
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || full}>
            <Plus aria-hidden="true" />
            Tambah
          </Button>
        </div>
        <p id="wa-phone-hint" className={`mt-2 text-xs ${phoneError ? "text-rose-700" : "text-slate-500"}`}>
          {full ? `Maksimal ${WHATSAPP_NUMBERS_MAX} nomor. Hapus satu nomor untuk menambah yang baru.` : phoneError || PHONE_HINT}
        </p>
      </form>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={saveEdit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>Ubah nomor WhatsApp</DialogTitle>
              <DialogDescription>Perubahan langsung dipakai untuk order berikutnya.</DialogDescription>
            </DialogHeader>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Label (opsional)</span>
              <Input value={editLabel} maxLength={WHATSAPP_LABEL_MAX} onChange={(event) => setEditLabel(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Nomor WhatsApp</span>
              <Input
                value={editPhone}
                inputMode="tel"
                className="font-mono"
                onChange={(event) => setEditPhone(event.target.value)}
              />
            </label>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Batal</Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>Simpan</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}

function whatsappShareLabel(active: number) {
  if (active <= 1) return "Semua order";
  return `±${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(100 / active)}%`;
}
