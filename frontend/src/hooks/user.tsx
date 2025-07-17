// import axios from "axios";
import useSWR from "swr";
// import { ethers } from "ethers";
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
          const { data } = await fetchBalance()
          return {
            balance: Number(data?.balance ?? 0)
          } as any
        }
        return undefined
      }, {
        refreshInterval: 5000,
      }
    )
    return {
        userInfo, setUserInfo: mutate
    }
}