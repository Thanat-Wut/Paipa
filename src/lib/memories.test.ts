import { describe, expect, it } from "vitest";
import {
  clampMemoryPlacement,
  isMemorySlotKey,
  isMemoryTemplateKey,
  MEMORY_SLOT_KEYS,
  MEMORY_TEMPLATES,
  MEMORY_TEMPLATE_KEYS,
  normalizeMemoryPlacement,
} from "./memories";

describe("Memories template contract", () => {
  it("exposes exactly the four approved template keys and labels", () => {
    expect(MEMORY_TEMPLATE_KEYS).toEqual([
      "photobooth_strip",
      "polaroid_board",
      "scrapbook_page",
      "travel_postcard",
    ]);

    expect(MEMORY_TEMPLATE_KEYS.map((key) => MEMORY_TEMPLATES[key].label)).toEqual([
      "Photobooth Strip",
      "Polaroid Board",
      "Scrapbook Page",
      "Travel Postcard",
    ]);
  });

  it("defines ten stable slots with deterministic, bounded geometry for every template", () => {
    expect(MEMORY_SLOT_KEYS).toEqual([
      "slot_01",
      "slot_02",
      "slot_03",
      "slot_04",
      "slot_05",
      "slot_06",
      "slot_07",
      "slot_08",
      "slot_09",
      "slot_10",
    ]);

    for (const templateKey of MEMORY_TEMPLATE_KEYS) {
      const template = MEMORY_TEMPLATES[templateKey];
      expect(template.slots).toHaveLength(10);
      expect(template.slots.map((slot) => slot.key)).toEqual(MEMORY_SLOT_KEYS);

      for (const slot of template.slots) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.width).toBeGreaterThan(0);
        expect(slot.height).toBeGreaterThan(0);
        expect(slot.x + slot.width).toBeLessThanOrEqual(1);
        expect(slot.y + slot.height).toBeLessThanOrEqual(1);
        expect(slot.aspectRatio).toBeGreaterThan(0);
        expect(slot.aspectRatio).toBeCloseTo(slot.width / slot.height);
      }
    }

    expect(JSON.stringify(MEMORY_TEMPLATES)).toBe(JSON.stringify(MEMORY_TEMPLATES));
  });

  it("rejects arbitrary template and slot keys", () => {
    expect(isMemoryTemplateKey("freeform")).toBe(false);
    expect(isMemoryTemplateKey("SCRAPBOOK_PAGE")).toBe(false);
    expect(isMemoryTemplateKey(null)).toBe(false);
    expect(isMemorySlotKey("slot_11")).toBe(false);
    expect(isMemorySlotKey("slot_01 ")).toBe(false);
    expect(isMemorySlotKey(undefined)).toBe(false);
    expect(isMemoryTemplateKey("scrapbook_page")).toBe(true);
    expect(isMemorySlotKey("slot_10")).toBe(true);
  });
});

describe("Memories placement contract", () => {
  it("accepts only finite focus values in 0..1 and scale in 1..1.35", () => {
    expect(normalizeMemoryPlacement({ focusX: 0, focusY: 1, scale: 1 })).toEqual({
      focusX: 0,
      focusY: 1,
      scale: 1,
    });
    expect(normalizeMemoryPlacement({ focusX: 0.5, focusY: 0.25, scale: 1.35 })).toEqual({
      focusX: 0.5,
      focusY: 0.25,
      scale: 1.35,
    });
    expect(normalizeMemoryPlacement({ focusX: -0.01, focusY: 0.5, scale: 1 })).toBeNull();
    expect(normalizeMemoryPlacement({ focusX: 0.5, focusY: 1.01, scale: 1 })).toBeNull();
    expect(normalizeMemoryPlacement({ focusX: 0.5, focusY: 0.5, scale: 0.99 })).toBeNull();
    expect(normalizeMemoryPlacement({ focusX: 0.5, focusY: 0.5, scale: 1.351 })).toBeNull();
    expect(normalizeMemoryPlacement({ focusX: Number.NaN, focusY: 0.5, scale: 1 })).toBeNull();
    expect(normalizeMemoryPlacement({ focusX: 0.5, focusY: Number.POSITIVE_INFINITY, scale: 1 })).toBeNull();
    expect(normalizeMemoryPlacement({ focusX: 0.5, focusY: 0.5 })).toBeNull();
    expect(normalizeMemoryPlacement(null)).toBeNull();
  });

  it("clamps client movement to the constrained placement ranges", () => {
    expect(clampMemoryPlacement({ focusX: -0.2, focusY: 1.2, scale: 2 })).toEqual({
      focusX: 0,
      focusY: 1,
      scale: 1.35,
    });
    expect(clampMemoryPlacement({ focusX: 0.4, focusY: 0.6, scale: 1.2 })).toEqual({
      focusX: 0.4,
      focusY: 0.6,
      scale: 1.2,
    });
  });
});
