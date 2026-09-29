export const MEMORY_TEMPLATE_KEYS = [
  "photobooth_strip",
  "polaroid_board",
  "scrapbook_page",
  "travel_postcard",
] as const;

export type MemoryTemplateKey = (typeof MEMORY_TEMPLATE_KEYS)[number];

export const MEMORY_SLOT_KEYS = [
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
] as const;

export type MemorySlotKey = (typeof MEMORY_SLOT_KEYS)[number];

export type MemoryPlacement = {
  focusX: number;
  focusY: number;
  scale: number;
};

export type MemorySlotDefinition = {
  key: MemorySlotKey;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
};

export type MemoryTemplateDefinition = {
  key: MemoryTemplateKey;
  label: string;
  slots: readonly MemorySlotDefinition[];
};

const MEMORY_TEMPLATE_LABELS: Record<MemoryTemplateKey, string> = {
  photobooth_strip: "Photobooth Strip",
  polaroid_board: "Polaroid Board",
  scrapbook_page: "Scrapbook Page",
  travel_postcard: "Travel Postcard",
};

type SlotGeometry = readonly [x: number, y: number, width: number, height: number];

function defineSlots(geometry: readonly SlotGeometry[]): readonly MemorySlotDefinition[] {
  return geometry.map(([x, y, width, height], index) => ({
    key: MEMORY_SLOT_KEYS[index],
    x,
    y,
    width,
    height,
    aspectRatio: width / height,
  }));
}

const PHOTOBOOTH_STRIP_GEOMETRY: readonly SlotGeometry[] = [
  [0.08, 0.04, 0.38, 0.15],
  [0.54, 0.04, 0.38, 0.15],
  [0.08, 0.21, 0.38, 0.15],
  [0.54, 0.21, 0.38, 0.15],
  [0.08, 0.38, 0.38, 0.15],
  [0.54, 0.38, 0.38, 0.15],
  [0.08, 0.55, 0.38, 0.15],
  [0.54, 0.55, 0.38, 0.15],
  [0.08, 0.72, 0.38, 0.15],
  [0.54, 0.72, 0.38, 0.15],
] as const;

const POLAROID_BOARD_GEOMETRY: readonly SlotGeometry[] = [
  [0.04, 0.08, 0.15, 0.34],
  [0.23, 0.08, 0.15, 0.34],
  [0.42, 0.08, 0.15, 0.34],
  [0.61, 0.08, 0.15, 0.34],
  [0.80, 0.08, 0.15, 0.34],
  [0.04, 0.55, 0.15, 0.34],
  [0.23, 0.55, 0.15, 0.34],
  [0.42, 0.55, 0.15, 0.34],
  [0.61, 0.55, 0.15, 0.34],
  [0.80, 0.55, 0.15, 0.34],
] as const;

const SCRAPBOOK_PAGE_GEOMETRY: readonly SlotGeometry[] = [
  [0.05, 0.05, 0.28, 0.24],
  [0.36, 0.05, 0.28, 0.24],
  [0.67, 0.05, 0.28, 0.24],
  [0.05, 0.34, 0.43, 0.24],
  [0.52, 0.34, 0.43, 0.24],
  [0.05, 0.63, 0.28, 0.32],
  [0.36, 0.63, 0.28, 0.32],
  [0.67, 0.63, 0.28, 0.15],
  [0.67, 0.80, 0.13, 0.15],
  [0.82, 0.80, 0.13, 0.15],
] as const;

const TRAVEL_POSTCARD_GEOMETRY: readonly SlotGeometry[] = [
  [0.05, 0.07, 0.27, 0.22],
  [0.36, 0.07, 0.27, 0.22],
  [0.67, 0.07, 0.28, 0.22],
  [0.05, 0.34, 0.43, 0.26],
  [0.52, 0.34, 0.43, 0.26],
  [0.05, 0.65, 0.19, 0.28],
  [0.28, 0.65, 0.19, 0.28],
  [0.51, 0.65, 0.19, 0.28],
  [0.74, 0.65, 0.10, 0.13],
  [0.87, 0.65, 0.08, 0.13],
] as const;

export const MEMORY_TEMPLATES: Readonly<Record<MemoryTemplateKey, MemoryTemplateDefinition>> = {
  photobooth_strip: {
    key: "photobooth_strip",
    label: MEMORY_TEMPLATE_LABELS.photobooth_strip,
    slots: defineSlots(PHOTOBOOTH_STRIP_GEOMETRY),
  },
  polaroid_board: {
    key: "polaroid_board",
    label: MEMORY_TEMPLATE_LABELS.polaroid_board,
    slots: defineSlots(POLAROID_BOARD_GEOMETRY),
  },
  scrapbook_page: {
    key: "scrapbook_page",
    label: MEMORY_TEMPLATE_LABELS.scrapbook_page,
    slots: defineSlots(SCRAPBOOK_PAGE_GEOMETRY),
  },
  travel_postcard: {
    key: "travel_postcard",
    label: MEMORY_TEMPLATE_LABELS.travel_postcard,
    slots: defineSlots(TRAVEL_POSTCARD_GEOMETRY),
  },
};

const MEMORY_TEMPLATE_KEY_SET: ReadonlySet<string> = new Set(MEMORY_TEMPLATE_KEYS);
const MEMORY_SLOT_KEY_SET: ReadonlySet<string> = new Set(MEMORY_SLOT_KEYS);

export function isMemoryTemplateKey(value: unknown): value is MemoryTemplateKey {
  return typeof value === "string" && MEMORY_TEMPLATE_KEY_SET.has(value);
}

export function isMemorySlotKey(value: unknown): value is MemorySlotKey {
  return typeof value === "string" && MEMORY_SLOT_KEY_SET.has(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeMemoryPlacement(value: unknown): MemoryPlacement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Partial<Record<keyof MemoryPlacement, unknown>>;
  if (!isFiniteNumber(candidate.focusX) || candidate.focusX < 0 || candidate.focusX > 1) return null;
  if (!isFiniteNumber(candidate.focusY) || candidate.focusY < 0 || candidate.focusY > 1) return null;
  if (!isFiniteNumber(candidate.scale) || candidate.scale < 1 || candidate.scale > 1.35) return null;

  return {
    focusX: candidate.focusX,
    focusY: candidate.focusY,
    scale: candidate.scale,
  };
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function clampMemoryPlacement(value: MemoryPlacement): MemoryPlacement {
  return {
    focusX: clamp(value.focusX, 0, 1, 0.5),
    focusY: clamp(value.focusY, 0, 1, 0.5),
    scale: clamp(value.scale, 1, 1.35, 1),
  };
}
