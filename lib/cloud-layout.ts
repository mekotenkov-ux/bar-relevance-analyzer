export const CLOUD_LAYOUT_WIDTH = 340;
export const CLOUD_LAYOUT_HEIGHT = 270;
export const CLOUD_LAYOUT_WORD_LIMIT = 54;
export const CLOUD_LAYOUT_MIN_FONT = 7;

const CLOUD_LAYOUT_EDGE = 4;
const CLOUD_LAYOUT_GAP = .75;
const CLOUD_LAYOUT_HORIZONTAL_PADDING = 6;
const CLOUD_LAYOUT_VERTICAL_PADDING = 4;
export const CLOUD_LAYOUT_WIDTH_SAFETY = 6;
const CLOUD_LAYOUT_MAX_CANDIDATES = 600;
const CLOUD_LAYOUT_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CLOUD_LAYOUT_CELL_SIZE = 24;

const CLOUD_LAYOUT_GRID_POINTS = (() => {
  const points: Array<{ left: number; top: number; distance: number; phase: number }> = [];
  const centerX = CLOUD_LAYOUT_WIDTH / 2;
  const centerY = CLOUD_LAYOUT_HEIGHT / 2;
  for (let top = CLOUD_LAYOUT_EDGE; top <= CLOUD_LAYOUT_HEIGHT - CLOUD_LAYOUT_EDGE; top += 3) {
    for (let left = CLOUD_LAYOUT_EDGE; left <= CLOUD_LAYOUT_WIDTH - CLOUD_LAYOUT_EDGE; left += 3) {
      const normalizedX = (left - centerX) / centerX;
      const normalizedY = (top - centerY) / centerY;
      points.push({
        left,
        top,
        distance: normalizedX * normalizedX + normalizedY * normalizedY,
        phase: Math.atan2(normalizedY, normalizedX),
      });
    }
  }
  return points.sort((left, right) => left.distance - right.distance || left.phase - right.phase);
})();

export type CloudLayoutWord = {
  key: string;
  word: string;
  frequency: number;
  sites?: number;
};

export type PackedCloudWord<T extends CloudLayoutWord = CloudLayoutWord> = {
  item: T;
  left: number;
  top: number;
  fontSize: number;
  width: number;
  height: number;
};

type Bounds = { left: number; top: number; right: number; bottom: number };

function codePointWidth(codePoint: string) {
  if (/\p{Mark}/u.test(codePoint)) return 0;
  if (/\s/u.test(codePoint)) return .32;
  if (/\p{Extended_Pictographic}/u.test(codePoint)) return 1.05;
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(codePoint)) return 1;
  if (/\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Tamil}|\p{Script=Thai}|\p{Script=Georgian}|\p{Script=Armenian}/u.test(codePoint)) return .68;
  if (/[ilI1|!.,:;'`]/u.test(codePoint)) return .3;
  if (/[mwMWЖШЩЮФ@%&]/u.test(codePoint)) return .84;
  if (/\p{Number}/u.test(codePoint)) return .56;
  if (/\p{Lu}/u.test(codePoint)) return .64;
  if ("-–—_()[]{}\\/".includes(codePoint)) return .42;
  return .55;
}

export function estimateCloudTextBox(word: string, fontSize: number) {
  const units = Array.from(word.normalize("NFC")).reduce((sum, codePoint) => sum + codePointWidth(codePoint), 0);
  return {
    width: Math.max(fontSize * .7, units * fontSize * 1.05 + CLOUD_LAYOUT_HORIZONTAL_PADDING + CLOUD_LAYOUT_WIDTH_SAFETY),
    height: fontSize * 1.05 + CLOUD_LAYOUT_VERTICAL_PADDING,
  };
}

export function cloudBaseFontSize(frequency: number, maxFrequency: number) {
  const safeFrequency = Number.isFinite(frequency) ? Math.max(0, frequency) : 0;
  const safeMaximum = Number.isFinite(maxFrequency) ? Math.max(.0001, maxFrequency) : .0001;
  const ratio = Math.min(1, safeFrequency / safeMaximum);
  return 8 + Math.pow(ratio, 1.05) * 26;
}

function boundsFor(left: number, top: number, width: number, height: number): Bounds {
  return { left: left - width / 2, top: top - height / 2, right: left + width / 2, bottom: top + height / 2 };
}

function isInside(bounds: Bounds) {
  return bounds.left >= CLOUD_LAYOUT_EDGE
    && bounds.top >= CLOUD_LAYOUT_EDGE
    && bounds.right <= CLOUD_LAYOUT_WIDTH - CLOUD_LAYOUT_EDGE
    && bounds.bottom <= CLOUD_LAYOUT_HEIGHT - CLOUD_LAYOUT_EDGE;
}

function intersects(left: Bounds, right: Bounds) {
  return left.left - CLOUD_LAYOUT_GAP < right.right
    && left.right + CLOUD_LAYOUT_GAP > right.left
    && left.top - CLOUD_LAYOUT_GAP < right.bottom
    && left.bottom + CLOUD_LAYOUT_GAP > right.top;
}

function cellsFor(bounds: Bounds) {
  const startX = Math.floor(Math.max(0, bounds.left - CLOUD_LAYOUT_GAP) / CLOUD_LAYOUT_CELL_SIZE);
  const endX = Math.floor(Math.min(CLOUD_LAYOUT_WIDTH - 1, bounds.right + CLOUD_LAYOUT_GAP) / CLOUD_LAYOUT_CELL_SIZE);
  const startY = Math.floor(Math.max(0, bounds.top - CLOUD_LAYOUT_GAP) / CLOUD_LAYOUT_CELL_SIZE);
  const endY = Math.floor(Math.min(CLOUD_LAYOUT_HEIGHT - 1, bounds.bottom + CLOUD_LAYOUT_GAP) / CLOUD_LAYOUT_CELL_SIZE);
  const cells: string[] = [];
  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) cells.push(`${x}:${y}`);
  }
  return cells;
}

