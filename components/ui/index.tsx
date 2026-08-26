import { Loader2 } from "lucide-react";

import { Alert as UiAlert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Button as UiButton } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AllianceSlot } from "@/types/roster";

/** Alliance column colors — extra tokens, not part of the lime/stone theme. */
export const SLOT_THEME: Record<
  AllianceSlot,
  { label: string; text: string; border: string; bg: string; dot: string; accent: string }
> = {
  1: {
    label: "Alliance 1",
    text: "text-sky-700 dark:text-sky-300",
    border: "border-sky-500/40",
    bg: "bg-sky-500/10",
    dot: "bg-sky-500",
    accent: "accent-sky-500",
  },
  2: {
    label: "Alliance 2",
    text: "text-violet-700 dark:text-violet-300",
    border: "border-violet-500/40",
    bg: "bg-violet-500/10",
    dot: "bg-violet-500",
    accent: "accent-violet-500",
  },
  3: {
    label: "Alliance 3",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/10",
    dot: "bg-emerald-500",
    accent: "accent-emerald-500",
  },
};

type AppButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANT = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  className,
  asChild = false,
  ...rest
}: React.ComponentProps<"button"> & {
  variant?: AppButtonVariant;
  size?: "sm" | "md";
  asChild?: boolean;
}) {
  return (
    <UiButton
      variant={BUTTON_VARIANT[variant]}
      size={size === "sm" ? "sm" : "default"}
      className={className}
      asChild={asChild}
      {...rest}
    />
  );
}

export function Card({ className, ...rest }: React.ComponentProps<"div">) {
  return (
    <UiCard
      className={cn(
        "gap-0 py-0 shadow-xs border-2 border-foreground/30 ring-0 dark:border-transparent dark:ring-1 dark:ring-foreground/10",
        className,
      )}
      {...rest}
    />
  );
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <UiBadge variant="outline" className={cn("uppercase tracking-wide", className)}>
      {children}
    </UiBadge>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("font-heading text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase", className)}>
      {children}
    </h2>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const inputClass = cn(
  "h-9 w-full min-w-0 rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-sm transition-[color,box-shadow,background-color] outline-none",
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
);

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-3.5 animate-spin", className)} aria-hidden="true" />;
}

export function Alert({
  tone = "error",
  title,
  children,
}: {
  tone?: "error" | "warning" | "info" | "success";
  title?: string;
  children?: React.ReactNode;
}) {
  const tones = {
    error: "border-destructive/40 bg-destructive/10 text-destructive",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    info: "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
  } as const;

  return (
    <UiAlert variant={tone === "error" ? "destructive" : "default"} className={tones[tone]}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children ? (
        <AlertDescription className={title ? "mt-0.5 text-[13px] text-current/90" : "text-current"}>
          {children}
        </AlertDescription>
      ) : null}
    </UiAlert>
  );
}

export { Input };
