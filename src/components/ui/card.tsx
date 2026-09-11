import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return (
    <section
      className={cn(
        "glass-panel",
        className,
      )}
    >
      {children}
    </section>
  );
}

type CardHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function CardHeader({ title, description, action }: CardHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b hairline px-5 py-4 sm:flex-nowrap">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ children, className }: CardProps) {
  return <div className={cn("px-5 py-5", className)}>{children}</div>;
}
