import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FILTER_TRIGGER_CLASS } from "./filter-bar";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  ADMIN_CUSTOM_DATE_FILTER,
  ADMIN_DATE_FILTER_OPTIONS,
  ADMIN_MAX_CUSTOM_RANGE_DAYS,
  ADMIN_MONTH_NAMES,
  ADMIN_WEEKDAY_NAMES,
  adminMonthGrid,
  adminMonthOf,
  daysBetweenAdminDates,
  formatAdminDateRangeLabel,
  formatJakartaDate,
  getAdminDateFilterLabel,
  isWithinAdminRange,
  resolveAdminDateSelection,
  shiftAdminMonth,
} from "../../lib/admin-date-filter";

export type AdminDateSelection = {
  filter: string;
  start: string;
  end: string;
};

type Props = {
  value: AdminDateSelection;
  onChange: (value: AdminDateSelection) => void;
  disabled?: boolean;
  /** Presets this surface does not offer, e.g. the dashboard hides 90d/180d. */
  hiddenPresets?: readonly string[];
  /** Longest custom range this surface can answer for. */
  maxCustomRangeDays?: number;
  className?: string;
};

export function adminDateSelectionLabel(value: AdminDateSelection) {
  if (value.filter !== ADMIN_CUSTOM_DATE_FILTER) {
    return getAdminDateFilterLabel(value.filter);
  }
  return value.start && value.end
    ? formatAdminDateRangeLabel(value.start, value.end)
    : "Rentang tanggal";
}

