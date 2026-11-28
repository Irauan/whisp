import { useLayoutEffect, type RefObject } from 'react'

/**
 * Stacks the children of a row when they would wrap: each child then takes the full width, at equal
 * size (story S5, "Sizing"). While all children fit on one line, each sizes to its content. The
 * measure is the width of the line, not a fixed screen width, so it holds in a narrow window.
 *
 * The hook measures the natural width of the children in the one-line layout, and compares it with the
 * width of the row. It runs before the browser paints, and again each time the row changes its width.
 * It toggles the class `stackedClass` on the row itself: the row never sets that class through React.
 */
export function useStackedWhenWrapping(row: RefObject<HTMLElement | null>, stackedClass: string): void {
  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    const measure = () => {
      // The one-line layout, to read the natural width of each child.
      element.classList.remove(stackedClass)
      const style = getComputedStyle(element)
      const gap = Number.parseFloat(style.columnGap) || 0
      const children = [...element.children]
      const needed = children.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + gap * Math.max(0, children.length - 1)
      // A half pixel of tolerance for the rounding of the browser.
      if (needed > element.clientWidth + 0.5) element.classList.add(stackedClass)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [row, stackedClass])
}
