'use strict';

function requireFields(body, fields) {
  const missing = fields.filter(f => body[f] == null || body[f] === '');
  if (missing.length) throw new ValidationError(`Missing required field(s): ${missing.join(', ')}`);
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDuration(v) { return v === 'short' || v === 'medium' || v === 'long'; }
function isValidLanguage(v) { return typeof v === 'string' && v.length >= 2 && v.length <= 10; }
function isPositiveInt(v) { return Number.isInteger(Number(v)) && Number(v) > 0; }

class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationError'; this.status = 400; }
}
class NotFoundError extends Error {
  constructor(msg) { super(msg); this.name = 'NotFoundError'; this.status = 404; }
}
class ForbiddenError extends Error {
  constructor(msg) { super(msg); this.name = 'ForbiddenError'; this.status = 403; }
}

function validationMiddleware(req, res, next) {
  res.validationError = (msg) => { const err = new ValidationError(msg); next(err); };
  next();
}

module.exports = { requireFields, isValidEmail, isValidDuration, isValidLanguage, isPositiveInt, ValidationError, NotFoundError, ForbiddenError, validationMiddleware };
