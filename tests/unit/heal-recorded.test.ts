import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabase } from '../../electron/main/db/database'
import { healCustomServiceRecipes } from '../../electron/main/db/seed'
import { recipes, services } from '../../electron/main/db/schema'
import { buildAutoRecipe } from '../../shared/custom-service'
import type { RecipeDefinition } from '../../shared/recipe'

/**
 * D10 / Plano Gravação Assistida (§4.5) — `healCustomServiceRecipes` roda a
 * cada boot e sobrescreve receitas custom divergentes. Uma receita GRAVADA
 * pelo usuário difere sempre do gerador automático: sem o guarda, o robô
 * some no boot seguinte, silenciosamente.
 */

const BASE = 'https://portal.exemplo.gov.br/'
const AUTH: Array<'certificate' | 'password'> = ['password']

function seedCustomService(db: ReturnType<typeof createDatabase>['db'], id = 'svc-custom-1') {
  const now = new Date().toISOString()
  db.insert(services)
    .values({
      id,
      slug: 'portal-exemplo',
      name: 'Portal Exemplo',
      category: 'Outros',
      baseUrl: BASE,
      allowedDomains: ['portal.exemplo.gov.br', '*.exemplo.gov.br'],
      authMethods: AUTH,
      defaultAuth: 'password',
      notes: null,
      isBuiltin: false,
      enabled: true,
      favorite: false,
      sortOrder: 999,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

function expectedDefinition(): RecipeDefinition {
  return buildAutoRecipe({ slug: 'portal-exemplo', baseUrl: BASE, authMethods: AUTH })
}

function insertRecipe(
  db: ReturnType<typeof createDatabase>['db'],
  serviceId: string,
  definition: RecipeDefinition,
  status: 'draft' | 'verified' | 'broken' | 'disabled' = 'draft',
  autoSubmit = true,
) {
  const now = new Date().toISOString()
  db.insert(recipes)
    .values({
      id: `recipe-${serviceId}`,
      serviceId,
      version: 3,
      definition,
      autoSubmit,
      status,
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

describe('healCustomServiceRecipes — receitas gravadas são intocáveis (D10)', () => {
  it('preserva receita com origin: "recorded" divergente do gerador', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const serviceId = seedCustomService(db)
      const recorded = {
        ...expectedDefinition(),
        origin: 'recorded',
        recordedAt: '2026-11-13T18:20:11.000Z',
        recordedScreens: 2,
        steps: [
          {
            action: 'click',
            selectors: ['#botao-entrar', 'text=Entrar'],
            source: 'recorded',
            label: 'Entrar',
          },
        ],
      } as unknown as RecipeDefinition
      insertRecipe(db, serviceId, recorded)

      const healed = healCustomServiceRecipes(db)

      expect(healed).toBe(0)
      const row = db.select().from(recipes).where(eq(recipes.serviceId, serviceId)).get()
      expect(row?.definition).toEqual(recorded)
      expect(row?.status).toBe('draft')
      expect(row?.version).toBe(3)
    } finally {
      close()
    }
  })

  it('preserva receita cujo passo carrega source: "recorded" (defesa em profundidade)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const serviceId = seedCustomService(db, 'svc-custom-2')
      const recordedStepOnly = {
        ...expectedDefinition(),
        steps: [
          {
            action: 'click',
            selectors: ['#btn', 'text=Acessar'],
            source: 'recorded',
          },
        ],
      } as unknown as RecipeDefinition
      insertRecipe(db, serviceId, recordedStepOnly, 'draft', false)

      const healed = healCustomServiceRecipes(db)

      expect(healed).toBe(0)
      const row = db.select().from(recipes).where(eq(recipes.serviceId, serviceId)).get()
      expect(row?.definition).toEqual(recordedStepOnly)
      // autoSubmit false preservado (não regenerou)
      expect(row?.autoSubmit).toBe(false)
    } finally {
      close()
    }
  })

  it('continua regenerando receita automática divergente sem marcadores (comportamento de hoje)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const serviceId = seedCustomService(db, 'svc-custom-3')
      const stale = {
        ...expectedDefinition(),
        steps: [{ action: 'sleep' as const, timeoutMs: 999 }],
      }
      insertRecipe(db, serviceId, stale, 'draft', false)

      const healed = healCustomServiceRecipes(db)

      expect(healed).toBe(1)
      const row = db.select().from(recipes).where(eq(recipes.serviceId, serviceId)).get()
      expect(row?.definition).toEqual(expectedDefinition())
      // autoSubmit do usuário preservado na regeneração
      expect(row?.autoSubmit).toBe(false)
      expect(row?.status).toBe('draft')
    } finally {
      close()
    }
  })

  it('continua intocando receita verified, mesmo gravada', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const serviceId = seedCustomService(db, 'svc-custom-4')
      const recordedVerified = {
        ...expectedDefinition(),
        origin: 'recorded',
      } as unknown as RecipeDefinition
      insertRecipe(db, serviceId, recordedVerified, 'verified')

      const healed = healCustomServiceRecipes(db)

      expect(healed).toBe(0)
      const row = db.select().from(recipes).where(eq(recipes.serviceId, serviceId)).get()
      expect(row?.definition).toEqual(recordedVerified)
      expect(row?.status).toBe('verified')
    } finally {
      close()
    }
  })
})
