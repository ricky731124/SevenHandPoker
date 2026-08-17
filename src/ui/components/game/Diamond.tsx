/** A small faceted diamond/gem icon (the campaign currency). Themed, not emoji. */
export default function Diamond({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }} aria-hidden>
      <path d="M6 3 H18 L22 9 L12 22 L2 9 Z" fill="#5aa9e6" stroke="#1f5c93" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 3 L9 9 L2 9 Z" fill="#8fcbf3" />
      <path d="M18 3 L15 9 L22 9 Z" fill="#8fcbf3" />
      <path d="M9 9 H15 L12 22 Z" fill="#3d8ccb" />
      <path d="M2 9 H22 L12 22 Z" fill="none" stroke="#1f5c93" strokeWidth="1" strokeLinejoin="round" opacity="0.5" />
    </svg>
  )
}
