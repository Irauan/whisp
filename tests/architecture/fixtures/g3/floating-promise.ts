// Fixture for G3: a floating promise.
export async function load(): Promise<number> {
  return 1
}

export function run(): void {
  load()
}
