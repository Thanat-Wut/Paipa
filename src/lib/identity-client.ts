import { parsePaipaIdentity, type PaipaIdentity } from "./identity";

const STORAGE_KEY = "paipa_identity";

export function readPaipaIdentity(): PaipaIdentity | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parsePaipaIdentity(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writePaipaIdentity(identity: PaipaIdentity): void {
  const parsed = parsePaipaIdentity(identity);
  if (!parsed) throw new Error("Invalid Paipa identity");
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    throw new Error("Unable to save Paipa identity in this browser");
  }
}
