

export interface TokenBucketOptions{
    capacity: number
    refillRatePerSecond: number
    initialTokens?: number
    now?:() => number
}

export interface ConsumeResult{
    allowed: boolean
    remainingTokens: number
    retryAfterMs: number

}

export class TokenBucket{
    private tokens: number
    private lastRefillAt: number
    private readonly now: ()=> number

    constructor(private readonly options: TokenBucketOptions){
        const {capacity, refillRatePerSecond, initialTokens}= options;

        if(!Number.isFinite(capacity) || capacity<=0){
            throw new Error("Capacity must be a finite number greater than 0")
        }

        if(!Number.isFinite(refillRatePerSecond) || refillRatePerSecond<=0){
            throw new Error("Refill rate must be a finite number greater than 0")
        }
        const startingTokens= initialTokens?? capacity

        if(!Number.isFinite(startingTokens) || startingTokens < 0 || startingTokens > capacity){
            throw new Error(`Initial Tokens must be betweek 0 and ${capacity}`)
        }

        this.now= options.now?? Date.now
        this.tokens= startingTokens
        this.lastRefillAt= this.now()
    }

    consume(cost=1): ConsumeResult{
        if(!Number.isFinite(cost) || cost<= 0){
            throw new Error("Cost must be a finite number greater than 0")
        }

        if(cost> this.options.capacity){
            throw new Error("Cost cannot exceed bucket capacity")
        }

        this.refill()

        if(this.tokens>= cost){
            this.tokens-=cost;

            return{ allowed:true, remainingTokens: this.tokens, retryAfterMs: 0}
        }
        //reject request return
        const tokensNeeded= cost - this.tokens
        const retryAfterMs = Math.ceil((tokensNeeded/this.options.refillRatePerSecond) * 1_000)
        return { allowed: false, remainingTokens: this.tokens, retryAfterMs,}
    }
    private refill(): void{
        const currentTime: number =  this.now()

        const elapsedMs= Math.max(0, currentTime - this.lastRefillAt)

        //latest timestamp would be greater in number
        this.lastRefillAt= Math.max(this.lastRefillAt, currentTime)    

        
        const addedTokens= (elapsedMs/1_000) * this.options.refillRatePerSecond

        //doesnt exceed total capacity
        this.tokens= Math.min(this.options.capacity, this.tokens+addedTokens)
    }

}