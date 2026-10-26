import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { config, scenes, type SceneName } from './config.ts'

const run = promisify(execFile)

export type Marks = Record<string, number>

function landingFilter(marks: Marks) {
  const scene = scenes.landing
  const scale = `scale=${scene.scale}:flags=lanczos`
  const start = (marks['orbit-start'] ?? 0) - scene.trim + 0.2
  const end = (marks['orbit-end'] ?? 0) - scene.trim - 0.2
  console.log(`  orbit marks: ${JSON.stringify(marks)} → slice ${start.toFixed(2)}s..${end.toFixed(2)}s`)
  if (!(end > start && start > 0)) {
    console.log('  (no usable orbit slice; falling back to a uniform speed)')
    return `[0:v]setpts=PTS/${scene.speed},${scale}[out]`
  }
  const fast = scene.speed * scene.orbitSpeed
  return [
    `[0:v]trim=start=0:end=${start.toFixed(2)},setpts=(PTS-STARTPTS)/${scene.speed}[a]`,
    `[0:v]trim=start=${start.toFixed(2)}:end=${end.toFixed(2)},setpts=(PTS-STARTPTS)/${fast.toFixed(3)}[b]`,
    `[0:v]trim=start=${end.toFixed(2)},setpts=(PTS-STARTPTS)/${scene.speed}[c]`,
    `[a][b][c]concat=n=3:v=1:a=0,${scale}[out]`,
  ].join(';')
}

async function encodeLanding(input: string, marks: Marks) {
  const output = path.join(config.outputDirectory, 'landing.mp4')
  await run('ffmpeg', [
    '-y',
    '-ss',
    String(scenes.landing.trim),
    '-i',
    input,
    '-filter_complex',
    landingFilter(marks),
    '-map',
    '[out]',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    output,
  ])
  await run('ffmpeg', [
    '-y',
    '-i',
    output,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-an',
    path.join(config.outputDirectory, 'landing.webm'),
  ])
  const poster = path.join(config.workDirectory, 'landing-poster.png')
  await run('ffmpeg', ['-y', '-ss', '1', '-i', output, '-frames:v', '1', '-vf', 'scale=1200:-1:flags=lanczos', poster])
  await run('cwebp', ['-quiet', '-q', '82', poster, '-o', path.join(config.outputDirectory, 'landing.webp')])
  return output
}

async function encodeGif(input: string) {
  const scene = scenes.gif
  const palette = path.join(config.workDirectory, 'palette.png')
  const filters = `setpts=PTS/${scene.speed},fps=12,scale=${scene.scale}:flags=lanczos`
  const output = path.join(config.outputDirectory, 'product-tour.gif')
  await run('ffmpeg', [
    '-y',
    '-ss',
    String(scene.trim),
    '-i',
    input,
    '-vf',
    `${filters},palettegen=max_colors=112:stats_mode=diff`,
    palette,
  ])
  await run('ffmpeg', [
    '-y',
    '-ss',
    String(scene.trim),
    '-i',
    input,
    '-i',
    palette,
    '-lavfi',
    `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop',
    '0',
    output,
  ])
  return output
}

export function encodeRecording(name: SceneName, input: string, marks: Marks) {
  return name === 'landing' ? encodeLanding(input, marks) : encodeGif(input)
}
