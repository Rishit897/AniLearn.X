'use strict';

function generateVTT(entries) {
  const lines = ['WEBVTT', ''];
  for (const entry of entries) {
    const start = formatTimestamp(entry.startSeconds);
    const end = formatTimestamp(entry.endSeconds);
    lines.push(`${start} --> ${end}`);
    lines.push(entry.text);
    lines.push('');
  }
  return lines.join('\n');
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function buildSubtitlesFromScenes(scenes, options = {}) {
  const language = options.language || 'en';
  let cursor = 0;
  const entries = [];

  for (const scene of scenes) {
    const duration = Number(scene.estimatedSeconds) || 60;
    const dialogue = Array.isArray(scene.dialogue) ? scene.dialogue : [];
    let segCursor = cursor;

    for (const d of dialogue) {
      const lineText = `${d.speaker || 'Narrator'}: ${d.line}`;
      const chars = lineText.length;
      const segDuration = Math.max(3, Math.min(duration * 0.6, chars * 0.35));
      entries.push({ startSeconds: segCursor, endSeconds: Math.min(segCursor + segDuration, cursor + duration), text: lineText });
      segCursor += segDuration;
    }

    if (dialogue.length === 0) {
      entries.push({ startSeconds: cursor, endSeconds: cursor + duration, text: `[Scene ${scene.scene}] ${scene.title || ''}` });
    }

    cursor += duration;
  }

  return entries;
}

module.exports = { generateVTT, formatTimestamp, buildSubtitlesFromScenes };
