export interface RateLimitPolicy{
    id: string
    capacity: number
    refillRatePerSecond: number

}

export const defaultPolicy: RateLimitPolicy ={
    id:"demo",
    capacity: 3,
    refillRatePerSecond: 1
}