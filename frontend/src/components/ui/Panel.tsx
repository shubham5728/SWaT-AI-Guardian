import type { ReactNode } from "react";

interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Optional element rendered on the right of the header (e.g. a badge). */
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** Section container used across panels — consistent header + matte body. */
export function Panel({
  title,
  subtitle,
  action,
  className = "",
  bodyClassName = "",
  children,
}: PanelProps) {
  return (
    <section className={`flex min-h-0 flex-col ${className}`}>
      {(title || action) && (
        <header className="mb-2 flex items-center justify-between gap-2">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-wide text-text-strong">
                {title}
              </h2>
            )}
            {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
