import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { semAspas } from '../utils/env'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _sql: ReturnType<typeof postgres> | null = null

function connectionString() {
  const url = semAspas(process.env.DATABASE_URL || useRuntimeConfig().databaseUrl)
  if (!url) {
    throw new Error('DATABASE_URL nao configurada no .env')
  }
  return url
}

export function useSql() {
  if (!_sql) {
    _sql = postgres(connectionString(), { max: 5, prepare: false })
  }
  return _sql
}

export function useDb() {
  if (!_db) {
    _db = drizzle(useSql(), { schema })
  }
  return _db
}

export { schema }
export * from './schema'
