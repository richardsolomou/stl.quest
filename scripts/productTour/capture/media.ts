import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { config, scene } from './config.ts'

const run = promisify(execFile)

/** Encodes the recording from `start` seconds in as a looping GIF with a palette generated from the footage itself. */
export async function encodeGif(input: string, start: number) {
  const palette = path.join(config.workDirectory, 'palette.png')
  // Playwright's video carries compression noise that would make every GIF frame differ across the whole board, so it is
  // smoothed over time and frames that no longer change are dropped; the GIF holds the previous frame instead. The
  // trailing clone keeps the final hold, which would otherwise end at the last dropped frame.
  const filters = [
    `setpts=PTS/${scene.speed}`,
    'fps=10',
    'hqdn3d=0:0:6:6',
    'mpdecimate',
    `scale=${scene.scale}:flags=lanczos`,
    'tpad=stop_mode=clone:stop_duration=0.1',
  ].join(',')
  const output = path.join(config.outputDirectory, 'product-tour.gif')
  const seek = ['-ss', start.toFixed(2), '-i', input]
  await run('ffmpeg', ['-y', ...seek, '-vf', `${filters},palettegen=max_colors=96:stats_mode=diff`, palette])
  await run('ffmpeg', [
    '-y',
    ...seek,
    '-i',
    palette,
    '-lavfi',
    `${filters}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
    '-loop',
    '0',
    output,
  ])
  return output
}
