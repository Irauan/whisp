/** One SQL migration. Version `n` takes the database from `user_version` n-1 to n. */
export interface Migration {
  version: number
  name: string
  sql: string
}

const FILE = /(\d{3})-([a-z0-9-]+)\.sql$/

/**
 * Orders the migration files by their number and checks the numbers: 1, 2, 3 and so on, with
 * no gap and no repeat. A broken list is a defect, so it throws.
 * @param files The text of each `NNN-name.sql` file, by its path.
 */
export function orderMigrations(files: Readonly<Record<string, string>>): Migration[] {
  const found = Object.entries(files).map(([path, sql]) => {
    const match = FILE.exec(path.replaceAll('\\', '/').split('/').pop() ?? '')
    if (!match) throw new Error(`The migration file ${path} must be named NNN-name.sql.`)
    return { version: Number(match[1]), name: match[2] ?? '', sql }
  })
  found.sort((a, b) => a.version - b.version)
  found.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`The migrations must be numbered 1, 2, 3 without a gap. Found ${migration.version} at place ${index + 1}.`)
    }
  })
  return found
}

/** The migrations of the product, from `src/database/migrations`. The bundler inlines the files. */
export const MIGRATIONS: readonly Migration[] = orderMigrations(
  import.meta.glob<string>('../database/migrations/*.sql', { query: '?raw', import: 'default', eager: true })
)
