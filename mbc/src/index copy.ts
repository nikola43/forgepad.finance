import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { ActivationType, BaseFeeMode, BuildCurveBaseParam, buildCurveWithMarketCap, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption, MigrationOption, TokenDecimal, TokenType } from '@meteora-ag/dynamic-bonding-curve-sdk'
const BN = require('bn.js');
import bs58 from 'bs58'

export function convertBNToDecimal<T>(obj: T): T {
    if (obj instanceof BN) {
        // @ts-ignore
        return obj.toString(10) as T
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => convertBNToDecimal(item)) as T
    }
    if (obj && typeof obj === 'object') {
        const result = {} as T
        for (const key in obj) {
            result[key] = convertBNToDecimal(obj[key])
        }
        return result
    }
    return obj
}

const main = async () => {
    const connection = new Connection('https://api.mainnet-beta.solana.com')
    const client = new DynamicBondingCurveClient(connection, 'confirmed')

    const pk = "39RmsX944XpRDMt7VporoLYu9wmaiSj7svBCHypfcd8Xzpz5fchFHWrZsjP2UKSdyCGiZbRbbhNBkrtaA3c9o4cN"
    let keypair = Keypair.fromSecretKey(bs58.decode(pk));
    console.log('Keypair:', keypair.publicKey.toBase58())
    const configKeypair = Keypair.generate()
    console.log('Config Keypair:', configKeypair.publicKey.toBase58())
    console.log("Config Keypair Secret Key:", bs58.encode(configKeypair.secretKey))

    const baseParams: BuildCurveBaseParam = {
        totalTokenSupply: 1000000000,
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
                startingFeeBps: 250,
                endingFeeBps: 250,
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

    const config = buildCurveWithMarketCap({
        ...baseParams,
        initialMarketCap: 30,
        migrationMarketCap: 388,
    })

    console.log(
        'migrationQuoteThreshold: %d',
        config.migrationQuoteThreshold
            .div(new BN(10 ** TokenDecimal.NINE))
            .toString()
    )
    console.log('sqrtStartPrice', convertBNToDecimal(config.sqrtStartPrice))
    console.log('curve', convertBNToDecimal(config.curve))


    const curve: Transaction = await client.partner.createConfig({
        ...config,
        payer: keypair.publicKey,
        config: configKeypair.publicKey,
        feeClaimer: keypair.publicKey,
        leftoverReceiver: keypair.publicKey,
        quoteMint: new PublicKey('So11111111111111111111111111111111111111112'),
    })
    console.log('Curve Transaction:', curve)
    const txid = await connection.sendTransaction(curve, [keypair, configKeypair])
    console.log('Transaction ID:', txid)


    // const baseParams: BuildCurveWithMarketCapParam = {
    //     totalTokenSupply: 1000000000,
    //     migrationOption: MigrationOption.MET_DAMM_V2,
    //     tokenBaseDecimal: TokenDecimal.SIX,
    //     tokenQuoteDecimal: TokenDecimal.NINE,
    //     initialMarketCap: 30,
    //     migrationMarketCap: 40,
    //     lockedVestingParam: {
    //         totalLockedVestingAmount: 0,
    //         numberOfVestingPeriod: 0,
    //         cliffUnlockAmount: 0,
    //         totalVestingDuration: 0,
    //         cliffDurationFromMigrationTime: 0,
    //     },
    //     baseFeeParams: {
    //         baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
    //         feeSchedulerParam: {
    //             startingFeeBps: 100,
    //             endingFeeBps: 100,
    //             numberOfPeriod: 0,
    //             totalDuration: 0,
    //         },
    //     },
    //     dynamicFeeEnabled: true,
    //     activationType: ActivationType.Slot,
    //     collectFeeMode: CollectFeeMode.OutputToken,
    //     migrationFeeOption: MigrationFeeOption.FixedBps100,
    //     tokenType: TokenType.SPL,
    //     partnerLpPercentage: 0,
    //     creatorLpPercentage: 0,
    //     partnerLockedLpPercentage: 100,
    //     creatorLockedLpPercentage: 0,
    //     creatorTradingFeePercentage: 0,
    //     leftover: 0,
    //     tokenUpdateAuthority: 0,
    //     migrationFee: {
    //         feePercentage: 10,
    //         creatorFeePercentage: 50,
    //     },
    // }


    // const config: ConfigParameters = await buildCurveWithMarketCap(baseParams)
    // console.log(config)

    // const curve: Transaction = await client.partner.createConfig(config)
    // console.log('Curve Transaction:', curve)
    // const txid = await connection.sendTransaction(curve, [keypair])







}


main()
    .then(() => console.log('Dynamic Bonding Curve Client initialized successfully'))
    .catch((error) => console.error('Error initializing Dynamic Bonding Curve Client:', error))
