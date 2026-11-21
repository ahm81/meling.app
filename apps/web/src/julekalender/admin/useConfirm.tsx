import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Pending = {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};

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

type Choice<T> = { label: string; value: T };
type PendingChoice<T> = {
  message: string;
  options: Choice<T>[];
  resolve: (value: T | null) => void;
};

/**
 * Like useConfirm, but with any number of buttons. `choose` resolves to the chosen option's value, or null
 * when cancelled (Escape). Render `dialog` somewhere in the page.
 */
export function useChoice<T>(): {
  choose: (message: string, options: Choice<T>[]) => Promise<T | null>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<PendingChoice<T> | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  const choose = useCallback(
    (message: string, options: Choice<T>[]) =>
      new Promise<T | null>((resolve) => setPending({ message, options, resolve })),
    [],
  );

  useEffect(() => {
    if (pending && ref.current && !ref.current.open) ref.current.showModal();
  }, [pending]);

  const answer = (value: T | null) => {
    if (!pending) return;
    pending.resolve(value);
    setPending(null);
    if (ref.current?.open) ref.current.close();
  };

  const dialog = pending ? (
    <dialog ref={ref} className="confirm" onCancel={(e) => (e.preventDefault(), answer(null))}>
      <p>{pending.message}</p>
      <div className="toolbar">
        {pending.options.map((o, i) => (
          <button
            key={o.label}
            className={i === 0 ? "primary" : undefined}
            autoFocus={i === 0}
            onClick={() => answer(o.value)}
          >
            {o.label}
          </button>
        ))}
        <button onClick={() => answer(null)}>Avbryt</button>
      </div>
    </dialog>
  ) : null;

  return { choose, dialog };
}
