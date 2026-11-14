'use strict';

const rateLimit = require('express-rate-limit');

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const AUTH_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '20', 10);
const GEN_MAX = parseInt(process.env.RATE_LIMIT_GENERATION_MAX || '5', 10);

const generalLimiter = rateLimit({
  windowMs: WINDOW_MS, max: MAX, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

const authLimiter = rateLimit({
  windowMs: WINDOW_MS, max: AUTH_MAX, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});

const generationLimiter = rateLimit({
  windowMs: WINDOW_MS, max: GEN_MAX, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many generation requests. Please wait before starting another video.' }
});

module.exports = { generalLimiter, authLimiter, generationLimiter };
