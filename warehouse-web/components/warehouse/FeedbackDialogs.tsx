"use client";

import { AlertCircle, Check, Info, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Toast } from "@/lib/types";

export type ResultDialog = {
  tone: "success" | "error";
  title: string;
  message: string;
};

export function ToastBox({ toast }: { toast: Toast }) {
  const toneClass =
    toast.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : toast.tone === "error"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-sky-200 bg-sky-50 text-sky-800";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
      <div className={`pointer-events-auto flex max-w-lg items-center gap-2 rounded-md border px-4 py-3 text-sm shadow-lg ${toneClass}`}>
        {toast.tone === "success" ? (
          <Check className="h-4 w-4 shrink-0" />
        ) : toast.tone === "error" ? (
          <AlertCircle className="h-4 w-4 shrink-0" />
        ) : (
          <Info className="h-4 w-4 shrink-0" />
        )}
        <span>{toast.message}</span>
      </div>
    </div>
  );
}

export function ResultDialogBox({ dialog, onClose }: { dialog: ResultDialog; onClose: () => void }) {
  const isSuccess = dialog.tone === "success";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 p-4">
      <section
        className={`w-full max-w-md rounded-md border bg-white p-5 shadow-2xl ${
          isSuccess ? "border-emerald-200" : "border-red-200"
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
              isSuccess ? "bg-emerald-50 text-work" : "bg-red-50 text-danger"
            }`}
          >
            {isSuccess ? <Check className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink">{dialog.title}</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{dialog.message}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭提示">
            <X className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

export type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
};

export function ConfirmDialog({
  dialog,
  busy = false,
  onCancel,
  onConfirm
}: {
  dialog: ConfirmDialogState | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4" role="presentation">
      <section className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl" role="dialog" aria-modal="true">
        <h2 className="text-base font-semibold text-ink">{dialog.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{dialog.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
          <button
            className={dialog.destructive ? "danger-button" : "primary-button"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "处理中" : dialog.confirmLabel ?? "确认"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ReasonDialog({
  title,
  message,
  confirmLabel,
  open,
  busy = false,
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  confirmLabel: string;
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;
  const valid = reason.trim().length >= 2;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4">
      <section className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl" role="dialog" aria-modal="true">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        <label className="label mt-4" htmlFor="maintenance-reason">处理原因</label>
        <textarea
          id="maintenance-reason"
          className="field min-h-24 resize-y"
          maxLength={200}
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="至少填写 2 个字符"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
          <button className="danger-button" onClick={() => onConfirm(reason.trim())} disabled={busy || !valid}>
            {busy ? "处理中" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
