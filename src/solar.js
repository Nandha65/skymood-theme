'use strict';
/**
 * Offline sky math: NOAA sunrise/sunset, golden hour and moon phase.
 * Pure functions, no network, no location services: the user supplies latitude/longitude.
 */
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;
const norm = m => ((m % 1440) + 1440) % 1440;

/**
 * NOAA solar calculator (fractional-year approximation, accurate to a few minutes).
 * @param {Date} date the day to compute (its local calendar date is used)
 * @param {number} tzOffsetMinutes minutes east of UTC for that day; defaults to the machine's
 * @returns {{sunrise:number, sunset:number} | null} minutes since local midnight, or null in polar day/night
 */
function sunTimes(date, lat, lon, tzOffsetMinutes = -date.getTimezoneOffset()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);

  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  const cosHa = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null;
  const ha = deg(Math.acos(cosHa));
  return {
    sunrise: norm(720 - 4 * (lon + ha) - eqTime + tzOffsetMinutes),
    sunset: norm(720 - 4 * (lon - ha) - eqTime + tzOffsetMinutes)
  };
}

function parseClock(str, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return fallback;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return fallback;
  return h * 60 + min;
}

function formatClock(minutes) {
  const m = Math.round(norm(minutes));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ---------- moon ----------
const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const MOON_NAMES = [
  [0.0339, 'New moon', '🌑'], [0.216, 'Waxing crescent', '🌒'], [0.284, 'First quarter', '🌓'],
  [0.466, 'Waxing gibbous', '🌔'], [0.534, 'Full moon', '🌕'], [0.716, 'Waning gibbous', '🌖'],
  [0.784, 'Last quarter', '🌗'], [0.966, 'Waning crescent', '🌘'], [1.01, 'New moon', '🌑']
];
function moonInfo(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const f = age / SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * f)) / 2;
  const [, name, emoji] = MOON_NAMES.find(([lim]) => f < lim);
  return { name, emoji, illumination, age };
}

/** 0..1 golden-hour strength around sunrise and sunset. */
function goldenAmount(minute, sunrise, sunset) {
  const bell = (center, width) => {
    let d = Math.abs(minute - center);
    d = Math.min(d, 1440 - d);
    const x = Math.max(0, 1 - d / width);
    return x * x * (3 - 2 * x);
  };
  return Math.max(bell(sunset - 15, 40), 0.7 * bell(sunrise + 20, 35));
}

module.exports = { sunTimes, parseClock, formatClock, moonInfo, goldenAmount, SYNODIC };
