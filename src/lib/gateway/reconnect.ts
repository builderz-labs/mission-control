
export class ReconnectStrategy {
    private attempts = 0
    private timer: ReturnType<typeof setTimeout> | null = null
    private stopped = false

    constructor(
        private maxAttempts = 10,
        private baseDelay = 1_000,
        private maxDelay = 30_000,
        private jitterFactor = 0.5,
    ) { }

    /**
     * Schedule the next reconnection attempt.
     * Returns false if max attempts reached or stopped.
     */
    scheduleNext(callback: () => void): boolean {
        if (this.stopped || this.attempts >= this.maxAttempts) return false

        const base = Math.min(this.baseDelay * Math.pow(2, this.attempts), this.maxDelay)
        const jitter = Math.random() * base * this.jitterFactor
        const delay = Math.round(base + jitter)

        this.attempts++
        this.timer = setTimeout(callback, delay)
        return true
    }


    get currentAttempts(): number {
        return this.attempts
    }


    reset(): void {
        this.attempts = 0
        this.stopped = false
        this.cancelPending()
    }


    stop(): void {
        this.stopped = true
        this.cancelPending()
    }


    get isStopped(): boolean {
        return this.stopped
    }


    get isExhausted(): boolean {
        return this.attempts >= this.maxAttempts
    }

    private cancelPending(): void {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
    }
}
