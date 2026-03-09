import useSWR from "swr";
import { ethers } from "ethers";
import { useAppKitAccount } from "@reown/appkit/react";
import { isDevEnv } from "@/config";

const LOCAL_RPC = "http://127.0.0.1:8545";

export function useUserInfo() {
    const { address } = useAppKitAccount()

    const { data: userInfo, mutate } = useSWR(
      address ? '/info/user' : undefined,
      async () => {
        if (!address) return { balance: 0 } as any
        try {
          // In dev mode, query local Anvil directly; in prod, use wallet's provider
          const provider = isDevEnv
            ? new ethers.JsonRpcProvider(LOCAL_RPC)
            : new ethers.BrowserProvider((window as any).ethereum)
          const balanceWei = await provider.getBalance(address)
          const balanceInEther = ethers.formatEther(balanceWei)
          console.log('Balance:', balanceInEther, 'BNB')
          return {
            balance: Number(balanceInEther)
          } as any
        } catch (error) {
          console.error('Error fetching balance:', error)
          return {
            balance: 0
          } as any
        }
      }, {
        refreshInterval: 5000,
      }
    )
    return {
        userInfo, setUserInfo: mutate
    }
}
