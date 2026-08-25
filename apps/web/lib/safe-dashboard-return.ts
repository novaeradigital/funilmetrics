const internalOrigin = "https://funil-metrics.invalid";

export function safeDashboardReturn(value: string) {
  if (
    !value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "/dashboard";
  }
  try {
    const parsed = new URL(value, internalOrigin);
    if (
      parsed.origin !== internalOrigin ||
      (parsed.pathname !== "/dashboard" &&
        !parsed.pathname.startsWith("/dashboard/"))
    ) {
      return "/dashboard";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
  }
}
