import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CRM_STEPS } from './CrmActionButton';
import type { OrderFollowUp, OrderFollowUpStep } from '../../lib/order-follow-up';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

const FOLLOW_UP_SAVED = 'adsbook:follow-up-saved';
// WhatsApp green for a step still to send, grey once sent. The text is a dark
// green, not white: white on #25D366 is about 2:1, too faint to read.
const WA_TODO = 'border-[#1fb957] bg-[#25D366] text-[#06331a] hover:bg-[#1fc15c] hover:text-[#06331a]';
const WA_DONE = 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-600';

/**
 * Ten step chips, two rows of five. The order list hands each panel its
 * records (`initialRows`, one read for the page). Without them (the order
 * page, or a list whose read failed) the panel reads its own order once it is
 * on screen, so the hidden one of the list's two layouts never reads.
 */
export function CrmActionGroup({ orderId, crmUrls, initialRows }: {
  orderId: string | number;
  crmUrls: Record<string, string>;
  initialRows?: OrderFollowUp[] | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Per step: a second chip tapped while the first is still saving is recorded too.
  const [recording, setRecording] = useState<readonly string[]>([]);
  const [rows, setRows] = useState<OrderFollowUp[] | null>(initialRows ?? null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<{ step: OrderFollowUpStep; completed: boolean; revision: number } | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const noteId = useId();
  const endpoint = `/api/admin/orders/${encodeURIComponent(orderId)}/follow-up`;

  // Reads this order's records itself, also when the list supplied them (a stale revision).
  const refresh = () => { setExpanded(true); setReload(value => value + 1); };

  // A list refresh brings new records.
  useEffect(() => { if (initialRows) setRows(initialRows); }, [initialRows]);

  useEffect(() => {
    const element = root.current;
    if (!element || expanded || initialRows) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setExpanded(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, initialRows]);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setError('');
    fetch(endpoint, { signal: controller.signal }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Catatan belum dapat dimuat.');
      if (!controller.signal.aborted) setRows(body.data);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [expanded, endpoint, reload]);

  // OrdersTable mounts one group per layout (cards and table); a save in one
  // updates the other, so neither shows a stale status or revision.
  useEffect(() => {
    const sync = (event: Event) => {
      const { orderId: saved, row } = (event as CustomEvent<{ orderId: string; row: OrderFollowUp }>).detail;
      if (saved === String(orderId)) setRows(current => current && [...current.filter(item => item.step !== row.step), row]);
    };
    window.addEventListener(FOLLOW_UP_SAVED, sync);
    return () => window.removeEventListener(FOLLOW_UP_SAVED, sync);
  }, [orderId]);

  async function save() {
    if (!editing || saving || conflict) return;
    setSaving(true); setSaveError('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editing, note }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (response.status === 409) { setConflict(true); refresh(); return; } throw new Error(body.error || 'Gagal menyimpan catatan.'); }
      setRows(current => [...(current || []).filter(row => row.step !== editing.step), body.data]);
      window.dispatchEvent(new CustomEvent(FOLLOW_UP_SAVED, { detail: { orderId: String(orderId), row: body.data } }));
      setEditing(null);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Gagal menyimpan catatan.'); }
    finally { setSaving(false); }
  }

  // One tap: the chip opens WhatsApp and records the step done (Paduka,
  // 2026-10-31, amending REQ-249). A wrong tap is undone from the toast, which
  // opens the correction dialog that still asks for a reason.
  async function record(step: (typeof CRM_STEPS)[number]) {
    const current = rows?.find(item => item.step === step.key);
    if (current?.completed || recording.includes(step.key)) return;
    setRecording(list => [...list, step.key]);
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: step.key, completed: true, revision: current?.revision ?? 0, note: '' }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) refresh();
        throw new Error(body.error || 'Tahap belum tercatat.');
      }
      const saved = body.data as OrderFollowUp;
      setRows(list => [...(list || []).filter(item => item.step !== saved.step), saved]);
      window.dispatchEvent(new CustomEvent(FOLLOW_UP_SAVED, { detail: { orderId: String(orderId), row: saved } }));
      toast.success(`${step.fullLabel} ditandai selesai.`, {
        action: { label: 'Batalkan', onClick: () => { setEditing({ step: step.key, completed: false, revision: saved.revision }); setNote(''); setSaveError(''); setConflict(false); } },
      });
    } catch (reason) {
      toast.error(`${step.fullLabel}: ${reason instanceof Error ? reason.message : 'Tahap belum tercatat.'}`);
    } finally { setRecording(list => list.filter(key => key !== step.key)); }
  }

  // `px-0`: five chips share the column; the longest label (Welcome) needs every pixel.
  const chip = 'w-full min-w-0 px-0';
  return <div ref={root} className="min-w-0">
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">{error}<Button variant="outline" size="sm" onClick={refresh}>Coba lagi</Button></div> :
      <div role="group" aria-label="Tahap follow-up" aria-busy={!rows} className="grid grid-cols-5 gap-1">
        {CRM_STEPS.map(step => {
          const done = Boolean(rows?.find(entry => entry.step === step.key)?.completed);
          const url = crmUrls[step.key];
          const title = `${step.title}${done ? ' · sudah dilakukan' : ''}`;
          // Done reads as grey, not an icon: a check does not fit a fifth of the column.
          const label = <><span className="truncate">{step.label}</span>{done && <span className="sr-only"> (selesai)</span>}</>;
          return url && rows
            ? <a key={step.key} href={url} target="_blank" rel="noopener noreferrer" aria-busy={recording.includes(step.key)} title={title} className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), chip, done ? WA_DONE : WA_TODO)} onClick={() => void record(step)}>{label}</a>
            : <Button key={step.key} size="sm" variant="outline" className={chip} disabled title={rows ? `${step.title} · template atau nomor belum ada` : 'Memuat…'}>{label}</Button>;
        })}
      </div>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving) setEditing(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{editing?.completed ? 'Konfirmasi follow-up selesai' : 'Koreksi status follow-up'}</DialogTitle><DialogDescription>{CRM_STEPS.find(step => step.key === editing?.step)?.fullLabel} · Simpan hanya setelah tindakan benar-benar dilakukan. Identitas operator dan waktu akan dicatat.</DialogDescription></DialogHeader>
      <label htmlFor={noteId}>{editing?.completed ? 'Catatan (opsional)' : 'Alasan koreksi (wajib)'}</label>
      <Textarea id={noteId} maxLength={1000} value={note} disabled={saving} onChange={event => setNote(event.target.value)} />
      {saveError && <p role="alert">{saveError}</p>}
      {conflict && <p className="text-sm">Status terbaru sudah dimuat ulang. Tutup dialog dan periksa sebelum mencatat lagi. Catatan Anda: {note || '—'}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>Batal</Button><Button disabled={saving || conflict || (!editing?.completed && !note.trim())} onClick={() => void save()}>{saving ? 'Menyimpan…' : 'Simpan konfirmasi'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
