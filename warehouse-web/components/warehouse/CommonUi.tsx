"use client";

import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="flex min-h-[150px] flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-work shadow-sm">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
        {value}
      </div>
    </div>
  );
}

export function FieldSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
  inline = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "flex items-center gap-2" : undefined}>
      {label ? <label className="label">{label}</label> : null}
      <select className={`field ${inline ? "w-auto min-w-[96px]" : ""}`} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

export function SectionHeader({
  icon: Icon,
  title,
  compact = false
}: {
  icon: LucideIcon;
  title: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "border-b border-slate-200 px-4 py-3"}`}>
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-work">
        <Icon className="h-4 w-4" />
      </div>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
    </div>
  );
}

export function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
      {label}
    </span>
  );
}

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
      <span className="text-xs text-muted">显示 {start}-{end} / {total}</span>
      <div className="flex items-center gap-2">
        <button className="secondary-button h-9 px-3" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          {page} / {totalPages}
        </span>
        <button className="secondary-button h-9 px-3" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button>
      </div>
    </div>
  );
}
