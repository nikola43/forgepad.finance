const { ethers } = require("ethers");

const MIN_TICK = -887272;
const MAX_TICK = 887272;
const Q96 = 2n ** 96n;
const TICK_SPACING = 60

function getSqrtX96(amount0, amount1) {
    function _sqrt(x) {
        let z = (x + 1n) / 2n;
        let y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2n;
        }
        return y
    }
    const price = amount1 * 1000000000000000000n / amount0
    const sqrtPrice = _sqrt(price * 1000000000000000000n)
    return sqrtPrice * (2n ** 96n) / 1000000000000000000n
}

function createPool(amount0Desired, amount1Desired) {
    // Convert to BigInt if they aren't already
    const amount0 = BigInt(amount0Desired);
    const amount1 = BigInt(amount1Desired);
    
    // Get sqrt ratios for full range
    let sqrtRatioAX96 = getSqrtRatioAtTick(Math.floor(MIN_TICK / TICK_SPACING) * TICK_SPACING);
    let sqrtRatioBX96 = getSqrtRatioAtTick(Math.floor(MAX_TICK / TICK_SPACING) * TICK_SPACING);
    let sqrtRatioX96 = getSqrtX96(amount0Desired, amount1Desired);
    
    // Calculate liquidity
    if (sqrtRatioAX96 > sqrtRatioBX96) {
        [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
    }

    const pool = {
        sqrtRatioX96
    }
    
    if (sqrtRatioX96 <= sqrtRatioAX96) {
        pool.liquidity = getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
    } else if (sqrtRatioX96 < sqrtRatioBX96) {
        const liquidity0 = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
        const liquidity1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);

        pool.liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    } else {
        pool.liquidity = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
    }

    pool.amount0 = getAmount0Delta(sqrtRatioBX96, sqrtRatioX96, pool.liquidity)
    pool.amount1 = getAmount1Delta(sqrtRatioAX96, sqrtRatioX96, pool.liquidity)
    
    return pool
}

function getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) {
    if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
    const intermediate = sqrtRatioAX96 * sqrtRatioBX96 / Q96
    return amount0 * intermediate / (sqrtRatioBX96 - sqrtRatioAX96)
}

function getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) {
    if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
    return amount1 * Q96 / (sqrtRatioBX96 - sqrtRatioAX96)
}

// Calculate sqrt ratio at tick (Uniswap V3 formula)
function getSqrtRatioAtTick(tick) {
    const absTick = BigInt(Math.abs(tick));
    let ratio = (absTick & 1n) !== 0n ? 
        0xfffcb933bd6fad37aa2d162d1a594001n : 
        0x100000000000000000000000000000000n;
    
    if ((absTick & 0x2n) !== 0n) ratio = ratio * 0xfff97272373d413259a46990580e213an / Q96;
    if ((absTick & 0x4n) !== 0n) ratio = ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn / Q96;
    if ((absTick & 0x8n) !== 0n) ratio = ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n / Q96;
    if ((absTick & 0x10n) !== 0n) ratio = ratio * 0xffcb9843d60f6159c9db58835c926644n / Q96;
    if ((absTick & 0x20n) !== 0n) ratio = ratio * 0xff973b41fa98c081472e6896dfb254c0n / Q96;
    if ((absTick & 0x40n) !== 0n) ratio = ratio * 0xff2ea16466c96a3843ec78b326b52861n / Q96;
    if ((absTick & 0x80n) !== 0n) ratio = ratio * 0xfe5dee046a99a2a811c461f1969c3053n / Q96;
    if ((absTick & 0x100n) !== 0n) ratio = ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n / Q96;
    if ((absTick & 0x200n) !== 0n) ratio = ratio * 0xf987a7253ac413176f2b074cf7815e54n / Q96;
    if ((absTick & 0x400n) !== 0n) ratio = ratio * 0xf3392b0822b70005940c7a398e4b70f3n / Q96;
    if ((absTick & 0x800n) !== 0n) ratio = ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n / Q96;
    if ((absTick & 0x1000n) !== 0n) ratio = ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n / Q96;
    if ((absTick & 0x2000n) !== 0n) ratio = ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n / Q96;
    if ((absTick & 0x4000n) !== 0n) ratio = ratio * 0x70d869a156d2a1b890bb3df62baf32f7n / Q96;
    if ((absTick & 0x8000n) !== 0n) ratio = ratio * 0x31be135f97d08fd981231505542fcfa6n / Q96;
    if ((absTick & 0x10000n) !== 0n) ratio = ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n / Q96;
    if ((absTick & 0x20000n) !== 0n) ratio = ratio * 0x5d6af8dedb81196699c329225ee604n / Q96;
    if ((absTick & 0x40000n) !== 0n) ratio = ratio * 0x2216e584f5fa1ea926041bedfe98n / Q96;
    if ((absTick & 0x80000n) !== 0n) ratio = ratio * 0x48a170391f7dc42444e8fa2n / Q96;

    if (tick > 0) ratio = Q96 * Q96 / ratio;
    
    // Round to nearest
    return ratio;
}

