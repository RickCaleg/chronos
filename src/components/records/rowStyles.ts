/** Icon buttons at the end of an entry or group row. */
export const rowIconButton =
  "shrink-0 rounded-[2px] p-1.5 text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]";

/**
 * For row actions (as opposed to row state): hidden until the row (a
 * `group/row` ancestor) is hovered or the button has keyboard focus, so a
 * long list isn't a wall of identical icons. They keep their space, so
 * nothing shifts when they appear.
 */
export const revealOnRowHover = "opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100";
