import * as React from "react";
import { TOPBAR_BADGE, TOPBAR_ICON_BUTTON } from "./topbar-styles";
import { Activity, CircleCheck, ListTodo, TriangleAlert } from "lucide-react";
import type { StatusIconState } from "@/lib/health-snapshot";

/**
 * The operational status icon beside the notification bell (PRD A39).
 *
 * A link to `/admin/status`, not a popover: one destination that works by
 * keyboard and on a phone (REQ-218). It never polls. One fetch per page load,
 * after hydration; the answer is kept in sessionStorage for five minutes so
 * moving between admin pages costs nothing, and a window coming back into
 * focus asks again only once that answer has expired. **Periksa ulang** on the
 * status page hands its fresh answer over through `rememberStatusIcon`.
 *
 * AdminShell renders it for owner and admin only; the other roles never send
 * the request (REQ-216).
 */

const CACHE_KEY = "adsbookcms:ops-status:v1";
const CACHE_MS = 5 * 60_000;
const UPDATE_EVENT = "adsbookcms:ops-status";

type Cached = { at: number; icon: StatusIconState };

function readCached(): Cached | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Cached) : null;
    return parsed && typeof parsed.at === "number" && parsed.icon?.tone ? parsed : null;
  } catch {
    return null;
  }
}

/** Store a fresh answer and tell any mounted icon on this page. */
export function rememberStatusIcon(icon: StatusIconState) {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), icon } satisfies Cached));
  } catch {
    /* storage unavailable: the next page load simply asks again */
  }
  window.dispatchEvent(new CustomEvent<StatusIconState>(UPDATE_EVENT, { detail: icon }));
}

const TONE: Record<StatusIconState["tone"], { icon: typeof Activity; className: string }> = {
  problem: { icon: TriangleAlert, className: "text-rose-600 hover:text-rose-700" },
  setup: { icon: ListTodo, className: "text-amber-600 hover:text-amber-700" },
  healthy: { icon: CircleCheck, className: "text-emerald-600 hover:text-emerald-700" },
  unknown: { icon: Activity, className: "" },
};

export function OperationalStatusIcon({ active = false }: { active?: boolean }) {
  const [icon, setIcon] = React.useState<StatusIconState | null>(null);

  React.useEffect(() => {
    let inFlight = false;
    const load = async () => {
      const cached = readCached();
      if (cached && Date.now() - cached.at < CACHE_MS) {
        setIcon(cached.icon);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/admin/health/status", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { icon?: StatusIconState };
        if (payload.icon?.tone) {
          rememberStatusIcon(payload.icon);
          setIcon(payload.icon);
        }
      } catch {
        /* the icon stays neutral; the status page is one click away */
      } finally {
        inFlight = false;
      }
    };
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<StatusIconState>).detail;
      if (detail?.tone) setIcon(detail);
    };
    void load();
    window.addEventListener("focus", load);
    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener(UPDATE_EVENT, onUpdate);
    };
  }, []);

  // A tone this build does not know (a cached icon from another build) reads as unknown.
  const tone = TONE[icon?.tone ?? "unknown"] ?? TONE.unknown;
  const Icon = tone.icon;
  const label = icon?.label ?? "Status operasional";
  const badge = icon && icon.count > 0 ? (icon.count > 99 ? "99+" : String(icon.count)) : null;

  return (
    <a
      href="/admin/status"
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      data-status-tone={icon?.tone ?? "loading"}
      className={`${TOPBAR_ICON_BUTTON} ${tone.className} ${active ? "bg-slate-100" : ""}`}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
      {badge && (
        <span
          aria-hidden="true"
          className={`${TOPBAR_BADGE} ${icon?.tone === "problem" ? "bg-red-600" : "bg-amber-600"}`}
        >
          {badge}
        </span>
      )}
    </a>
  );
}
