export type BoardPosition = { x: number; y: number };

export type BoardPositionBounds = { maxX: number; maxY: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function normalizeBoardPosition(value: unknown): BoardPosition | null {
  if (!isRecord(value) || !normalizedCoordinate(value.positionX) || !normalizedCoordinate(value.positionY)) return null;
  return { x: value.positionX, y: value.positionY };
}

export function clampBoardPosition(position: BoardPosition, bounds: BoardPositionBounds): BoardPosition {
  const maxX = Number.isFinite(bounds.maxX) ? Math.min(1, Math.max(0, bounds.maxX)) : 0;
  const maxY = Number.isFinite(bounds.maxY) ? Math.min(1, Math.max(0, bounds.maxY)) : 0;
  const x = Number.isFinite(position.x) ? position.x : 0;
  const y = Number.isFinite(position.y) ? position.y : 0;
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  };
}

export function fallbackBoardPosition(sortOrder: number, renderIndex: number): BoardPosition {
  const order = Number.isFinite(sortOrder) ? Math.max(0, Math.floor(sortOrder)) : 0;
  const index = Number.isFinite(renderIndex) ? Math.max(0, Math.floor(renderIndex)) : 0;
  const slot = order + index;
  const column = slot % 4;
  const row = Math.floor(slot / 4) % 4;
  return {
    x: Math.min(0.74, 0.04 + column * 0.23),
    y: Math.min(0.78, 0.05 + row * 0.24),
  };
}

export function resolveBoardPosition(positionX: number | null, positionY: number | null, sortOrder: number, renderIndex: number): BoardPosition {
  if (normalizedCoordinate(positionX) && normalizedCoordinate(positionY)) return { x: positionX, y: positionY };
  return fallbackBoardPosition(sortOrder, renderIndex);
}

export function serializeBoardPosition(position: BoardPosition): { positionX: number; positionY: number } {
  return { positionX: position.x, positionY: position.y };
}
