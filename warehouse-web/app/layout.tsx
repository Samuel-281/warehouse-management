import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "仓库货物管理原型",
  description: "总仓、分仓和销售人员名下货物的条码流转原型"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
