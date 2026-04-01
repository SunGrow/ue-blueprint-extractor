export type SlotPreset = Record<string, unknown>;

const SLOT_PRESETS: Record<string, SlotPreset> = {
  'center': { Anchors: { Minimum: { X: 0.5, Y: 0.5 }, Maximum: { X: 0.5, Y: 0.5 } }, Alignment: { X: 0.5, Y: 0.5 } },
  'fill': { Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 1, Y: 1 } }, Offsets: { Left: 0, Top: 0, Right: 0, Bottom: 0 } },
  'top-left': { Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } } },
  'top-right': { Anchors: { Minimum: { X: 1, Y: 0 }, Maximum: { X: 1, Y: 0 } }, Alignment: { X: 1, Y: 0 } },
  'bottom-left': { Anchors: { Minimum: { X: 0, Y: 1 }, Maximum: { X: 0, Y: 1 } }, Alignment: { X: 0, Y: 1 } },
  'bottom-right': { Anchors: { Minimum: { X: 1, Y: 1 }, Maximum: { X: 1, Y: 1 } }, Alignment: { X: 1, Y: 1 } },
  'top-stretch': { Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 1, Y: 0 } } },
  'bottom-stretch': { Anchors: { Minimum: { X: 0, Y: 1 }, Maximum: { X: 1, Y: 1 } }, Alignment: { X: 0, Y: 1 } },
  'left-stretch': { Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 1 } } },
  'right-stretch': { Anchors: { Minimum: { X: 1, Y: 0 }, Maximum: { X: 1, Y: 1 } }, Alignment: { X: 1, Y: 0 } },
};

export function resolveSlotPreset(slot: unknown): Record<string, unknown> {
  if (typeof slot === 'string') {
    const preset = SLOT_PRESETS[slot];
    if (!preset) throw new Error(`Unknown slot preset: "${slot}". Available: ${Object.keys(SLOT_PRESETS).join(', ')}`);
    return structuredClone(preset);
  }
  if (typeof slot === 'object' && slot !== null) return slot as Record<string, unknown>;
  return {};
}

export function getAvailableSlotPresets(): string[] {
  return Object.keys(SLOT_PRESETS);
}
