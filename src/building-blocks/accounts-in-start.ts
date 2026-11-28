/**
 * The provider accounts that a first start uses now, in memory (decision 0014). Until the agent
 * session exists, no `agent_sessions` row names the account. An edit of the account in that time
 * must not change the settings that the process started with, so the edit counts the account as
 * used: it makes a new current account. The composition root gives the same object to the slice
 * that starts the agent and to the slices that edit accounts.
 *
 * Several sessions can start with one account, so the set counts the starts.
 */
export class AccountsInStart {
  private readonly counts = new Map<string, number>()

  /** A first start begins with this account. Call `end` when it ends, also when it fails. */
  begin(providerId: string): void {
    this.counts.set(providerId, (this.counts.get(providerId) ?? 0) + 1)
  }

  end(providerId: string): void {
    const left = (this.counts.get(providerId) ?? 0) - 1
    if (left > 0) this.counts.set(providerId, left)
    else this.counts.delete(providerId)
  }

  has(providerId: string): boolean {
    return this.counts.has(providerId)
  }
}
