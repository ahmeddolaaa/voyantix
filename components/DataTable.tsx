"use client";

import type { ReactNode } from "react";

/**
 * SHARED DATA TABLE
 * ---------------------------------------------------------------------------
 * Presentation only. It does not fetch, filter, paginate or sort anything.
 *
 * Sorting is CONTROLLED by the parent: the table reports that a header was
 * activated and renders whatever order it is handed. That one decision is
 * what lets the same component serve a small client-sorted master-data list
 * today and a server-sorted, server-paginated list later without touching
 * anything inside here.
 *
 * Real <table> markup throughout — a grid rebuilt from divs would lose the
 * row/column semantics that screen readers and keyboard users rely on.
 * ---------------------------------------------------------------------------
 */

export type SortDirection = "asc" | "desc";

export type SortState = {
  key: string;
  direction: SortDirection;
};

export type Column<T> = {
  /** Stable identifier, also used as the sort key. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Numeric and action columns usually read better trailing. */
  align?: "start" | "end";
  width?: string;
  sortable?: boolean;
  /** Drop this column on narrow viewports. Lowest-value columns first. */
  hideBelow?: "md" | "lg";
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Describes the table for assistive technology. Visually hidden. */
  caption: string;
  loading?: boolean;
  /** Shown when there are no rows and loading is false. */
  empty?: ReactNode;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
};

const hideClass = {
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

function nextDirection(
  column: string,
  sort: SortState | undefined
): SortDirection {
  if (sort?.key !== column) return "asc";
  return sort.direction === "asc" ? "desc" : "asc";
}

function ariaSort(column: string, sort: SortState | undefined) {
  if (sort?.key !== column) return "none" as const;
  return sort.direction === "asc"
    ? ("ascending" as const)
    : ("descending" as const);
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    getRowId,
    caption,
    loading,
    empty,
    sort,
    onSortChange,
  } = props;

  if (!loading && rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div
      className="overflow-x-auto rounded-lg"
      style={{ border: "1px solid var(--line)", background: "var(--card)" }}
    >
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr style={{ borderBottom: "1px solid var(--line)" }}>
            {columns.map((c) => {
              const alignClass = c.align === "end" ? "text-right" : "text-left";
              const responsive = c.hideBelow ? hideClass[c.hideBelow] : "";
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.sortable ? ariaSort(c.key, sort) : undefined}
                  className={`px-4 py-2.5 font-medium text-[11.5px] ${alignClass} ${responsive}`}
                  style={{ color: "var(--steel)", width: c.width }}
                >
                  {c.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSortChange({
                          key: c.key,
                          direction: nextDirection(c.key, sort),
                        })
                      }
                      className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)] rounded-sm"
                      style={{ color: "inherit" }}
                    >
                      {c.header}
                      <span aria-hidden="true" style={{ opacity: sort?.key === c.key ? 1 : 0.3 }}>
                        {sort?.key === c.key && sort.direction === "desc" ? "\u2193" : "\u2191"}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading
            ? // Skeleton rows keep the table's height stable while data
              // arrives, so the page does not jump under the pointer.
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`skeleton-${i}`} style={{ borderTop: "1px solid var(--line-soft)" }}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-3 ${c.hideBelow ? hideClass[c.hideBelow] : ""}`}
                    >
                      <div
                        className="h-3 rounded"
                        style={{ background: "var(--line-soft)", width: "70%" }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={getRowId(row)}
                  style={{ borderTop: "1px solid var(--line-soft)" }}
                >
                  {columns.map((c) => {
                    const alignClass =
                      c.align === "end" ? "text-right" : "text-left";
                    const responsive = c.hideBelow ? hideClass[c.hideBelow] : "";
                    return (
                      <td
                        key={c.key}
                        className={`px-4 py-3 ${alignClass} ${responsive}`}
                        style={{ color: "var(--ink)" }}
                      >
                        {c.render(row)}
                      </td>
                    );
                  })}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
