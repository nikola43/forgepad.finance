export default function Loading() {
    return <div className="spin-box">
        <svg viewBox="0 0 110 110" width="120" height="120">
            <defs>
                <linearGradient id="loadingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{ stopColor: "#FFA600", stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: "#FFD700", stopOpacity: 1 }} />
                </linearGradient>
            </defs>
            <rect
                x="2"
                y="2"
                width="106"
                fill="none"
                stroke="url(#loadingGradient)"
                strokeWidth="3"
                height="106"
                rx="20"
                strokeDasharray="134 263"
                style={{
                    filter: "drop-shadow(0 0 8px rgba(255, 166, 0, 0.5))"
                }}
            />
        </svg>
    </div>
}