'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

class NotConfiguredError extends Error {
  constructor(msg) { super(msg); this.name = 'NotConfiguredError'; }
}

function requireFfmpeg() { return FFMPEG_BIN; }

async function probeDuration(inputPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath
  ]);
  const dur = parseFloat(stdout.trim());
  if (!dur || dur <= 0) throw new Error(`ffprobe could not determine duration for ${inputPath}`);
  return dur;
}

async function assembleVideo({ clips, narrationPath, subtitlesPath, bgmPath, outputPath, targetDurationSeconds }) {
  const bin = requireFfmpeg();
  const workDir = path.dirname(outputPath) || '.';
  fs.mkdirSync(workDir, { recursive: true });

  const concatList = path.join(workDir, `concat-${Date.now()}.txt`);
  fs.writeFileSync(concatList, clips.map(c => `file '${c.path}'\n`).join(''));

  const tempConcat = path.join(workDir, `temp-concat-${Date.now()}.mp4`);

  try {
    await execFileAsync(bin, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', tempConcat]);

    const hasSubs = subtitlesPath && fs.existsSync(subtitlesPath);
    const hasNarration = narrationPath && fs.existsSync(narrationPath);
    const hasBGM = bgmPath && fs.existsSync(bgmPath);

    const inputs = ['-i', tempConcat];
    if (hasNarration) inputs.push('-i', narrationPath);
    if (hasBGM) inputs.push('-i', bgmPath);

    const filterParts = [];
    let audioLabel = '[0:a]';

    filterParts.push('[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v]');

    if (hasSubs) {
      filterParts.push(`[v]subtitles='${subtitlesPath.replace(/'/g, "\\'")}'[vs]`);
    }

    let mixInputs = '[0:a]';
    if (hasNarration) mixInputs = '[1:a]';
    if (hasBGM) {
      mixInputs += `[2:a]volume=0.25[bgm]`;
      filterParts.push(`[1:a][bgm]amix=inputs=2:duration=longest[a]`);
      audioLabel = '[a]';
    } else if (hasNarration) {
      audioLabel = '[1:a]';
    }

    const vOut = hasSubs ? '[vs]' : '[v]';
    const filterComplex = filterParts.join(';');

    await execFileAsync(bin, [
      '-y', ...inputs, '-filter_complex', filterComplex, '-map', vOut, '-map', audioLabel,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', outputPath
    ]);

    const actualDuration = await probeDuration(outputPath);
    const stat = fs.statSync(outputPath);
    if (stat.size === 0) throw new Error('Assembled video is empty.');

    return {
      outputPath, actualDurationSeconds: actualDuration,
      actualDurationText: formatDuration(actualDuration), sizeBytes: stat.size,
      hasAudio: hasNarration || hasBGM, hasSubtitles: hasSubs
    };
  } finally {
    for (const f of [concatList, tempConcat]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { FFMPEG_BIN, NotConfiguredError, assembleVideo, probeDuration };
