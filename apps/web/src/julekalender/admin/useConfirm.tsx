import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Pending = { message: string; confirmLabel: string; resolve: (ok: boolean) => void };

/**
 * An in-page replacement for window.confirm, which some embedded browsers answer with false at once
 * without showing anything. `confirm` resolves to true or false; render `dialog` somewhere in the page.
 */
export function useConfirm(): {
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const confirm = useCallback(
    (message: string, confirmLabel = "Fortsett") =>
      new Promise<boolean>((resolve) => setPending({ message, confirmLabel, resolve })),
    [],
  );

  useEffect(() => {
    if (pending && ref.current && !ref.current.open) ref.current.showModal();
  }, [pending]);

  const answer = (ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
    if (ref.current?.open) ref.current.close();
  };

  const dialog = pending ? (
    // Escape fires "cancel"; treat it as Avbryt.
    <dialog ref={ref} className="confirm" onCancel={(e) => (e.preventDefault(), answer(false))}>
      <p>{pending.message}</p>
      <div className="toolbar">
        <button onClick={() => answer(false)}>Avbryt</button>
        <button className="primary" autoFocus onClick={() => answer(true)}>
          {pending.confirmLabel}
        </button>
      </div>
    </dialog>
  ) : null;

  return { confirm, dialog };
}
