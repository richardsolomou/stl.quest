import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { translationGuardScript } from './translationGuard'

// The DOM methods the guard wraps, with the browser's NotFoundError for a node of another parent.
class FakeNode {
  parentNode: FakeNode | null = null
  childNodes: FakeNode[] = []

  constructor(readonly name: string) {}

  removeChild(child: FakeNode) {
    const index = this.childNodes.indexOf(child)
    if (index < 0) throw new Error('NotFoundError: removeChild')
    this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  insertBefore(child: FakeNode, reference: FakeNode | null) {
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length
    if (index < 0) throw new Error('NotFoundError: insertBefore')
    child.parentNode?.removeChild(child)
    this.childNodes.splice(index, 0, child)
    child.parentNode = this
    return child
  }

  append(child: FakeNode) {
    return this.insertBefore(child, null)
  }
}

function guardedNode() {
  const node = class extends FakeNode {}
  runInNewContext(translationGuardScript, { Node: node })
  return node
}

const names = (node: FakeNode) => node.childNodes.map((child) => child.name)

// Chrome translation moves the button's text into <font><font>…</font></font>.
function translatedButton(Node: typeof FakeNode) {
  const button = new Node('button')
  const text = button.append(new Node('Sign in'))
  const outer = new Node('font')
  const inner = outer.append(new Node('font'))
  button.insertBefore(outer, text)
  inner.append(text)
  return { button, text, outer }
}

describe('translationGuardScript', () => {
  it('shows the failure the guard prevents', () => {
    const { button, text } = translatedButton(FakeNode)
    expect(() => button.insertBefore(new FakeNode('spinner'), text)).toThrow('NotFoundError')
    expect(() => button.removeChild(text)).toThrow('NotFoundError')
  })

  it('skips an insert beside a text node that translation moved', () => {
    const GuardedNode = guardedNode()
    const { button, text } = translatedButton(GuardedNode)
    const spinner = new GuardedNode('spinner')

    expect(button.insertBefore(spinner, text)).toBe(spinner)
    expect(names(button)).toEqual(['font'])
  })

  it('skips removing a text node that translation moved', () => {
    const GuardedNode = guardedNode()
    const { button, text } = translatedButton(GuardedNode)

    expect(button.removeChild(text)).toBe(text)
    expect(names(button)).toEqual(['font'])
  })

  it('keeps regular inserts and removals', () => {
    const GuardedNode = guardedNode()
    const button = new GuardedNode('button')
    const text = button.append(new GuardedNode('Sign in'))
    const spinner = button.insertBefore(new GuardedNode('spinner'), text)

    expect(names(button)).toEqual(['spinner', 'Sign in'])
    expect(button.removeChild(spinner)).toBe(spinner)
    expect(names(button)).toEqual(['Sign in'])
  })
})
