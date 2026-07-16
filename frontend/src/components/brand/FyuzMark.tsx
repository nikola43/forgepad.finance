/**
 * FYUZ — The Reaction mark (§07).
 *
 * Two reagent discs overlap; the intersection ignites. A Venn diagram turned
 * explosive — the entire brand idea in three circles. Survives a 16px favicon.
 *
 * Never rotate, stretch, gradient, glow, recolor off-palette, or set the
 * wordmark as the app icon (§07 NEVER panel).
 */

type MarkProps = {
  /** Rendered height in px. Symbol floor is 16px (§07). */
  size?: number
  /** Mono marks for single-color contexts. Color comes from currentColor. */
  variant?: 'color' | 'mono'
  className?: string
}

const CITRON = '#BFD143'
const PLUM_ROSE = '#C74B8E'
const TANGERINE = '#E86A2B'

/** Symbol only. Aspect 1000×640. */
export function FyuzSymbol({ size = 24, variant = 'color', className }: MarkProps) {
  const w = Math.round((size * 1000) / 640)

  if (variant === 'mono') {
    return (
      <svg
        width={w}
        height={size}
        viewBox="0 0 1000 640"
        className={className}
        role="img"
        aria-label="Fyuz"
        fill="none"
      >
        <circle cx="380" cy="320" r="222" stroke="currentColor" strokeWidth="16" />
        <circle cx="620" cy="320" r="222" stroke="currentColor" strokeWidth="16" />
        <circle cx="500" cy="320" r="108" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 1000 640"
      className={className}
      role="img"
      aria-label="Fyuz"
    >
      {/* Reagents mix by screen blend — the intersection is the reaction. */}
      <g style={{ isolation: 'isolate' }}>
        <circle cx="380" cy="320" r="230" fill={CITRON} style={{ mixBlendMode: 'screen' }} />
        <circle cx="620" cy="320" r="230" fill={PLUM_ROSE} style={{ mixBlendMode: 'screen' }} />
        <circle cx="500" cy="320" r="108" fill={TANGERINE} />
      </g>
    </svg>
  )
}

type LockupProps = MarkProps & {
  /** vertical = primary lockup; horizontal = secondary (§07). */
  orientation?: 'horizontal' | 'vertical'
  /** Symbol without the wordmark. */
  symbolOnly?: boolean
}

/**
 * Wordmark is always lowercase "fyuz" (§07 capitalization).
 * Horizontal lockup floor is 88px wide — below that, use the symbol alone.
 */
export function FyuzLockup({
  size = 28,
  variant = 'color',
  orientation = 'horizontal',
  symbolOnly = false,
  className,
}: LockupProps) {
  if (symbolOnly) return <FyuzSymbol size={size} variant={variant} className={className} />

  const isVertical = orientation === 'vertical'

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: 'center',
        // Clear space: one disc-diameter on all sides. Nothing enters the chamber.
        gap: isVertical ? size * 0.4 : size * 0.45,
        textDecoration: 'none',
      }}
    >
      <FyuzSymbol size={size} variant={variant} />
      <span
        style={{
          fontFamily: "'Unbounded', 'Arial Black', sans-serif",
          fontWeight: 900,
          fontSize: size * 0.92,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          color: 'var(--bone, #EAE6DA)',
        }}
      >
        fyuz
      </span>
    </span>
  )
}

export default FyuzLockup
