import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Service, ServiceFilter, ServiceInput } from '../../../../shared/types'
import { serviceInputSchema } from '../../../../shared/contracts'
import { emptyToNull } from '../../security/redaction'
import type { AppDatabase } from '../database'
import { AppError } from '../../errors'
import { services, type RecipeRow, type ServiceRow } from '../schema'
import { mapRecipeSummary, getRecipeByService, saveRecipe } from './recipes'

export function mapService(
  row: ServiceRow,
  recipe: RecipeRow | null,
  openSessions: number,
  logoUrl: string | null,
): Service {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category as Service['category'],
    baseUrl: row.baseUrl,
    allowedDomains: row.allowedDomains,
    authMethods: row.authMethods,
    defaultAuth: row.defaultAuth,
    logoUrl,
    notes: row.notes,
    recipe: recipe ? mapRecipeSummary(recipe) : null,
    isBuiltin: row.isBuiltin,
    enabled: row.enabled,
    favorite: row.favorite,
    sortOrder: row.sortOrder,
    openSessions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listServiceRows(db: AppDatabase, filter: ServiceFilter = {}): ServiceRow[] {
  const rows = db.select().from(services).all()
  const search = filter.search?.trim().toLowerCase()
  return rows
    .filter((row) => {
      if (filter.enabledOnly && !row.enabled) return false
      if (filter.favorite && !row.favorite) return false
      if (filter.category && filter.category !== 'all' && row.category !== filter.category)
        return false
      if (!search) return true
      return [row.name, row.slug, row.category, row.baseUrl]
        .join(' ')
        .toLowerCase()
        .includes(search)
    })
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, 'pt-BR'),
    )
}

/**
 * Garante um slug único acrescentando sufixo `-2`, `-3`… quando necessário.
 * Usado no caminho simplificado de cadastro: o usuário não vê o slug, então
 * uma colisão não pode virar erro técnico na tela dele.
 */
export function ensureUniqueSlug(db: AppDatabase, base: string): string {
  const normalized = slugBase(base)
  const taken = (slug: string): boolean =>
    Boolean(db.select().from(services).where(eq(services.slug, slug)).get())
  if (!taken(normalized)) return normalized
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${normalized.slice(0, 76)}-${suffix}`
    if (!taken(candidate)) return candidate
  }
  return `${normalized.slice(0, 72)}-${Date.now().toString(36)}`
}

function slugBase(base: string): string {
  const slug = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'servico'
}

export function getServiceRow(db: AppDatabase, id: string): ServiceRow {
  const row = db.select().from(services).where(eq(services.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Servico nao encontrado')
  return row
}

export function createService(db: AppDatabase, input: ServiceInput): ServiceRow {
  const parsed = serviceInputSchema.parse(input)
  const slugTaken = db.select().from(services).where(eq(services.slug, parsed.slug)).get()
  if (slugTaken) throw new AppError('CONFLICT', 'Ja existe um servico com este slug')
  const now = new Date().toISOString()
  const row: ServiceRow = {
    id: randomUUID(),
    slug: parsed.slug,
    name: parsed.name,
    category: parsed.category,
    baseUrl: parsed.baseUrl,
    allowedDomains: parsed.allowedDomains,
    authMethods: parsed.authMethods as ServiceRow['authMethods'],
    defaultAuth: parsed.defaultAuth as ServiceRow['defaultAuth'],
    logoPath: null,
    notes: emptyToNull(parsed.notes),
    isBuiltin: false,
    enabled: parsed.enabled ?? true,
    favorite: parsed.favorite ?? false,
    sortOrder: 1000,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(services).values(row).run()
  return row
}

export function updateService(
  db: AppDatabase,
  id: string,
  input: Partial<ServiceInput>,
): ServiceRow {
  const current = getServiceRow(db, id)
  const merged = {
    name: current.name,
    slug: current.slug,
    category: current.category,
    baseUrl: current.baseUrl,
    allowedDomains: current.allowedDomains,
    authMethods: current.authMethods,
    defaultAuth: current.defaultAuth,
    notes: current.notes,
    enabled: current.enabled,
    favorite: current.favorite,
    ...input,
  }
  const parsed = serviceInputSchema.parse(merged)
  if (parsed.slug !== current.slug) {
    const taken = db.select().from(services).where(eq(services.slug, parsed.slug)).get()
    if (taken) throw new AppError('CONFLICT', 'Ja existe um servico com este slug')
  }
  const now = new Date().toISOString()
  const next: ServiceRow = {
    ...current,
    slug: parsed.slug,
    name: parsed.name,
    category: parsed.category,
    baseUrl: parsed.baseUrl,
    allowedDomains: parsed.allowedDomains,
    authMethods: parsed.authMethods as ServiceRow['authMethods'],
    defaultAuth: parsed.defaultAuth as ServiceRow['defaultAuth'],
    notes: parsed.notes === undefined ? current.notes : emptyToNull(parsed.notes),
    enabled: parsed.enabled ?? current.enabled,
    favorite: parsed.favorite ?? current.favorite,
    updatedAt: now,
  }
  db.update(services).set(next).where(eq(services.id, id)).run()
  return next
}

export function deleteService(db: AppDatabase, id: string): void {
  const current = getServiceRow(db, id)
  if (current.isBuiltin) {
    throw new AppError('FORBIDDEN', 'Servicos nativos nao podem ser excluidos; desative-o.')
  }
  try {
    db.delete(services).where(eq(services.id, id)).run()
  } catch {
    throw new AppError(
      'CONFLICT',
      'O servico possui historico de sessoes e nao pode ser excluido',
      'Este servico possui historico de sessoes. Desative-o em vez de excluir.',
    )
  }
}

export function duplicateService(db: AppDatabase, id: string): ServiceRow {
  const current = getServiceRow(db, id)
  let suffix = 1
  let slug = `${current.slug}-copia`
  while (db.select().from(services).where(eq(services.slug, slug)).get()) {
    suffix += 1
    slug = `${current.slug}-copia-${suffix}`
  }
  const now = new Date().toISOString()
  const row: ServiceRow = {
    ...current,
    id: randomUUID(),
    slug,
    name: `${current.name} (copia)`,
    isBuiltin: false,
    favorite: false,
    logoPath: null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(services).values(row).run()
  // Copia também a automação para a duplicata (com o novo slug); sem isso a
  // cópia abriria o portal sem receita.
  const sourceRecipe = getRecipeByService(db, id)
  if (sourceRecipe) {
    try {
      saveRecipe(db, row.id, { ...sourceRecipe.definition, service: row.slug })
    } catch {
      // A cópia vale mesmo sem automação; o usuário pode regenerá-la em Avançado.
    }
  }
  return row
}

export function setServiceLogo(db: AppDatabase, id: string, logoPath: string | null): ServiceRow {
  const current = getServiceRow(db, id)
  const now = new Date().toISOString()
  db.update(services).set({ logoPath, updatedAt: now }).where(eq(services.id, id)).run()
  return { ...current, logoPath, updatedAt: now }
}
