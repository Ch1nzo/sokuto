/** Sokuto brand mark: blue rounded speech bubble with a white lightning bolt (docs/images/icon.png). */
export function SokutoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        d="M20 9h24c9.4 0 17 7.6 17 17v8c0 9.4-7.6 17-17 17H23.5L12.6 56.2c-1.4.7-2.9-.6-2.5-2.1l2-7.4C6.7 43.7 3 38.2 3 32v-6C3 16.6 10.6 9 20 9z"
        fill="#1d63f2"
      />
      <path d="M37.5 15.5 21 32.5h9.5L26 46.5 43 29.5h-9.5l4-14z" fill="#fff" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
