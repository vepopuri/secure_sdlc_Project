/** Deloitte palette and the sequential (single-hue, light -> dark) maturity ramp. */
export const BRAND = {
  green: "#86BC25",
  green6: "#26890D",
  green7: "#046A38",
  black: "#000000",
  muted: "#6E6E73",
  line: "#D2D2D7",
};

// Sequential ramp for maturity: one hue, monotonic lightness. Cells always print their value,
// so colour is never the only encoding.
const RAMP = [
  { at: 0.0, bg: "#F1F6E6", fg: "#1D1D1F" },
  { at: 0.2, bg: "#DCEBC0", fg: "#1D1D1F" },
  { at: 0.4, bg: "#B5D77A", fg: "#1D1D1F" },
  { at: 0.6, bg: "#86BC25", fg: "#000000" },
  { at: 0.8, bg: "#26890D", fg: "#FFFFFF" },
  { at: 0.95, bg: "#046A38", fg: "#FFFFFF" },
];

export const NOT_ASSESSED = { bg: "#EDEDF0", fg: "#6E6E73" };

export function heat(score: number | null, min: number, max: number): { bg: string; fg: string } {
  if (score === null || Number.isNaN(score)) return NOT_ASSESSED;
  const n = max > min ? (score - min) / (max - min) : 0;
  let pick = RAMP[0];
  for (const step of RAMP) if (n >= step.at - 1e-9) pick = step;
  return pick;
}

export const HEAT_LEGEND = RAMP;
