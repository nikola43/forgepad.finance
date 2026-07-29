/**
 * Chainlink hexagon mark. Chainlink's brand guidance is that integrators use
 * the hexagon plus a "Powered by Chainlink" lockup, in Chainlink Blue on a dark
 * surface — so the fill is pinned, not themed.
 */
export const CHAINLINK_BLUE = '#375BD2'

export default function ChainlinkMark({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
            <path
                fill={CHAINLINK_BLUE}
                d="M16 0l-3.2 1.8-8 4.9L1.6 8.5v15l3.2 1.8 8.9 4.9 3.2 1.8 3.2-1.8 8.7-4.9 3.2-1.8v-15l-3.2-1.8-8.8-4.9L16 0zm-8 19.9v-7.8L16 7.6l8 4.5v7.8l-8 4.5-8-4.5z"
            />
        </svg>
    )
}
