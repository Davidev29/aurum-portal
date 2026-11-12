import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { RecipeSummary } from '../../../../shared/types'
import type { RecipeDefinition } from '../../../../shared/recipe'
import { recipeDefinitionSchema } from '../../../../shared/recipe'
import { BUILTIN_SERVICES } from '../../../../shared/builtins'
import { buildAutoRecipe } from '../../../../shared/custom-service'
import type { AppDatabase } from '../database'
import { AppError } from '../../errors'
import { recipes, services, type RecipeRow } from '../schema'

export function mapRecipeSummary(row: RecipeRow): RecipeSummary {
  return {
    id: row.id,
    serviceId: row.serviceId,
    version: row.version,
    status: row.status,
    autoSubmit: row.autoSubmit,
    lastVerifiedAt: row.lastVerifiedAt,
    definition: row.definition,
  }
}

export function getRecipeByService(db: AppDatabase, serviceId: string): RecipeRow | null {
  return db.select().from(recipes).where(eq(recipes.serviceId, serviceId)).get() ?? null
}

export function saveRecipe(
  db: AppDatabase,
  serviceId: string,
  definition: RecipeDefinition,
): RecipeSummary {
  const parsed = recipeDefinitionSchema.parse(definition)
  const service = db.select().from(services).where(eq(services.id, serviceId)).get()
  if (!service) throw new AppError('NOT_FOUND', 'Servico nao encontrado')
  if (!service.authMethods.includes(parsed.auth)) {
    throw new AppError(
      'VALIDATION',
      'O tipo de autenticacao da receita nao e aceito pelo servico',
    )
  }
  const existing = getRecipeByService(db, serviceId)
  const now = new Date().toISOString()
  if (existing) {
    const next: RecipeRow = {
      ...existing,
      version: existing.version + 1,
      definition: parsed,
      autoSubmit: parsed.autoSubmit,
      status: 'draft',
      lastVerifiedAt: null,
      updatedAt: now,
    }
    db.update(recipes).set(next).where(eq(recipes.id, existing.id)).run()
    return mapRecipeSummary(next)
  }
  const row: RecipeRow = {
    id: randomUUID(),
    serviceId,
    version: 1,
    definition: parsed,
    autoSubmit: parsed.autoSubmit,
    status: 'draft',
    lastVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(recipes).values(row).run()
  return mapRecipeSummary(row)
}

/**
 * Restaura a automação de um serviço. Nativos voltam à receita de fábrica;
 * personalizados recebem a automação gerada automaticamente a partir das
 * configurações atuais do cadastro (nome, endereço, métodos aceitos).
 */
export function resetRecipe(db: AppDatabase, serviceId: string): RecipeSummary | null {
  const service = db.select().from(services).where(eq(services.id, serviceId)).get()
  if (!service) throw new AppError('NOT_FOUND', 'Servico nao encontrado')
  const seed = BUILTIN_SERVICES.find((item) => item.id === serviceId)
  if (seed) return saveRecipe(db, serviceId, seed.recipe)
  const regenerated = buildAutoRecipe({
    slug: service.slug,
    baseUrl: service.baseUrl,
    authMethods: service.authMethods,
  })
  // Preserva a preferência do usuário ("Entrar sozinho") ao regenerar.
  const existing = getRecipeByService(db, serviceId)
  return saveRecipe(
    db,
    serviceId,
    existing ? { ...regenerated, autoSubmit: existing.autoSubmit } : regenerated,
  )
}

export function recordRecipeOutcome(
  db: AppDatabase,
  serviceId: string,
  outcome: 'verified' | 'broken',
): void {
  const existing = getRecipeByService(db, serviceId)
  if (!existing) return
  const now = new Date().toISOString()
  db.update(recipes)
    .set({
      status: outcome,
      lastVerifiedAt: outcome === 'verified' ? now : existing.lastVerifiedAt,
      updatedAt: now,
    })
    .where(eq(recipes.id, existing.id))
    .run()
}
