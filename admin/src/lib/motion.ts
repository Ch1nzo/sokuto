import { useRef } from 'react'
import type { Transition } from 'motion/react'

/*
 * Motion tokens for Motion (`motion/react`) components. They mirror the CSS custom properties in styles.css
 * (`--ease-drawer`, `--ease-out`, `--ease-in-out`): change both together. Use `m.*` components only
 * (the app runs under `<LazyMotion features={domAnimation} strict>`), and only animate transform / opacity.
 */
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const
export const EASE_OUT = [0.23, 1, 0.32, 1] as const
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

/** Repeatable editor items (trigger cards, buttons, rules…) added or removed after the list was shown. */
export const LIST_ITEM_MOTION = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: EASE_OUT } satisfies Transition,
} as const

/**
 * Stable React keys for a list whose items have no id (index-keyed arrays in the flow definition), so that
 * `AnimatePresence` can tell which item was removed. Nothing is added to the data: the keys live here.
 * Remove items with `without(list, i)` (drops item `i` and its key, inside an event handler, not a state
 * updater); appends and other length changes are reconciled at the end of the list.
 */
export function useItemKeys(length: number): { keys: string[]; without: <T>(list: T[], i: number) => T[] } {
  const ref = useRef<{ keys: string[]; next: number } | null>(null)
  if (!ref.current) ref.current = { keys: Array.from({ length }, (_, i) => `k${i}`), next: length }
  const state = ref.current
  // Idempotent, so a repeated (StrictMode) render leaves the same keys.
  while (state.keys.length < length) state.keys.push(`k${state.next++}`)
  if (state.keys.length > length) state.keys.length = length
  return {
    keys: state.keys,
    without: (list, i) => {
      state.keys.splice(i, 1)
      return list.filter((_, j) => j !== i)
    },
  }
}
