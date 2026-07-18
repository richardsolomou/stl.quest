import type { ImgHTMLAttributes } from 'react'
import dragonFruitIcon from '../assets/dragonfruit-simple-icon.svg?url'

export function DragonFruitIcon(props: Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'>) {
  return <img {...props} src={dragonFruitIcon} alt="" aria-hidden="true" />
}
