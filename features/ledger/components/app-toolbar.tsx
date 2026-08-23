"use client";

import { useEffect, useRef } from "react";
import type { ToolbarGroup } from "../types";

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card min-w-0 px-3 py-2.5">
      <p className="text-xs font-semibold text-base-content/60">{label}</p>
      <p className="mt-1 truncate text-lg font-bold sm:text-xl" title={value}>
        {value}
      </p>
    </div>
  );
}

export function AppToolbar({
  groups,
  compact = false,
}: {
  groups: ToolbarGroup[];
  compact?: boolean;
}) {
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const activeItemId = groups.flatMap((group) => group.items).find((item) => item.active)?.id;

  useEffect(() => {
    if (compact && activeItemId) {
      activeItemRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [activeItemId, compact]);

  return (
    <nav
      className={compact ? "app-toolbar app-toolbar-compact" : "app-toolbar"}
      aria-label="应用工具栏"
    >
      {groups.map((group) => (
        <section className="toolbar-group" key={group.id} aria-label={group.label}>
          <p>{group.label}</p>
          <div className="toolbar-items">
            {group.items.map((item) => (
              <button
                className={item.active ? "active" : ""}
                type="button"
                key={item.id}
                ref={compact && item.active ? activeItemRef : undefined}
                onClick={item.onSelect}
                aria-pressed={item.active}
                title={item.label}
              >
                <span className="toolbar-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <strong>{item.label}</strong>
                {item.badge !== undefined ? <small>{item.badge}</small> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}
