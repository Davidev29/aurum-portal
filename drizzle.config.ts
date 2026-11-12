import type { Config } from 'drizzle-kit'

export default {
  schema: './electron/main/db/schema.ts',
  out: './electron/main/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/aurumbit-portal.db',
  },
} satisfies Config
