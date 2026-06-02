import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "仓库货物管理系统",
  description: "面向仓库和销售人员货物归属的条码库存管理系统"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
