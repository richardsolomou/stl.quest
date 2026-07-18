export function parsePlateBrief(value?: string) {
  if (!value) return []
  return [
    ...new Set(
      value
        .split('.')
        .map((requestId) => requestId.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100)
}

export function serializePlateBrief(requestIds: string[]) {
  return [...new Set(requestIds.map((requestId) => requestId.trim()).filter(Boolean))].slice(0, 100).join('.')
}

export function plateBriefCopyIds(requestIds: string[]) {
  return requestIds.map((requestId) => `${requestId}:1`)
}
