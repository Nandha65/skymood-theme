'use strict';
// Kept for backward compatibility: the sky math now lives in ./solar.
const { sunTimes, parseClock, formatClock } = require('./solar');

module.exports = { sunTimes, parseClock, formatClock };
