export default function Loading() {
    return <div className="spin-box">
        <svg viewBox="0 0 110 110" width="140" height="140">
            <defs>
                <linearGradient id="loadingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{ stopColor: "#D3FF24", stopOpacity: 1 }} />
                    <stop offset="50%" style={{ stopColor: "#e4ff66", stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: "#D3FF24", stopOpacity: 1 }} />
                </linearGradient>
                <filter id="glow">
                    <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <rect
                x="2"
                y="2"
                width="106"
                fill="none"
                stroke="url(#loadingGradient)"
                strokeWidth="4"
                height="106"
                rx="24"
                strokeDasharray="134 263"
                style={{
                    filter: "url(#glow) drop-shadow(0 0 20px rgba(209, 255, 26, 0.6))"
                }}
            />
        </svg>
    </div>
}