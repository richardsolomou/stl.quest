/**
 * Browser page translation, such as Chrome's, moves text nodes into `<font>` elements. React still holds the original
 * nodes, so its next removeChild or insertBefore beside one throws NotFoundError and the error boundary replaces the
 * whole app. Skipping those stale operations leaves translated text in place and keeps the page usable. It runs before
 * hydration so React never sees the unpatched methods.
 *
 * A literal rather than a serialized function: the router reruns a head script whose text differs from the server's.
 */
export const translationGuardScript = `(() => {
  const { removeChild, insertBefore } = Node.prototype
  Node.prototype.removeChild = function (child) {
    return child.parentNode === this ? removeChild.call(this, child) : child
  }
  Node.prototype.insertBefore = function (child, reference) {
    return reference && reference.parentNode !== this ? child : insertBefore.call(this, child, reference)
  }
})()`
