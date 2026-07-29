'use client'

import { useEffect } from "react"
import Link from "next/link"
import styled from "styled-components"
import useSWR from "swr"
import { ethers } from "ethers"
import { useMainContext } from "@/context"
import { CREATOR_FEE_PROMO, showCreatorFeePromo } from "@/config"

// Height of the strip. While it is on screen it publishes its own height as
// --promo-h; the fixed header, the sidebar and the page's top padding all
// offset themselves by that variable, so nothing overlaps whether the banner is
// showing, hidden, or still deciding.
export const PROMO_BANNER_HEIGHT = 40

const Bar = styled(Link)`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 4;                       /* above the fixed header (3) */
    height: ${PROMO_BANNER_HEIGHT}px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 0 16px;
    /* Flat citron on moss — the loudest surface in the system, no gradient (§10). */
    background: var(--citron);
    color: var(--moss-black);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;

    .headline {
        font-family: var(--font-display);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.02em;
        text-transform: uppercase;
    }

    .body {
        font-size: 13px;
        font-weight: 500;
        opacity: 0.85;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .cta {
        font-family: var(--font-data);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        border-bottom: 1px solid rgba(19, 18, 8, 0.35);
        flex: 0 0 auto;
    }

    &:hover .cta {
        border-bottom-color: var(--moss-black);
    }

    /* Below 800px the body copy loses the fight for space — headline + CTA
       carry the message on their own. */
    @media (max-width: 800px) {
        gap: 8px;
        .headline { font-size: 12px; }
        .body { display: none; }
    }
`

const CREATOR_FEE_ABI = ['function TOKEN_OWNER_FEE_BPS() view returns (uint256)']

/**
 * The creator fee the contract is actually paying, in bps. `undefined` while
 * the read is in flight or if it fails — callers must treat that as "unknown",
 * never as "promo running".
 */
function useOnChainCreatorFeeBps() {
    const { chains } = useMainContext()
    const chain = chains?.find((c) => c.network === 'bsc') ?? chains?.[0]

    const { data } = useSWR<number | undefined>(
        chain ? ['/promo/creator-fee-bps', chain.contractAddress, chain.rpcUrl] : null,
        async () => {
            const provider = new ethers.JsonRpcProvider(chain!.rpcUrl)
            const fyuz = new ethers.Contract(chain!.contractAddress, CREATOR_FEE_ABI, provider)
            return Number(await fyuz.TOKEN_OWNER_FEE_BPS())
        },
        { revalidateOnFocus: false, dedupingInterval: 300_000, shouldRetryOnError: false },
    )
    return data
}

/**
 * Site-wide launch-promo strip, rendered on every page from MainLayout. Worded
 * and switched from CREATOR_FEE_PROMO in @/config — and, by default, held back
 * until the contract's creator fee actually matches the promo rate.
 */
export default function PromoBanner() {
    const liveBps = useOnChainCreatorFeeBps()

    const show = showCreatorFeePromo(liveBps)

    // Everything pinned to the top of the viewport reads this.
    useEffect(() => {
        const root = document.documentElement
        root.style.setProperty('--promo-h', show ? `${PROMO_BANNER_HEIGHT}px` : '0px')
        return () => root.style.setProperty('--promo-h', '0px')
    }, [show])

    if (!show) return null

    return (
        <Bar href={CREATOR_FEE_PROMO.href}>
            <span className="headline">⚡ {CREATOR_FEE_PROMO.headline}</span>
            <span className="body">{CREATOR_FEE_PROMO.body}</span>
            <span className="cta">{CREATOR_FEE_PROMO.cta} →</span>
        </Bar>
    )
}
