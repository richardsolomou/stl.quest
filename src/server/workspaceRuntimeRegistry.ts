type Runtime = { close(): Promise<void> }

type RegistryOptions<Input, Value extends Runtime> = {
  create(input: Input): Promise<Value>
  current(value: Value): Promise<boolean>
  revisionTtlMs: number
}

type Entry<Value> = { value: Value; checkedAt: number }
type Pending<Value> = { generation: number; value: Promise<Value> }

export class WorkspaceRuntimeRegistry<Input, Value extends Runtime> {
  private entries = new Map<string, Entry<Value>>()
  private pending = new Map<string, Pending<Value>>()
  private generations = new Map<string, number>()
  private closedValues = new Set<Value>()
  private closed = false

  constructor(private options: RegistryOptions<Input, Value>) {}

  get size() {
    return this.entries.size
  }

  async get(workspaceId: string, input: Input): Promise<Value> {
    if (this.closed) throw new Error('workspace runtime registry is closed')
    const entry = this.entries.get(workspaceId)
    if (entry) {
      if (Date.now() - entry.checkedAt < this.options.revisionTtlMs) return entry.value
      if (await this.options.current(entry.value)) {
        entry.checkedAt = Date.now()
        return entry.value
      }
      await this.invalidate(workspaceId)
    }

    const generation = this.generation(workspaceId)
    let pending = this.pending.get(workspaceId)
    if (!pending || pending.generation !== generation) {
      pending = { generation, value: this.options.create(input) }
      this.pending.set(workspaceId, pending)
    }

    let value: Value
    try {
      value = await pending.value
    } catch (error) {
      if (this.pending.get(workspaceId) === pending) this.pending.delete(workspaceId)
      throw error
    }
    if (this.closed || this.generation(workspaceId) !== generation) {
      await this.closeValue(value)
      return await this.get(workspaceId, input)
    }
    if (this.pending.get(workspaceId) === pending) this.pending.delete(workspaceId)
    this.entries.set(workspaceId, { value, checkedAt: Date.now() })
    return value
  }

  async invalidate(workspaceId: string) {
    const pending = this.pending.get(workspaceId)
    this.generations.set(workspaceId, this.generation(workspaceId) + 1)
    this.pending.delete(workspaceId)
    const entry = this.entries.get(workspaceId)
    this.entries.delete(workspaceId)
    const values = [entry?.value, pending ? await pending.value.catch(() => undefined) : undefined].filter(
      (value): value is Value => value !== undefined,
    )
    await Promise.all([...new Set(values)].map(async (value) => await this.closeValue(value)))
  }

  async close() {
    if (this.closed) return
    this.closed = true
    const workspaceIds = new Set([...this.entries.keys(), ...this.pending.keys()])
    await Promise.all([...workspaceIds].map(async (workspaceId) => await this.invalidate(workspaceId)))
  }

  private generation(workspaceId: string) {
    return this.generations.get(workspaceId) ?? 0
  }

  private async closeValue(value: Value) {
    if (this.closedValues.has(value)) return
    this.closedValues.add(value)
    await value.close()
  }
}
