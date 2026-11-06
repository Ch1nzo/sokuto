import type { KeyboardEvent, ReactNode } from 'react'

export type Column<T> = {
  /** Stable key for React. */
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** CSS width of the column, e.g. 120 or '30%'. */
  width?: number | string
  /** Right-aligns and uses tabular figures. Use for counts / amounts. */
  numeric?: boolean
  /** Keep the cell on one line (dates, badges). */
  nowrap?: boolean
  /** Hide below 860px. Never hide the column that identifies the row. */
  hideOnMobile?: boolean
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  /** Makes rows clickable (cursor, hover, Enter/Space) and calls back with the row. */
  onRowClick?: (row: T) => void
  /** Accessible label of the table (visually hidden caption). */
  caption?: string
  /** Shown in place of the body when `rows` is empty, e.g. an <EmptyState compact />. */
  empty?: ReactNode
}

/**
 * Plain responsive table styled with Bezier tokens (Bezier has no table component).
 * Scrolls horizontally inside its own box, so the page never scrolls sideways.
 * Put it inside `<Card flush>` for the standard look.
 */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption, empty }: Props<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>
  const cellClass = (c: Column<T>) =>
    [c.numeric && 'is-numeric', c.nowrap && 'is-nowrap', c.hideOnMobile && 'hide-mobile'].filter(Boolean).join(' ') || undefined
  const onKey = (row: T) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    // Only the focused row itself: Enter / Space on a button or switch inside a cell is that control's own.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick?.(row)
    }
  }
  return (
    <div className="data-table">
      <table>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cellClass(c)} style={c.width !== undefined ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'is-clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? onKey(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={cellClass(c)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
