import { NextResponse } from "next/server";

import { getPrisma } from "@/lib/db";
import type { HealthStatus } from "@/lib/types";
import { apiContractVersion, webVersion } from "@/lib/version";

export async function GET() {
  let database: HealthStatus["database"] = "ok";
  try {
    await getPrisma().$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }

  const data: HealthStatus = {
    status: database === "ok" ? "ok" : "error",
    database,
    webVersion,
    apiContractVersion,
    serverTime: new Date().toISOString()
  };
  return NextResponse.json({ data }, { status: data.status === "ok" ? 200 : 503 });
}
