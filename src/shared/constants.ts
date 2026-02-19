export const RAIDBOTS_TALENT_URL =
  "https://mimiron.raidbots.com/static/data/live/talents.json";

export const ICON_CDN_URL = "https://wow.zamimg.com/images/wow/icons/medium";

export const WOWHEAD_TOOLTIP_URL = "https://nether.wowhead.com/tooltip/spell";

export const MAX_PROFILESETS = 6399;

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const COUNT_THRESHOLDS = {
  green: 1000,
  yellow: MAX_PROFILESETS,
} as const;

export const SOLVER_DEBOUNCE_MS = 50;

// WoW talent point budgets per tree type (12.0 Midnight)
export const POINT_BUDGET_CLASS = 34;
export const POINT_BUDGET_SPEC = 34;
export const POINT_BUDGET_HERO = 13;

export const NODE_SIZE = 44;
export const NODE_GAP_X = 72;
export const NODE_GAP_Y = 72;
export const TREE_PADDING = 20;
