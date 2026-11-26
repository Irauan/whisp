// RED PROBE (G3): a floating promise in src/main. Do not merge.
async function redProbeWork(): Promise<number> {
  return 1
}

export function redProbe(): void {
  redProbeWork()
}
