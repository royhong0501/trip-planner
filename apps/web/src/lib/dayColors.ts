/** Morandi earth-tone palette: one colour per day (cycles if > 10 days). */
export const DAY_COLORS = [
  '#8B7355', // Day 1  – walnut
  '#7B8F9E', // Day 2  – dusty blue
  '#7B8B7B', // Day 3  – sage
  '#9E8B78', // Day 4  – warm sand
  '#9E7B8B', // Day 5  – dusty mauve
  '#8B9E8B', // Day 6  – muted green
  '#9E9078', // Day 7  – warm khaki
  '#7B8B9E', // Day 8  – slate
  '#9E7B7B', // Day 9  – dusty rose
  '#8B8B7B', // Day 10 – warm grey
] as const;

export const getDayColor = (dayIdx: number): string =>
  DAY_COLORS[dayIdx % DAY_COLORS.length];
