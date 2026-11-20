import { appPath } from '../../basePath'
import { cn } from '@/lib/utils'

/**
 * A screenshot of the running application in the visitor's theme. Both captures are in the markup and `landing.css`
 * hides the other theme's, which a lazy image then never fetches. `wide` captures also ship a 1200px copy.
 */
export function Shot({
  name,
  alt,
  width,
  height,
  sizes,
  wide = false,
  className,
}: {
  name: string
  alt: string
  width: number
  height: number
  sizes: string
  wide?: boolean
  className?: string
}) {
  return (['light', 'dark'] as const).map((theme) => {
    const src = appPath(`/landing-${name}-${theme}.webp`)
    return (
      <img
        key={theme}
        className={cn(`shot-${theme} block h-auto w-full`, className)}
        src={src}
        srcSet={wide ? `${appPath(`/landing-${name}-${theme}-1200.webp`)} 1200w, ${src} 2000w` : undefined}
        sizes={sizes}
        width={width}
        height={height}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
    )
  })
}