// Calculate amount0 delta (token0 amount) from liquidity change
function getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
        [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
    }

    const numerator1 = liquidity << 96n; // Multiply by Q96
    const numerator2 = sqrtRatioBX96 - sqrtRatioAX96;

    return (numerator1 * numerator2) / sqrtRatioBX96 / sqrtRatioAX96;
}

// Calculate amount1 delta (token1 amount) from liquidity change
function getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
        [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
    }

    return (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) / Q96;
}

function getAmount1Out(liquidity, sqrtPriceX96, amount0In) {
    const sqrtPrice = BigInt(sqrtPriceX96);
    const amount0 = BigInt(amount0In);
    
    // Calculate new sqrt price after swap
    const numerator = liquidity * sqrtPrice * Q96;
    const denominator = liquidity * Q96 + amount0 * sqrtPrice;
    const sqrtPriceNextX96 = numerator / denominator;
    
    // Calculate amount1 out
    const amount1 = (liquidity * (sqrtPrice - sqrtPriceNextX96)) / Q96;
    
    return amount1;
}

const ethPrice = 2491.65

// const virtualEthReserve = 5
// const virtualTokenReserve = 800000000
for (let virtualEthReserve = 0.5; virtualEthReserve < 10; virtualEthReserve += 0.5) {
    for (let virtualTokenReserve = 100000000; virtualTokenReserve < 10000000000; virtualTokenReserve += 50000000) {
        const ethReserve = Math.sqrt(69000 * virtualEthReserve * virtualTokenReserve / ethPrice / 1000000000) - virtualEthReserve
        const tokenReserve = 1000000000 - ethReserve * virtualTokenReserve / (virtualEthReserve + ethReserve)

        if (tokenReserve > 1000000000)
            continue

        const amount0Desired = BigInt(ethers.utils.parseEther(tokenReserve.toFixed(2)).toString())
        const amount1Desired = BigInt(ethers.utils.parseEther(ethReserve.toFixed(2)).toString())

        console.log('Initial virtual reserves', virtualEthReserve, virtualTokenReserve)

        const amounts = {}
        for (let i = 1; i<10; i++) {
            const amount = i * 10000000
            if (amount >= virtualTokenReserve)
                break
            console.log('- buy token', amount / 1000000, 'M at first time, should pay', amount * virtualEthReserve / (virtualTokenReserve - amount) / 0.99)
            amounts[amount] = amount * virtualEthReserve / (virtualTokenReserve - amount) / 0.99
        }
        for (let i = 1; i<10; i++) {
            const amount = i * 100000000
            if (amount >= virtualTokenReserve)
                break
            console.log('- buy token', amount / 1000000, 'M at first time, should pay', amount * virtualEthReserve / (virtualTokenReserve - amount) / 0.99)
            amounts[amount] = amount * virtualEthReserve / (virtualTokenReserve - amount) / 0.99
        }

        console.log('when launch, desired amounts are', ethers.utils.formatEther(amount0Desired), ethers.utils.formatEther(amount1Desired))

        const pool = createPool(amount0Desired, amount1Desired)
        console.log('pool info')
        console.log(' token0:', Number(ethers.utils.formatEther(pool.amount0)))
        console.log(' token1:', Number(ethers.utils.formatEther(pool.amount1)))
        console.log(' sqrtPrice:', pool.sqrtRatioX96)
        console.log(' liquidity:', pool.liquidity)

        for (let i = 1n;i<10n;i++) {
            if (10000000 * Number(i) > Number(ethers.utils.formatEther(pool.amount0))) break
            const earn = Number(ethers.utils.formatEther(getAmount1Out(pool.liquidity, pool.sqrtRatioX96, 10000000000000000000000000n * i)))
            const profit = amounts[10000000 * Number(i)] ? earn / amounts[10000000 * Number(i)] : 0
            console.log('- sold token', Number(ethers.utils.formatEther(10000000000000000000n * i)), 'M at first time, will get', earn, profit ? `(${profit.toFixed(1)}x)` : '')
        }
        for (let i = 1n;i<10n;i++) {
            if (100000000 * Number(i) > Number(ethers.utils.formatEther(pool.amount0))) break
            const earn = Number(ethers.utils.formatEther(getAmount1Out(pool.liquidity, pool.sqrtRatioX96, 100000000000000000000000000n * i)))
            const profit = amounts[10000000 * Number(i)] ? earn / amounts[100000000 * Number(i)] : 0
            console.log('- sold token', Number(ethers.utils.formatEther(100000000000000000000n * i)), 'M at first time, will get', earn, profit ? `(${profit.toFixed(1)}x)` : '')
        }
        console.log("")
    }
    console.log("")
}
