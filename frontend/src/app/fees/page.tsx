import type { Metadata } from "next"
import Fees from "@/views/Fees"

export const metadata: Metadata = {
    title: "Fees & Commercials",
    description:
        "Every fee on Fyuz in one place: 1% per trade on the bonding curve split between treasury, the season pot and the token's creator, the token creation fee, and what happens at graduation. Read live from the contract on BNB Smart Chain.",
    alternates: { canonical: "/fees" },
}

export default Fees
