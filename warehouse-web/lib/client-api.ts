export type ApiResponse<T> = { data: T } | { error: string };

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ClientApiError) {
    if (error.message) return error.message;
    if (error.status === 401) return "登录状态已过期，请重新登录";
    if (error.status === 403) return "当前账号没有该操作权限";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function requestJson<T>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {}
): Promise<T> {
  const { body, headers, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...requestOptions,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !("data" in payload)) {
    throw new ClientApiError("error" in payload ? payload.error : "请求失败", response.status);
  }
  return payload.data;
}

export function getJson<T>(path: string, signal?: AbortSignal) {
  return requestJson<T>(path, { signal });
}

export function postJson<T>(path: string, body: unknown, signal?: AbortSignal) {
  return requestJson<T>(path, { method: "POST", body, signal });
}

export function patchJson<T>(path: string, body: unknown, signal?: AbortSignal) {
  return requestJson<T>(path, { method: "PATCH", body, signal });
}

export function deleteJson<T>(path: string, body?: unknown, signal?: AbortSignal) {
  return requestJson<T>(path, { method: "DELETE", body, signal });
}
