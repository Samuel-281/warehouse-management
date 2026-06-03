import { ok } from "@/lib/api-response";

function parseNotes(value: string | undefined) {
  if (!value) return [];
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET() {
  const versionCode = Number.parseInt(process.env.PDA_APP_VERSION_CODE ?? "1", 10);

  return ok({
    versionCode: Number.isFinite(versionCode) ? versionCode : 1,
    versionName: process.env.PDA_APP_VERSION_NAME?.trim() || "0.1.0",
    apkUrl: process.env.PDA_APP_APK_URL?.trim() || null,
    notes: parseNotes(process.env.PDA_APP_RELEASE_NOTES),
    publishedAt: process.env.PDA_APP_RELEASED_AT?.trim() || null,
    forceUpdate: process.env.PDA_APP_FORCE_UPDATE === "true"
  });
}
