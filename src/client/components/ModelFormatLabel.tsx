import type { ModelFormat } from '../../core/assetKeys'

export function ModelFormatLabel({ format }: { format: ModelFormat | undefined }) {
  return <span className="font-mono text-[10px] text-muted-foreground">{format}</span>
}
