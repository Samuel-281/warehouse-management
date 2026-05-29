"use client";

import { ArrowLeftRight, Barcode, Boxes, Search, Undo2 } from "lucide-react";
import Link from "next/link";

const actions = [
  { label: "入库扫码", icon: Barcode },
  { label: "挪仓扫码", icon: ArrowLeftRight },
  { label: "销售退回", icon: Undo2 },
  { label: "库存查询", icon: Search }
];

export default function PdaSketch() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto flex min-h-[760px] max-w-[390px] flex-col rounded-[28px] border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">PDA 草图入口</p>
            <h1 className="text-xl font-semibold">仓库扫码台</h1>
          </div>
          <Link
            href="/"
            className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200"
          >
            返回电脑端
          </Link>
        </header>

        <section className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <label className="mb-2 block text-xs font-semibold text-slate-300">条码扫描框</label>
          <div className="flex h-14 items-center gap-3 rounded-md border border-emerald-500 bg-slate-950 px-3">
            <Barcode className="h-6 w-6 text-emerald-300" />
            <span className="text-sm text-slate-500">等待硬件扫码输入...</span>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                className="flex h-28 flex-col items-center justify-center gap-3 rounded-lg border border-slate-700 bg-slate-800 text-sm font-semibold text-slate-100"
              >
                <Icon className="h-7 w-7 text-emerald-300" />
                {action.label}
              </button>
            );
          })}
        </section>

        <section className="mt-4 flex-1 rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-semibold">当前扫描清单</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="rounded-md bg-slate-950 px-3 py-2 text-slate-300">HJ202605290001</div>
            <div className="rounded-md bg-slate-950 px-3 py-2 text-slate-300">BJ202605290001</div>
            <div className="rounded-md border border-dashed border-slate-600 px-3 py-8 text-center text-slate-500">
              后续版本接入完整业务提交
            </div>
          </div>
        </section>

        <footer className="mt-4 grid grid-cols-2 gap-3">
          <button className="h-11 rounded-md border border-slate-700 text-sm font-semibold text-slate-200">
            清空
          </button>
          <button className="h-11 rounded-md bg-emerald-500 text-sm font-semibold text-slate-950">
            提交
          </button>
        </footer>
      </div>
    </main>
  );
}
