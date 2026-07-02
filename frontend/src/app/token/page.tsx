'use client'

import dynamic from "next/dynamic"
import { Suspense } from "react"

// The token view is a heavy client component (TradingView chart, wallet hooks,
// useSearchParams). Rendering it client-only avoids the SSR/hydration mismatch
// that was crashing the page with "insertBefore ... is not a child of this node".
const Token = dynamic(() => import("@/views/Token"), { ssr: false })

export default function TokenPage() {
    return (
        <Suspense fallback={null}>
            <Token />
        </Suspense>
    )
}
