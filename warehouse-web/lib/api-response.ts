import { NextResponse } from "next/server";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function fail(error: unknown, status = 500) {
  const detail = error instanceof Error ? error.message : "系统暂时不可用";
  const responseStatus = error instanceof ApiError ? error.status : status;
  const message = detail.includes("DATABASE_URL")
    ? "数据库尚未配置或未启动，请先完成本地数据库初始化。"
    : detail;

  return NextResponse.json({ error: message }, { status: responseStatus });
}
