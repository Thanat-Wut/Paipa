export const LOBBY_PRESET_KEYS = ["cozy", "cabin", "beach", "chill"] as const;

export type LobbyPresetKey = (typeof LOBBY_PRESET_KEYS)[number];
export type LobbyPosition = { x: number; y: number };
export type LobbyPositionBounds = { maxX: number; maxY: number };
export type LobbyRosterMember = { userId: string; joinedAt: string };

export type LobbyMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  position: LobbyPosition;
};

export type LobbyBackground = {
  kind: "preset" | "custom";
  presetKey: LobbyPresetKey | null;
  backgroundUrl: string | null;
};

export type LobbyResponse = {
  tripId: string;
  background: LobbyBackground;
  members: LobbyMember[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function normalizeLobbyPosition(value: unknown): LobbyPosition | null {
  if (!isRecord(value) || !normalizedCoordinate(value.positionX) || !normalizedCoordinate(value.positionY)) return null;
  return { x: value.positionX, y: value.positionY };
}

export function clampLobbyPosition(position: LobbyPosition, bounds: LobbyPositionBounds): LobbyPosition {
  const maxX = Number.isFinite(bounds.maxX) ? Math.min(1, Math.max(0, bounds.maxX)) : 0;
  const maxY = Number.isFinite(bounds.maxY) ? Math.min(1, Math.max(0, bounds.maxY)) : 0;
  const x = Number.isFinite(position.x) ? position.x : 0;
  const y = Number.isFinite(position.y) ? position.y : 0;
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  };
}

export function fallbackLobbyPosition(rosterIndex: number): LobbyPosition {
  const index = Number.isFinite(rosterIndex) ? Math.max(0, Math.floor(rosterIndex)) : 0;
  const column = index % 4;
  const row = Math.floor(index / 4) % 4;
  return {
    x: Math.min(0.74, 0.04 + column * 0.23),
    y: Math.min(0.78, 0.05 + row * 0.24),
  };
}

export function resolveLobbyPosition(positionX: number | null, positionY: number | null, rosterIndex: number): LobbyPosition {
  if (normalizedCoordinate(positionX) && normalizedCoordinate(positionY)) return { x: positionX, y: positionY };
  return fallbackLobbyPosition(rosterIndex);
}

export function compareLobbyRosterMembers(a: LobbyRosterMember, b: LobbyRosterMember) {
  if (a.joinedAt < b.joinedAt) return -1;
  if (a.joinedAt > b.joinedAt) return 1;
  if (a.userId < b.userId) return -1;
  if (a.userId > b.userId) return 1;
  return 0;
}

export function orderLobbyRosterMembers<T extends LobbyRosterMember>(members: T[]): T[] {
  return [...members].sort(compareLobbyRosterMembers);
}
