import * as React from "react";

import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  /** When "Batal" would read as the action itself (setting a status to Batal). */
  cancelLabel?: string;
  /** For a confirmation that is not a deletion, such as a received payment. */
  tone?: "destructive" | "default";
};

/**
 * A promise-returning confirmation for destructive admin actions (A-305),
 * replacing `window.confirm`: the browser dialog could not be styled, named
 * no consequence in the admin's type, and on mobile read as a system error.
 * Call sites stay one line — `if (!(await confirm({...}))) return;` — and
 * render `dialog` once.
 */
export function useConfirm() {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolver = React.useRef<((value: boolean) => void) | null>(null);

  const settle = React.useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = React.useCallback((next: ConfirmOptions) => {
    // A second request while one is open answers the first as "no".
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          <DialogDescription>{options?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => settle(false)}>
            {options?.cancelLabel ?? "Batal"}
          </Button>
          <Button type="button" variant={options?.tone ?? "destructive"} onClick={() => settle(true)}>
            {options?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
