// Fixture for G4: localStorage and sessionStorage in renderer code.
export function save(value: string): void {
  localStorage.setItem('key', value)
  sessionStorage.setItem('key', value)
  window.localStorage.setItem('key', value)
}

export function saveFromSelf(value: string): void {
  self.localStorage.setItem('key', value)
  self.sessionStorage.setItem('key', value)
}
