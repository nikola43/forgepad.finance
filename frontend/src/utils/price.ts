export const priceWithoutZero = (price: number | string) => {
    return String(price).replace(/\.(.*[^0])0+$/, ".$1").replace(/\.0+$/, "")
}

export const priceFormatter = (value: number | string, decimals = 18, willRemoveTail = true, hasUnits = false) => {
    const formatter = new Intl.NumberFormat('en-US')
    if(!value || value == 0)
        return '0'
    let unit = ''
    function addUnit(v: number) {
        if(!hasUnits)
            return v
        if(v > 1e9) {
            unit = 'B'
            return v / 1e9
        }
        if(v > 1e6) {
            unit = 'M'
            return v / 1e6
        }
        if(v > 1e3) {
            unit = 'K'
            return v / 1e3
        }
        return v
    }
    function removeTail(v: string) {
        return willRemoveTail ? priceWithoutZero(v) : v
    }
    const price = addUnit(Number(value))
    let fractions = 18
    if(Math.abs(price) > 1)
        fractions = 2
    if(Math.abs(price) > 0.0001)
        fractions = 6
    fractions = unit ? 2 : Math.min(decimals, fractions)
    const [upper, under] = price.toFixed(fractions).split('.')
    if(Number(upper) > 0 || fractions <= 6)
        return `${removeTail(`${formatter.format(Number(upper))}.${under ?? 0}`)}${unit}`
    const count = under.match(/0+/)?.[0].length ?? 0
    const subscripts = '₀₁₂₃₄₅₆₇₈₉'
    return removeTail(`${formatter.format(Number(upper))}.0${String(count).split('').map(n => subscripts[Number(n)]).join('')}${under.slice(count, count + 4)}`)
}