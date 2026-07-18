import type { SVGProps } from 'react'

export function DragonFruitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 21c-4.6 0-7.5-3.4-7.5-7.8 0-4.1 3.1-7.2 7.5-7.2s7.5 3.1 7.5 7.2c0 4.4-2.9 7.8-7.5 7.8Z" />
      <path d="M8.4 6.8 6.6 3.5l4.1 2.7L12 2l1.3 4.2 4.1-2.7-1.8 3.3" />
      <path d="m5.2 10.2-2.7-1 2.2 3.2M18.8 10.2l2.7-1-2.2 3.2M6.1 17.2l-2.2.8 2.9 1M17.9 17.2l2.2.8-2.9 1" />
      <circle cx="9" cy="11.5" r=".55" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="11" r=".55" fill="currentColor" stroke="none" />
      <circle cx="11.8" cy="15" r=".55" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="16.5" r=".55" fill="currentColor" stroke="none" />
      <circle cx="8.3" cy="16" r=".55" fill="currentColor" stroke="none" />
    </svg>
  )
}