/** "22 Agu 2026" for the read-only range boxes; a dash placeholder when unset. */
function formatBoxDate(date: string) {
  if (!date) return "—";
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${ADMIN_MONTH_NAMES[(month || 1) - 1].slice(0, 3)} ${year}`;
}

type CalendarMonthProps = {
  ym: string;
  today: string;
  start: string;
  end: string;
  hover: string;
  onHover: (date: string) => void;
  onPick: (date: string) => void;
  isDisabled: (date: string) => boolean;
};

function CalendarMonth({
  ym,
  today,
  start,
  end,
  hover,
  onHover,
  onPick,
  isDisabled,
}: CalendarMonthProps) {
  const weeks = adminMonthGrid(ym);
  // While an end is being chosen, the not-yet-committed hover previews the range.
  const previewEnd = end || hover;

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 grid grid-cols-7 text-center">
        {ADMIN_WEEKDAY_NAMES.map((name) => (
          <span key={name} className="text-xs font-semibold uppercase text-slate-400">
            {name}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {weeks.flat().map((date, index) => {
          if (!date) return <span key={`blank-${index}`} aria-hidden="true" />;
          const day = Number(date.slice(-2));
          const disabled = isDisabled(date);
          const isStart = date === start;
          const isEnd = date === end;
          const inRange = isWithinAdminRange(date, start, previewEnd);
          const isEndpoint = isStart || isEnd || (!!start && !end && date === hover);
          const isToday = date === today;

          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              onClick={() => onPick(date)}
              onMouseEnter={() => onHover(date)}
              aria-pressed={isStart || isEnd}
              className={[
                "mx-auto grid h-8 w-8 place-items-center rounded-lg text-xs tabular-nums transition",
                disabled
                  ? "cursor-not-allowed text-slate-300"
                  : "text-slate-700 hover:bg-slate-100",
                inRange && !isEndpoint ? "bg-blue-50 text-blue-700" : "",
                isEndpoint ? "bg-blue-600 font-semibold text-white hover:bg-blue-600" : "",
                isToday && !isEndpoint ? "font-semibold text-blue-700 ring-1 ring-inset ring-blue-200" : "",
              ].join(" ")}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminDateRangeFilter({
  value,
  onChange,
  disabled = false,
  hiddenPresets = [],
  maxCustomRangeDays = ADMIN_MAX_CUSTOM_RANGE_DAYS,
  className = "",
}: Props) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [align, setAlign] = React.useState<"start" | "end">("start");
  const [draftStart, setDraftStart] = React.useState(value.start);
  const [draftEnd, setDraftEnd] = React.useState(value.end);
  const [hover, setHover] = React.useState("");

  const today = formatJakartaDate(new Date());
  // Left month; the right is always the next one. Opens on the month that
  // holds the current selection, else the current month.
  const [viewMonth, setViewMonth] = React.useState(() =>
    adminMonthOf(value.end || value.start || today),
  );

  // Reopening shows what is in force, not a stale draft, and jumps the calendar
  // back to it.
  React.useEffect(() => {
    if (open) {
      setDraftStart(value.start);
      setDraftEnd(value.end);
      setHover("");
      setViewMonth(adminMonthOf(value.end || value.start || today));
    }
  }, [open, value.start, value.end, today]);

  const presets = ADMIN_DATE_FILTER_OPTIONS.filter(
    (option) => !hiddenPresets.includes(option.value),
  );

  const draft = resolveAdminDateSelection(ADMIN_CUSTOM_DATE_FILTER, {
    customRange: { start: draftStart, end: draftEnd },
    maxCustomRangeDays,
  });

  const isDisabled = React.useCallback(
    (date: string) => {
      if (date > today) return true; // no future
      // While choosing an end, forbid a day that would exceed the span cap —
      // the same ceiling the old numeric inputs enforced (REQ-156).
      if (draftStart && !draftEnd) {
        return Math.abs(daysBetweenAdminDates(draftStart, date)) + 1 > maxCustomRangeDays;
      }
      return false;
    },
    [today, draftStart, draftEnd, maxCustomRangeDays],
  );

  const pickDate = (date: string) => {
    // Start a fresh range on the first click, or once a whole range exists.
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(date);
      setDraftEnd("");
      setHover("");
      return;
    }
    // Second click completes it, ordering the two ends.
    if (date < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(date);
    } else {
      setDraftEnd(date);
    }
  };

  const choosePreset = (filter: string) => {
    onChange({ filter, start: "", end: "" });
    setOpen(false);
  };

  const applyCustom = () => {
    if (!draft.ok) return;
    onChange({ filter: ADMIN_CUSTOM_DATE_FILTER, start: draftStart, end: draftEnd });
    setOpen(false);
  };

  const rightMonth = shiftAdminMonth(viewMonth, 1);
  // Never let the left month sit in the future; the right may reach today.
  const canGoNext = rightMonth <= adminMonthOf(today);

  const monthProps = {
    today,
    start: draftStart,
    end: draftEnd,
    hover,
    onHover: setHover,
    onPick: pickDate,
    isDisabled,
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        // Open rightward from the trigger's left edge when the panel fits;
        // otherwise line its right edge up with the trigger. Where neither
        // fits (a phone), Radix shifts it inside the 16px collision gutter.
        // 704 is the panel's 44rem cap below.
        const trigger = triggerRef.current?.getBoundingClientRect();
        if (next && trigger) {
          const width = Math.min(704, window.innerWidth - 32);
          setAlign(trigger.left + width <= window.innerWidth - 16 ? "start" : "end");
        }
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={`${FILTER_TRIGGER_CLASS} ${className}`}
        >
          <CalendarDays className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{adminDateSelectionLabel(value)}</span>
          <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        collisionPadding={16}
        className="w-[min(44rem,calc(100vw-2rem))] p-0"
      >
        <div className="grid grid-cols-1 gap-0 sm:grid-cols-[11rem_1fr]">
          <div className="max-h-56 overflow-y-auto border-b border-slate-200 p-1.5 sm:max-h-none sm:border-b-0 sm:border-r">
            {presets.map((option) => {
              const active = value.filter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => choosePreset(option.value)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition hover:bg-slate-100 ${
                    active ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700"
                  }`}
                >
                  <Check
                    className={`size-3.5 shrink-0 ${active ? "opacity-100" : "opacity-0"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setViewMonth(shiftAdminMonth(viewMonth, -1))}
                className="grid size-7 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                aria-label="Bulan sebelumnya"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <div className="flex flex-1 items-center justify-around gap-2 text-xs font-semibold text-slate-900">
                <span>
                  {ADMIN_MONTH_NAMES[Number(viewMonth.slice(5)) - 1]} {viewMonth.slice(0, 4)}
                </span>
                <span className="hidden sm:inline">
                  {ADMIN_MONTH_NAMES[Number(rightMonth.slice(5)) - 1]} {rightMonth.slice(0, 4)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => canGoNext && setViewMonth(shiftAdminMonth(viewMonth, 1))}
                disabled={!canGoNext}
                className="grid size-7 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Bulan berikutnya"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex gap-5">
              <CalendarMonth ym={viewMonth} {...monthProps} />
              {/* Two months on desktop; one on a phone, navigated by the arrows. */}
              <div className="hidden flex-1 sm:block">
                <CalendarMonth ym={rightMonth} {...monthProps} />
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-900">
                  {formatBoxDate(draftStart)}
                </span>
                <span className="text-slate-400">–</span>
                <span className="min-w-0 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-900">
                  {formatBoxDate(draftEnd)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                  className="flex-1 sm:flex-none"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  onClick={applyCustom}
                  disabled={!draft.ok}
                  className="flex-1 sm:flex-none"
                >
                  Terapkan
                </Button>
              </div>
            </div>
            <p
              className={`mt-2 text-xs ${draft.ok || !draftStart || !draftEnd ? "text-slate-500" : "text-red-600"}`}
              role={draft.ok ? undefined : "alert"}
            >
              {!draftStart || !draftEnd
                ? `Pilih rentang di kalender · maksimal ${maxCustomRangeDays} hari · waktu Jakarta (WIB)`
                : draft.ok
                  ? `${formatAdminDateRangeLabel(draftStart, draftEnd)} · waktu Jakarta (WIB)`
                  : draft.reason}
            </p>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
