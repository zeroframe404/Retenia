import { compareStrings } from './order'

/**
 * Tarjan's strongly connected components, iteratively.
 *
 * Iterative because the graph is the model's: a 2,000-concept book with one long
 * prerequisite chain would blow the call stack of the textbook recursive version. The result
 * is canonical — components in order of their smallest id, members sorted — so the caller
 * that breaks cycles removes the same edge whatever order the edges arrived in.
 *
 * A successor that is not one of `ids` is ignored rather than visited: the caller decides
 * the node set, and an edge to a node it left out is not a reason to grow the graph.
 */
export function stronglyConnectedComponents(
  ids: readonly string[],
  successors: (id: string) => readonly string[],
): string[][] {
  const known = new Set(ids)
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let counter = 0

  interface Frame {
    readonly node: string
    readonly next: readonly string[]
    at: number
  }

  const enter = (frames: Frame[], node: string): void => {
    index.set(node, counter)
    low.set(node, counter)
    counter += 1
    stack.push(node)
    onStack.add(node)
    frames.push({ node, next: successors(node), at: 0 })
  }

  for (const root of [...known].sort(compareStrings)) {
    if (index.has(root)) continue
    const frames: Frame[] = []
    enter(frames, root)

    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as Frame
      if (frame.at < frame.next.length) {
        const child = frame.next[frame.at] as string
        frame.at += 1
        if (!known.has(child)) continue
        if (!index.has(child)) {
          enter(frames, child)
        } else if (onStack.has(child)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(child) as number))
        }
        continue
      }

      frames.pop()
      const parent = frames[frames.length - 1]
      if (parent !== undefined) {
        low.set(
          parent.node,
          Math.min(low.get(parent.node) as number, low.get(frame.node) as number),
        )
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = []
        for (;;) {
          const member = stack.pop() as string
          onStack.delete(member)
          component.push(member)
          if (member === frame.node) break
        }
        components.push(component.sort(compareStrings))
      }
    }
  }

  return components.sort((a, b) => compareStrings(a[0] as string, b[0] as string))
}
