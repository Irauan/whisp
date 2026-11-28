import { describe, expect, it } from 'vitest'
import { AccountsInStart } from './accounts-in-start'

describe('AccountsInStart', () => {
  it('knows an account between begin and end', () => {
    const accounts = new AccountsInStart()
    expect(accounts.has('v1')).toBe(false)
    accounts.begin('v1')
    expect(accounts.has('v1')).toBe(true)
    expect(accounts.has('v2')).toBe(false)
    accounts.end('v1')
    expect(accounts.has('v1')).toBe(false)
  })

  it('counts the starts, so that one end does not free an account that another start uses', () => {
    const accounts = new AccountsInStart()
    accounts.begin('v1')
    accounts.begin('v1')
    accounts.end('v1')
    expect(accounts.has('v1')).toBe(true)
    accounts.end('v1')
    expect(accounts.has('v1')).toBe(false)
  })

  it('ignores an end without a begin', () => {
    const accounts = new AccountsInStart()
    accounts.end('v1')
    accounts.begin('v1')
    expect(accounts.has('v1')).toBe(true)
  })
})
