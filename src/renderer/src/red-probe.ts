// RED PROBE (G4): localStorage in new renderer code. Do not merge.
export function redProbe(): string | null {
  return localStorage.getItem('red-probe')
}
