export const RAIDBOTS_TALENT_URL =
  "https://mimiron.raidbots.com/static/data/live/talents.json";

export const ICON_CDN_URL = "https://wow.zamimg.com/images/wow/icons/medium";

export const MAX_PROFILESETS = 6399;

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const COUNT_THRESHOLDS = {
  green: 1000,
  yellow: MAX_PROFILESETS,
} as const;

export const SOLVER_DEBOUNCE_MS = 200;

export const NODE_SIZE = 44;
export const NODE_GAP_X = 50;
export const NODE_GAP_Y = 72;
export const TREE_PADDING = 20;
