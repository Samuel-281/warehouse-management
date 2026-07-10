"use client";

import { Barcode, ScanLine, Trash2, X } from "lucide-react";

export type BarcodeReviewTone = "success" | "warning" | "error" | "neutral";
export type BarcodeReview = {
  tone: BarcodeReviewTone;
  label: string;
  detail?: string;
};

export function BarcodeCollector({
  title = "单件条码",
  description,
  input,
  setInput,
  barcodes,
  setBarcodes,
  onAdd,
  placeholder,
  reviewBarcode
}: {
  title?: string;
  description?: string;
  input: string;
  setInput: (value: string) => void;
  barcodes: string[];
  setBarcodes: (value: string[]) => void;
  onAdd: (input: string) => void;
  placeholder: string;
  reviewBarcode?: (barcode: string) => BarcodeReview;
}) {
  const reviews = reviewBarcode ? barcodes.map((barcode) => reviewBarcode(barcode)) : [];
  const invalidCount = reviews.filter((review) => review.tone === "error").length;
  const readyCount = reviewBarcode ? barcodes.length - invalidCount : barcodes.length;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-work shadow-sm">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">{title}</p>
              {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
            </div>
          </div>
          <span
            className={`rounded-md bg-white px-3 py-1.5 text-xs font-semibold shadow-sm ${
              invalidCount > 0 ? "text-danger" : "text-slate-600"
            }`}
          >
            {reviewBarcode ? `${readyCount} / ${barcodes.length} 可提交` : `${barcodes.length} 件`}
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <textarea
            className="field h-14 min-h-14 resize-none py-4 font-mono text-base"
            placeholder={placeholder}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAdd(input);
              }
            }}
          />
          <button className="primary-button h-14 shrink-0 sm:min-w-[104px]" onClick={() => onAdd(input)}>
            <Barcode className="h-4 w-4" />
            加入
          </button>
        </div>
      </div>

      <div className="min-h-[260px] rounded-md border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-700">条码清单 · {barcodes.length} 件</p>
          {barcodes.length > 0 ? (
            <button className="secondary-button h-8 px-2 text-xs" onClick={() => setBarcodes([])}>
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
          ) : null}
        </div>
        {barcodes.length === 0 ? (
          <div className="m-4 flex h-40 items-center justify-center rounded-md border border-dashed border-slate-300 text-sm text-slate-400">
            等待扫码录入
          </div>
        ) : (
          <div className="grid max-h-[380px] gap-2 overflow-y-auto p-4 sm:grid-cols-2">
            {barcodes.map((barcode) => {
              const review = reviewBarcode?.(barcode);
              return (
                <div
                  className={`rounded-md border px-3 py-2 text-sm ${barcodeCardClass(review?.tone ?? "neutral")}`}
                  key={barcode}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-slate-700">{barcode}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {review ? <BarcodeReviewBadge review={review} /> : null}
                      <button
                        aria-label={`移除条码 ${barcode}`}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-danger"
                        onClick={() => setBarcodes(barcodes.filter((entry) => entry !== barcode))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {review?.detail ? (
                    <p className={`mt-1 truncate text-xs ${review.tone === "error" ? "text-danger" : "text-muted"}`}>
                      {review.detail}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function BarcodeReviewBadge({ review }: { review: BarcodeReview }) {
  return (
    <span
      className={`rounded-md border px-2 py-1 text-[11px] font-semibold leading-none ${barcodeBadgeClass(
        review.tone
      )}`}
    >
      {review.label}
    </span>
  );
}

function barcodeCardClass(tone: BarcodeReviewTone) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50";
  if (tone === "warning") return "border-amber-200 bg-amber-50";
  if (tone === "error") return "border-red-200 bg-red-50";
  return "border-slate-200 bg-slate-50";
}

function barcodeBadgeClass(tone: BarcodeReviewTone) {
  if (tone === "success") return "border-emerald-200 bg-white text-work";
  if (tone === "warning") return "border-amber-200 bg-white text-amber";
  if (tone === "error") return "border-red-200 bg-white text-danger";
  return "border-slate-200 bg-white text-slate-500";
}
