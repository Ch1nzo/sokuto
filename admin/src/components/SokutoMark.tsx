/** Sokutō brand mark: rounded speech bubble with a lightning bolt (docs/images/logo.svg, admin/public/favicon.svg). */
export function SokutoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path fill="#2468F2" d="M20 8H44A12 12 0 0 1 56 20V40A12 12 0 0 1 44 52H28L14 60V50A12 12 0 0 1 8 40V20A12 12 0 0 1 20 8Z" />
      <path fill="#FFFFFF" d="M34 16 21 34H30L27 46 44 26H34L38 16Z" />
    </svg>
  )
}
