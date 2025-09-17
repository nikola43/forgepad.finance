import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { 
    ActivationType, 
    BaseFeeMode, 
    BuildCurveBaseParam, 
    buildCurveWithMarketCap, 
    CollectFeeMode, 
    DynamicBondingCurveClient, 
    MigrationFeeOption, 
    MigrationOption, 
    TokenDecimal, 
    TokenType 
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'
import bs58 from 'bs58'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Type definitions
interface CurveConfig {
    totalTokenSupply: number
    initialMarketCap: number
    migrationMarketCap: number
    startingFeeBps: number
    endingFeeBps: number
}

interface SolanaConfig {
    rpcUrl: string
    privateKey: string
    quoteMint: string
}

// Utility function to convert BN to decimal with proper typing
export function convertBNToDecimal<T>(obj: T): any {
    if (obj instanceof BN) {
        return obj.toString(10)
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => convertBNToDecimal(item))
    }
    if (obj && typeof obj === 'object' && obj !== null) {
        const result: any = {}
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = convertBNToDecimal((obj as any)[key])
            }
        }
        return result
    }
    return obj
}

// Configuration validation
function validateEnvironment(): SolanaConfig {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    const privateKey = process.env.SOLANA_PRIVATE_KEY
    const quoteMint = process.env.SOLANA_QUOTE_MINT || 'So11111111111111111111111111111111111111112' // SOL

    if (!privateKey) {
        throw new Error('SOLANA_PRIVATE_KEY environment variable is required')
    }

    // Validate private key format
    try {
        bs58.decode(privateKey)
    } catch (error) {
        throw new Error('Invalid SOLANA_PRIVATE_KEY format. Must be base58 encoded.')
    }

    return { rpcUrl, privateKey, quoteMint }
}

// Create curve configuration
function createCurveConfig(config: CurveConfig): BuildCurveBaseParam {
    return {
        totalTokenSupply: config.totalTokenSupply,
        migrationOption: MigrationOption.MET_DAMM_V2,
        tokenBaseDecimal: TokenDecimal.NINE,
        tokenQuoteDecimal: TokenDecimal.NINE,
        lockedVestingParam: {
            totalLockedVestingAmount: 0,
            numberOfVestingPeriod: 0,
            cliffUnlockAmount: 0,
            totalVestingDuration: 0,
            cliffDurationFromMigrationTime: 0,
        },
        baseFeeParams: {
            baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
            feeSchedulerParam: {
                startingFeeBps: config.startingFeeBps,
                endingFeeBps: config.endingFeeBps,
                numberOfPeriod: 0,
                totalDuration: 0,
            },
        },
        dynamicFeeEnabled: true,
        activationType: ActivationType.Slot,
        collectFeeMode: CollectFeeMode.QuoteToken,
        migrationFeeOption: MigrationFeeOption.FixedBps100,
        tokenType: TokenType.SPL,
        partnerLpPercentage: 0,
        creatorLpPercentage: 0,
        partnerLockedLpPercentage: 100,
        creatorLockedLpPercentage: 0,
        creatorTradingFeePercentage: 0,
        leftover: 0,
        tokenUpdateAuthority: 0,
        migrationFee: {
            feePercentage: 100,
            creatorFeePercentage: 0,
        },
    }
}

// Main function to create dynamic bonding curve
export async function createDynamicBondingCurve(curveConfig: CurveConfig): Promise<string> {
    try {
        // Validate environment
        const solanaConfig = validateEnvironment()
        
        // Create connection
        const connection = new Connection(solanaConfig.rpcUrl, 'confirmed')
        const client = new DynamicBondingCurveClient(connection, 'confirmed')

        // Create keypairs
        const keypair = Keypair.fromSecretKey(bs58.decode(solanaConfig.privateKey))
        const configKeypair = Keypair.generate()

        console.log('Payer Public Key:', keypair.publicKey.toBase58())
        console.log('Config Public Key:', configKeypair.publicKey.toBase58())

        // Create base parameters
        const baseParams = createCurveConfig(curveConfig)

        // Build curve configuration
        const config = buildCurveWithMarketCap({
            ...baseParams,
            initialMarketCap: curveConfig.initialMarketCap,
            migrationMarketCap: curveConfig.migrationMarketCap,
        })

        console.log('Migration Quote Threshold:', 
            config.migrationQuoteThreshold
                .div(new BN(10 ** TokenDecimal.NINE))
                .toString()
        )
        console.log('Sqrt Start Price:', convertBNToDecimal(config.sqrtStartPrice))
        console.log('Curve Config:', convertBNToDecimal(config.curve))

        // Create transaction
        const transaction: Transaction = await client.partner.createConfig({
            ...config,
            payer: keypair.publicKey,
            config: configKeypair.publicKey,
            feeClaimer: keypair.publicKey,
            leftoverReceiver: keypair.publicKey,
            quoteMint: new PublicKey(solanaConfig.quoteMint),
        })

        // Send transaction
        const txid = await connection.sendTransaction(transaction, [keypair, configKeypair], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        })

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(txid, 'confirmed')
        
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`)
        }

        console.log('Transaction confirmed:', txid)
        return txid

    } catch (error) {
        console.error('Error creating dynamic bonding curve:', error)
        throw error
    }
}

// Example usage function
async function main() {
    try {
        const curveConfig: CurveConfig = {
            totalTokenSupply: 1000000000,
            initialMarketCap: 30,
            migrationMarketCap: 388,
            startingFeeBps: 250,
            endingFeeBps: 250,
        }

        const txid = await createDynamicBondingCurve(curveConfig)
        console.log('Dynamic Bonding Curve created successfully. Transaction ID:', txid)
    } catch (error) {
        console.error('Failed to create dynamic bonding curve:', error)
        process.exit(1)
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main()
}
