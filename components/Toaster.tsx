"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import clsx from "clsx";

type ToastTone = "error" | "success" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  return context ?? { notify: () => {} };
}

const TONE_CLASS: Record<ToastTone, string> = {
  error: "border-destructive/50 bg-destructive/10 text-destructive",
  success: "border-emerald-500/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
  info: "border-sky-500/50 bg-sky-500/10 text-sky-900 dark:text-sky-100",
  warning: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, tone === "error" ? 7000 : 4000);
  }, []);

  const api = useMemo<ToastApi>(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              "animate-toast-in pointer-events-auto max-w-md rounded-2xl border bg-card px-3.5 py-2.5 text-sm text-card-foreground shadow-xl",
              TONE_CLASS[toast.tone],
            )}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
