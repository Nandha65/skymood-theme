'use strict';
/**
 * Offline sunrise/sunset calculation (NOAA approximation, accurate to a few minutes).
 * No network calls, no location services: the user supplies latitude/longitude.
 */
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;

/**
 * @returns {{sunrise:number, sunset:number} | null} local minutes since midnight, or null in polar day/night
 */
function sunTimes(date, lat, lon) {
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

  const offset = -date.getTimezoneOffset(); // minutes east of UTC
  const norm = m => ((m % 1440) + 1440) % 1440;
  return {
    sunrise: norm(720 - 4 * (lon + ha) - eqTime + offset),
    sunset: norm(720 - 4 * (lon - ha) - eqTime + offset)
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
  const m = Math.round(((minutes % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

module.exports = { sunTimes, parseClock, formatClock };
