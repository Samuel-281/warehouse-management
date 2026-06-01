export function shouldUseSecureSessionCookie() {
  if (process.env.SESSION_COOKIE_SECURE === "true") return true;
  if (process.env.SESSION_COOKIE_SECURE === "false") return false;

  const publicAppUrl = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  return publicAppUrl.startsWith("https://");
}
