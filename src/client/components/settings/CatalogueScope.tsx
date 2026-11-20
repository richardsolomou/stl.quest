import { useCallback, useState } from 'react'
import type { PrintType } from '../../../core/types'
import { useI18n } from '../../i18n'
import { useWorkspacePrintTypes } from '../../workspace'

/**
 * Which print types a catalogue picker lists: `fixed` when the picker adds one type, otherwise what the workspace
 * prints, which a single-type workspace can widen to everything.
 */
export function useCatalogueScope(fixed?: PrintType) {
  const workspace = useWorkspacePrintTypes()
  const [showAll, setShowAll] = useState(false)
  const only = !fixed && workspace.length === 1 ? workspace[0] : undefined
  const lists = useCallback(
    (printType?: PrintType) => !printType || (fixed ? printType === fixed : !only || showAll || printType === only),
    [fixed, only, showAll],
  )
  return { only, showAll, setShowAll, lists }
}

/** One muted line saying the catalogue is narrowed, with the switch to the rest. */
export function CatalogueScopeLine({ scope }: { scope: ReturnType<typeof useCatalogueScope> }) {
  const copy = useI18n().t.settings.catalogueScope
  if (!scope.only) return null
  const only = scope.only
  return (
    <p className="shrink-0 text-sm text-muted-foreground">
      {!scope.showAll && `${copy.showing[only]} `}
      <button
        type="button"
        className="cursor-pointer font-medium text-foreground underline underline-offset-2"
        onClick={() => scope.setShowAll(!scope.showAll)}
      >
        {scope.showAll ? copy.only[only] : copy.showAll}
      </button>
    </p>
  )
}
