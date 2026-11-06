/** Sokutō brand mark "the instant macron": the ō of the name as a ring (a conversation closed) with a forward-reaching bar (the instant reply). Same geometry as admin/public/favicon.svg and docs/images/logo.svg. */
export function SokutoMark({ size = 28, color = '#2468F2' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill={color}>
      <path fillRule="evenodd" d="M14 4 H56 L52 12 H14 Z M50 40 A20 20 0 1 1 10 40 A20 20 0 1 1 50 40 Z M42 40 A12 12 0 1 1 18 40 A12 12 0 1 1 42 40 Z" />
    </svg>
  )
}
