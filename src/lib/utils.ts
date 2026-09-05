/** Joins conditional class names, dropping anything falsy. */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

/** Initials for an avatar placeholder, e.g. "Sample HM A" -> "SA". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";

  return `${first}${last}`.toUpperCase();
}
