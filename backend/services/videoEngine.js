'use strict';

const VIDEO_ENGINE = (process.env.VIDEO_ENGINE || 'none').toLowerCase();
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'wan-2.2-ti2v-5b';

class NotConfiguredError extends Error {
  constructor(msg) { super(msg); this.name = 'NotConfiguredError'; }
}

class VideoEngineError extends Error {
  constructor(msg, details) { super(msg); this.name = 'VideoEngineError'; this.details = details; }
}

const CLIPS_PER_DURATION = { short: 5, medium: 7, long: 10 };

function getVideoEngine() {
  switch (VIDEO_ENGINE) {
    case 'kaggle': return require('./kaggleVideoEngine');
    case 'none':
    default: throw new NotConfiguredError('VIDEO_ENGINE is not configured. Set VIDEO_ENGINE=kaggle and configure KAGGLE_VIDEO_API_URL / KAGGLE_VIDEO_API_KEY in .env.');
  }
}

module.exports = { VIDEO_ENGINE, VIDEO_MODEL, CLIPS_PER_DURATION, NotConfiguredError, VideoEngineError, getVideoEngine };
