import { describe, expect, it } from "vitest";
import {
  clampBoardPosition,
  fallbackBoardPosition,
  normalizeBoardPosition,
  resolveBoardPosition,
  serializeBoardPosition,
} from "./board-position";

describe("Board position contract", () => {
  it("accepts finite normalized payload coordinates and serializes them", () => {
    const position = normalizeBoardPosition({ positionX: 0.7, positionY: 0.3 });

    expect(position).toEqual({ x: 0.7, y: 0.3 });
    expect(serializeBoardPosition(position!)).toEqual({ positionX: 0.7, positionY: 0.3 });
  });

  it("rejects missing, non-finite, and out-of-range coordinates", () => {
    expect(normalizeBoardPosition({ positionX: 0.2 })).toBeNull();
    expect(normalizeBoardPosition({ positionX: Number.NaN, positionY: 0.2 })).toBeNull();
    expect(normalizeBoardPosition({ positionX: -0.01, positionY: 0.2 })).toBeNull();
    expect(normalizeBoardPosition({ positionX: 0.2, positionY: 1.01 })).toBeNull();
  });

  it("clamps a dragged position to measured card bounds", () => {
    expect(clampBoardPosition({ x: 0.9, y: -0.2 }, { maxX: 0.72, maxY: 0.84 })).toEqual({ x: 0.72, y: 0 });
  });

  it("gives legacy notes deterministic non-overlapping fallback slots", () => {
    const first = fallbackBoardPosition(0, 0);
    const second = fallbackBoardPosition(1, 1);

    expect(first).not.toEqual(second);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(second.y).toBeLessThanOrEqual(1);
    expect(resolveBoardPosition(null, null, 1, 1)).toEqual(second);
    expect(resolveBoardPosition(0.66, 0.24, 1, 1)).toEqual({ x: 0.66, y: 0.24 });
  });
});
