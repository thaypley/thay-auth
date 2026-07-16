/**
 * Astral sign from a YYYY-MM-DD birthday string.
 */
const SIGNS = [
  // [sign, start month, start day] — entries ordered by start date
  ['capricorn', 1, 1], ['aquarius', 1, 20], ['pisces', 2, 19],
  ['aries', 3, 21], ['taurus', 4, 20], ['gemini', 5, 21],
  ['cancer', 6, 21], ['leo', 7, 23], ['virgo', 8, 23],
  ['libra', 9, 23], ['scorpio', 10, 23], ['sagittarius', 11, 22],
  ['capricorn', 12, 22],
];

export function astralSign(birthday) {
  if (!birthday) return null;
  const [, m, d] = birthday.split('-').map(Number);
  if (!m || !d) return null;
  let result = null;
  for (const [sign, sm, sd] of SIGNS) {
    if (m > sm || (m === sm && d >= sd)) result = sign;
  }
  return result;
}
