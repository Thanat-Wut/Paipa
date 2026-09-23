export type PaipaIdentity = {
  id: string;
  displayName: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPaipaUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parsePaipaIdentity(value: unknown): PaipaIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as { id?: unknown; displayName?: unknown };
  if (!isPaipaUuid(candidate.id)) return null;
  if (typeof candidate.displayName !== "string") return null;

  const displayName = candidate.displayName.trim();
  if (displayName.length < 1 || displayName.length > 60) return null;

  return { id: candidate.id, displayName };
}

export function createPaipaIdentity(displayName: string): PaipaIdentity {
  const trimmedName = displayName.trim();
  if (trimmedName.length < 1 || trimmedName.length > 60) {
    throw new Error("Display name must be between 1 and 60 characters");
  }

  return {
    id: crypto.randomUUID(),
    displayName: trimmedName,
  };
}
