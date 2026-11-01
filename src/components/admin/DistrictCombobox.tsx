import * as React from "react";
import { Loader2 } from "lucide-react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

export type DistrictOption = {
  id: string;
  /** One line shown in the input once chosen. */
  label: string;
  /** Optional second line in the list, e.g. city and province. */
  detail?: string;
};

/**
 * Async kecamatan search on the shadcn Combobox. Three admin screens searched
 * districts with a hand-built list each (rate checker, warehouse origin,
 * abandoned-lead recovery); this is the one they share. The caller owns the
 * endpoint, since the screens resolve different area identities.
 */
export function DistrictCombobox({
  id,
  value,
  onChange,
  search,
  placeholder = "Ketik minimal 3 huruf nama kecamatan…",
  minChars = 3,
  disabled,
  invalid,
  describedBy,
  searchingText = "Mencari kecamatan…",
  emptyText = "Kecamatan tidak ditemukan.",
}: {
  id: string;
  value: DistrictOption | null;
  onChange: (option: DistrictOption | null) => void;
  search: (query: string, signal: AbortSignal) => Promise<DistrictOption[]>;
  placeholder?: string;
  minChars?: number;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** List states, for a search over something other than districts. */
  searchingText?: string;
  emptyText?: string;
}) {
  const [query, setQuery] = React.useState(value?.label ?? "");
  const [items, setItems] = React.useState<DistrictOption[]>(value ? [value] : []);
  const [loading, setLoading] = React.useState(false);
  // A search may refuse with a reason worth showing (e.g. no provider key).
  const [failed, setFailed] = React.useState("");

  // Keep the input in step when the parent replaces the value (swap, reset).
  React.useEffect(() => {
    setQuery(value?.label ?? "");
    if (value) setItems((current) => (current.some((item) => item.id === value.id) ? current : [value, ...current]));
  }, [value]);

  React.useEffect(() => {
    const term = query.trim();
    if (term.length < minChars || term === value?.label) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed("");
      search(term, controller.signal)
        .then((next) => setItems(next))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setItems([]);
          setFailed(error instanceof Error && error.message ? error.message : "Pencarian gagal. Coba lagi.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, minChars, search, value?.label]);

  // A modal dialog disables pointer events outside itself, so a popup
  // portaled to <body> would ignore every tap. Portal into the dialog instead.
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setContainer(anchorRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);

  const short = query.trim().length < minChars;
  return (
    <span ref={anchorRef} className="block">
      <Combobox
        items={items}
        filter={null}
        value={value}
        onValueChange={(next) => onChange((next as DistrictOption | null) ?? null)}
        inputValue={query}
        onInputValueChange={(next) => setQuery(next)}
        itemToStringLabel={(item: DistrictOption) => item.label}
        // The hidden form input carries the area id, not the whole object as JSON.
        itemToStringValue={(item: DistrictOption) => item.id}
        isItemEqualToValue={(item: DistrictOption, current: DistrictOption) => item.id === current.id}
        disabled={disabled}
      >
        <ComboboxInput
          id={id}
          className="w-full"
          placeholder={placeholder}
          showClear={Boolean(value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
        />
        <ComboboxContent container={container ?? undefined}>
          <ComboboxEmpty>
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {searchingText}
              </span>
            ) : failed ? (
              failed
            ) : short ? (
              `Ketik minimal ${minChars} huruf.`
            ) : (
              emptyText
            )}
          </ComboboxEmpty>
          <ComboboxList>
            {(item: DistrictOption) => (
              <ComboboxItem key={item.id} value={item} className="min-h-11 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.label}</span>
                  {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </span>
  );
}
