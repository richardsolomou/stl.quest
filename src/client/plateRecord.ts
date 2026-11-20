import { consumablesOfKind, type Consumable } from '../core/consumables'
import type { PlateMaterialChoice, PlateMeasured, PlateRecordInput } from '../core/plates'
import type { SlicedObject, SlicedPlate } from '../core/slicedPlate'

/**
 * A parsed plate as the record it sends: only the filaments the plate uses, in the order the operator picked their
 * materials, with each object put on the print it was matched or reassigned to.
 */
export function measuredRecord(
  plateId: string,
  sliced: SlicedPlate,
  assignments: (string | undefined)[],
  materials: PlateMaterialChoice[],
  minutes: number,
): PlateRecordInput & PlateMeasured {
  const slots = sliced.filaments.map(({ slot }) => slot)
  return {
    plateId,
    minutes,
    materials,
    objects: sliced.objects.map((object, index) => ({
      ...(assignments[index] && { requestId: assignments[index] }),
      amounts: slots.map((slot) => object.grams[slot] ?? 0),
    })),
    overhead: slots.map((slot) => sliced.overhead[slot] ?? 0),
  }
}

export function slicedObjectLabel(object: SlicedObject, unnamed: (id: string) => string) {
  return object.name ?? unnamed(object.id)
}

/**
 * The library filament the slicer's filament most likely is: the same colour and type, else the same colour, else the
 * same type. A filament's type is its catalogue entry's when it has one, otherwise a word of its name.
 */
export function suggestedFilament(
  library: Consumable[],
  filament: { type?: string; color?: string },
  presetTypes: ReadonlyMap<string, string> = new Map(),
) {
  const colour = filament.color?.toLowerCase()
  const type = filament.type?.toLowerCase()
  const ranked = consumablesOfKind(library, 'filament')
    .map((candidate) => {
      const candidateType = (candidate.filamentPresetId && presetTypes.get(candidate.filamentPresetId))?.toLowerCase()
      const typeMatches = Boolean(type) && (candidateType === type || new RegExp(`\\b${escape(type!)}\\b`, 'i').test(candidate.name))
      const colourMatches = Boolean(colour) && candidate.colour?.hex.toLowerCase() === colour
      return { id: candidate.id, score: (colourMatches ? 2 : 0) + (typeMatches ? 1 : 0) }
    })
    .filter(({ score }) => score > 0)
  return ranked.reduce<(typeof ranked)[number] | undefined>((best, next) => (!best || next.score > best.score ? next : best), undefined)?.id
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
