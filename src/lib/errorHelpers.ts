const MAX_DETAIL_LENGTH = 400;

const stringify = (value: unknown): string => {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const truncate = (value: string): string =>
  value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}…` : value;

export function describeError(error: unknown): string {
  if (!error) {
    return "unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message || error.name || "Error");
  }

  const anyErr = error as Record<string, any>;
  const status =
    anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status ?? anyErr?.response?.statusCode;
  if (status) {
    parts.push(`status=${status}`);
  }

  const code = anyErr?.code;
  if (code) {
    parts.push(`code=${code}`);
  }

  const method = anyErr?.method ?? anyErr?.response?.config?.method ?? anyErr?.config?.method;
  const url = anyErr?.url ?? anyErr?.response?.config?.url ?? anyErr?.config?.url;
  if (method || url) {
    parts.push(`request=${[method, url].filter(Boolean).join(" ")}`);
  }

  const body =
    anyErr?.response?.data ??
    anyErr?.response?.body ??
    anyErr?.body ??
    anyErr?.responseBody ??
    anyErr?.responseText;
  if (body) {
    parts.push(`response=${truncate(stringify(body))}`);
  }

  if (parts.length === 0) {
    return truncate(stringify(error));
  }

  return parts.join(" | ");
}

export function wrapError(context: string, error: unknown): Error {
  const detail = describeError(error);
  const message =
    detail && detail !== "unknown error" ? `${context}: ${detail}` : `${context}: unknown error`;
  const cause = error instanceof Error ? error : undefined;
  const wrapped = new Error(message, cause ? { cause } : undefined);

  if (cause?.stack) {
    wrapped.stack = cause.stack;
  }

  if (error && typeof error === "object") {
    for (const key of Object.keys(error as Record<string, unknown>)) {
      (wrapped as any)[key] = (error as any)[key];
    }
  }

  return wrapped;
}
