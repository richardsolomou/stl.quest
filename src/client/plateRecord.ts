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