function fontCandidates(baseFontSize: number) {
  const sizes: number[] = [];
  for (const scale of [1, .93, .86, .79, .72, .65, .58, .51]) {
    const value = Math.max(CLOUD_LAYOUT_MIN_FONT, baseFontSize * scale);
    if (!sizes.some((size) => Math.abs(size - value) < .1)) sizes.push(value);
  }
  if (!sizes.some((size) => Math.abs(size - CLOUD_LAYOUT_MIN_FONT) < .1)) sizes.push(CLOUD_LAYOUT_MIN_FONT);
  return sizes;
}

export function packCloudWords<T extends CloudLayoutWord>(
  words: readonly T[],
  maxFrequency: number,
  limit = CLOUD_LAYOUT_WORD_LIMIT,
): Array<PackedCloudWord<T>> {
  const sorted = [...words]
    .filter((item) => item && item.word && Number.isFinite(item.frequency) && item.frequency > 0)
    .sort((left, right) => right.frequency - left.frequency || (right.sites ?? 0) - (left.sites ?? 0) || left.word.localeCompare(right.word))
    .slice(0, Math.max(0, limit));
  if (!sorted.length) return [];

  const placed: Array<PackedCloudWord<T>> = [];
  const placedBounds: Bounds[] = [];
  const spatialCells = new Map<string, number[]>();
  const centerX = CLOUD_LAYOUT_WIDTH / 2;
  const centerY = CLOUD_LAYOUT_HEIGHT / 2;

  const collides = (bounds: Bounds) => {
    const candidates = new Set<number>();
    for (const cell of cellsFor(bounds)) {
      for (const index of spatialCells.get(cell) ?? []) candidates.add(index);
    }
    return [...candidates].some((index) => intersects(bounds, placedBounds[index]));
  };

  const commit = (item: T, left: number, top: number, fontSize: number, width: number, height: number, bounds: Bounds) => {
    const index = placed.length;
    placed.push({ item, left, top, fontSize, width, height });
    placedBounds.push(bounds);
    for (const cell of cellsFor(bounds)) {
      const entries = spatialCells.get(cell);
      if (entries) entries.push(index);
      else spatialCells.set(cell, [index]);
    }
  };

  sorted.forEach((item, wordIndex) => {
    const mappedFontSize = cloudBaseFontSize(item.frequency, maxFrequency);
    const baseFontSize = wordIndex === 0 ? mappedFontSize : Math.max(CLOUD_LAYOUT_MIN_FONT, mappedFontSize * .5);
    for (const fontSize of fontCandidates(baseFontSize)) {
      const { width, height } = estimateCloudTextBox(item.word, fontSize);
      if (width > CLOUD_LAYOUT_WIDTH - CLOUD_LAYOUT_EDGE * 2 || height > CLOUD_LAYOUT_HEIGHT - CLOUD_LAYOUT_EDGE * 2) continue;

      if (wordIndex === 0) {
        const bounds = boundsFor(centerX, centerY, width, height);
        if (isInside(bounds)) {
          commit(item, centerX, centerY, fontSize, width, height, bounds);
          return;
        }
        continue;
      }

      for (let attempt = 0; attempt < CLOUD_LAYOUT_MAX_CANDIDATES; attempt += 1) {
        const progress = Math.sqrt((attempt + 1) / CLOUD_LAYOUT_MAX_CANDIDATES);
        const angle = (attempt + wordIndex * 29) * CLOUD_LAYOUT_GOLDEN_ANGLE;
        const radiusX = Math.max(0, centerX - CLOUD_LAYOUT_EDGE - width / 2);
        const radiusY = Math.max(0, centerY - CLOUD_LAYOUT_EDGE - height / 2);
        const left = centerX + Math.cos(angle) * progress * radiusX;
        const top = centerY + Math.sin(angle) * progress * radiusY;
        const bounds = boundsFor(left, top, width, height);
        if (!isInside(bounds) || collides(bounds)) continue;
        commit(item, left, top, fontSize, width, height, bounds);
        return;
      }

      if (fontSize <= CLOUD_LAYOUT_MIN_FONT + .1) {
        for (const point of CLOUD_LAYOUT_GRID_POINTS) {
          const bounds = boundsFor(point.left, point.top, width, height);
          if (!isInside(bounds) || collides(bounds)) continue;
          commit(item, point.left, point.top, fontSize, width, height, bounds);
          return;
        }
      }
    }
  });

  return placed;
}
