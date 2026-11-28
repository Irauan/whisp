/** How the text field of Rename ends: Enter saved the title, Escape cancelled, or the focus left the field. */
export type FieldEnd = 'saved' | 'escape' | 'blur'

/**
 * Whether the focus goes back to the arrow "Session options" when the field ends. Only the keyboard ends
 * (Enter and Escape) bring the focus back. A blur means that the user clicked somewhere else, for example
 * into the composer: the field cancels and the focus stays where the user put it.
 */
export const focusesArrowAfter = (end: FieldEnd): boolean => end !== 'blur'
