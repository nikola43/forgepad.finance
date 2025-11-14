// import axios from "axios";
import useSWR from "swr";
import { ethers } from "ethers";
import { useAppKitAccount, useAppKitBalance } from "@reown/appkit/react";
// import { useMainContext } from "@/context";

export function useUserInfo() {
    const { address } = useAppKitAccount()
    const { fetchBalance } = useAppKitBalance()

    const { data: userInfo, mutate } = useSWR(
      address ? '/info/user' : undefined,
      async () => {
        // const { data } = await axios.get(`${SERVER_URL}/users`, {
        //     params: {
        //         userAddress: address,
        //     },
        // }).catch(() => ({ data: {} }))
        if (fetchBalance) {
          try {
            const result = await fetchBalance()
            console.log('Balance fetch result:', result)

            // Get the balance from the result
            const balanceData: any = result?.data
            const balanceInWei = balanceData?.value || balanceData?.balance || balanceData?.formatted || '0'

            // If the balance is already formatted as a string (e.g., "10.5"), use it directly
            let balanceInEther: string
            if (typeof balanceInWei === 'string' && balanceInWei.includes('.')) {
              balanceInEther = balanceInWei
            } else {
              // Otherwise convert from Wei to Ether
              balanceInEther = ethers.formatEther(balanceInWei.toString())
            }

            console.log('Balance in Wei:', balanceInWei)
            console.log('Balance in Ether:', balanceInEther)

            return {
              balance: Number(balanceInEther)
            } as any
          } catch (error) {
            console.error('Error fetching balance:', error)
            return {
              balance: 0
            } as any
          }
        }
        return {
          balance: 0
        } as any
      }, {
        refreshInterval: 5000,
      }
    )
    return {
        userInfo, setUserInfo: mutate
    }
}