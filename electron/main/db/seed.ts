import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { AppSettings } from '../../../shared/types'
import { BUILTIN_SERVICES } from '../../../shared/builtins'
import { buildAutoRecipe } from '../../../shared/custom-service'
import { stripVolatileQueryParams } from '../../../shared/custom-service'
import { coerceSettings, DEFAULT_SETTINGS } from '../../../shared/settings'
import type { AppDatabase } from './database'
import { clients, recipes, services, settings } from './schema'

/**
 * Correções pontuais de baseUrl de serviços nativos que chegaram aos
 * usuários com endereço errado em builds anteriores. Só toca em linhas
 * cujo baseUrl é exatamente um valor legado conhecido — jamais sobrescreve
 * uma edição feita pelo operador.
 */
const LEGACY_BUILTIN_BASE_URLS: Record<string, readonly string[]> = {
  'builtin-speedgov-juazeiro-do-norte': ['https://servicos2.speedgov.com.br/juazeirodonorte'],
}

export function seedBuiltins(db: AppDatabase, force = false): void {
  const now = new Date().toISOString()
  for (const [index, seed] of BUILTIN_SERVICES.entries()) {
    const existing = db.select().from(services).where(eq(services.id, seed.id)).get()
    if (!existing) {
      db.insert(services)
        .values({
          id: seed.id,
          slug: seed.slug,
          name: seed.name,
          category: seed.category,
          baseUrl: seed.baseUrl,
          allowedDomains: seed.allowedDomains,
          authMethods: seed.authMethods,
          defaultAuth: seed.defaultAuth,
          notes: seed.notes,
          isBuiltin: true,
          enabled: true,
          favorite: false,
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      const recipeId = `recipe-${seed.slug}`
      db.insert(recipes)
        .values({
          id: recipeId,
          serviceId: seed.id,
          version: 1,
          definition: seed.recipe,
          autoSubmit: seed.recipe.autoSubmit,
          status: 'draft',
          lastVerifiedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    } else if (existing.isBuiltin) {
      // Atualiza allowlist canônica sem apagar domínios adicionais que o
      // operador adicionou (portal próprio com SSO em subdomínio novo).
      const mergedDomains = Array.from(
        new Set([...seed.allowedDomains, ...existing.allowedDomains]),
      )
      const existingDomains = new Set(existing.allowedDomains)
      const domainsDiffer =
        mergedDomains.length !== existingDomains.size ||
        mergedDomains.some((domain) => !existingDomains.has(domain))
      // Corrige baseUrl de nativos que saíram com endereço errado em builds
      // anteriores (ex.: Juazeiro do Norte SpeedGov). Nunca sobrescreve edição
      // do operador: só linhas com o valor legado exato são migradas.
      const legacyBaseUrls = LEGACY_BUILTIN_BASE_URLS[seed.id]
      if (legacyBaseUrls?.includes(existing.baseUrl) && existing.baseUrl !== seed.baseUrl) {
        db.update(services)
          .set({ baseUrl: seed.baseUrl, updatedAt: now })
          .where(eq(services.id, seed.id))
          .run()
      }
      const recipe = db.select().from(recipes).where(eq(recipes.serviceId, seed.id)).get()
      const recipeDiffers =
        recipe !== undefined &&
        recipe !== null &&
        JSON.stringify(recipe.definition) !== JSON.stringify(seed.recipe)
      // Receitas quebradas/rascunho de nativos são restauradas para a
      // definição atual do código (novos seletores de pós-login/certificado).
      // Receitas já verificadas pelo operador são preservadas.
      const shouldHealRecipe =
        recipe !== undefined &&
        recipe !== null &&
        recipeDiffers &&
        (recipe.status === 'broken' || recipe.status === 'draft')
      if (domainsDiffer || shouldHealRecipe) {
        if (domainsDiffer) {
          db.update(services)
            .set({ allowedDomains: mergedDomains, updatedAt: now })
            .where(eq(services.id, seed.id))
            .run()
        }
        if (recipe && shouldHealRecipe) {
          db.update(recipes)
            .set({
              definition: seed.recipe,
              autoSubmit: seed.recipe.autoSubmit,
              updatedAt: now,
            })
            .where(eq(recipes.id, recipe.id))
            .run()
        }
      }
      if (force) {
        db.update(services)
          .set({
            name: seed.name,
            category: seed.category,
            baseUrl: seed.baseUrl,
            allowedDomains: seed.allowedDomains,
            authMethods: seed.authMethods,
            defaultAuth: seed.defaultAuth,
            notes: seed.notes,
            enabled: true,
            updatedAt: now,
          })
          .where(eq(services.id, seed.id))
          .run()
        const recipe = db.select().from(recipes).where(eq(recipes.serviceId, seed.id)).get()
        if (recipe) {
          db.update(recipes)
            .set({
              definition: seed.recipe,
              autoSubmit: seed.recipe.autoSubmit,
              status: 'draft',
              updatedAt: now,
            })
            .where(eq(recipes.id, recipe.id))
            .run()
        } else {
          db.insert(recipes)
            .values({
              id: `recipe-${seed.slug}`,
              serviceId: seed.id,
              version: 1,
              definition: seed.recipe,
              autoSubmit: seed.recipe.autoSubmit,
              status: 'draft',
              createdAt: now,
              updatedAt: now,
            })
            .run()
        }
      }
    }
  }
}

/**
 * Automação retroativa: serviços personalizados
 *
 * 1. recebem a receita automática no boot quando não têm nenhuma (ex.: antes
 *    do cadastro simplificado);
 * 2. têm receitas auto-geradas DESATUALIZADAS regeneradas (comparando com o
 *    que o gerador produziria hoje). Receitas marcadas como `verified`
 *    (o login funcionou ao menos uma vez) nunca são tocadas. `autoSubmit`
 *    existente é preservado.
 *
 * Também limpa parâmetros de sessão efêmeros da URL base (ex.: ?cid=…), que
 * invalidam o acesso em sessões futuras. Idempotente; roda a cada boot.
 * Retorna quantos serviços foram curados/atualizados.
 */
export function healCustomServiceRecipes(db: AppDatabase): number {
  const now = new Date().toISOString()
  const customRows = db
    .select()
    .from(services)
    .all()
    .filter((row) => !row.isBuiltin)
  let healed = 0
  for (const row of customRows) {
    // Limpa parâmetros de sessão efêmeros da URL base (ex.: ISS Fortaleza com
    // ?cid=… ): eles invalidam o acesso em sessões futuras.
    const sanitized = stripVolatileQueryParams(row.baseUrl)
    let effectiveRow = row
    if (sanitized.url !== row.baseUrl) {
      db.update(services)
        .set({ baseUrl: sanitized.url, updatedAt: now })
        .where(eq(services.id, row.id))
        .run()
      effectiveRow = { ...row, baseUrl: sanitized.url }
    }
    const expected = buildAutoRecipe({
      slug: effectiveRow.slug,
      baseUrl: effectiveRow.baseUrl,
      authMethods: effectiveRow.authMethods,
    })
    const existing = db.select().from(recipes).where(eq(recipes.serviceId, effectiveRow.id)).get()
    if (existing) {
      if (existing.status === 'verified') continue
      if (JSON.stringify(existing.definition) === JSON.stringify(expected)) continue
      try {
        db.update(recipes)
          .set({
            definition: expected,
            autoSubmit: existing.autoSubmit,
            status: 'draft',
            updatedAt: now,
          })
          .where(eq(recipes.id, existing.id))
          .run()
        healed += 1
      } catch {
        // Nunca impede o boot.
      }
      continue
    }
    try {
      db.insert(recipes)
        .values({
          id: randomUUID(),
          serviceId: effectiveRow.id,
          version: 1,
          definition: expected,
          autoSubmit: expected.autoSubmit,
          status: 'draft',
          lastVerifiedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      healed += 1
    } catch {
      // Nunca impede o boot; o usuário pode regenerar em Opções avançadas.
    }
  }
  return healed
}

export function getSettings(db: AppDatabase): AppSettings {
  const row = db.select().from(settings).where(eq(settings.key, 'app')).get()
  return coerceSettings(row?.value)
}

export function saveSettings(
  db: AppDatabase,
  patch: Omit<Partial<AppSettings>, 'office' | 'letterhead'> & {
    office?: Partial<AppSettings['office']>
    letterhead?: Partial<AppSettings['letterhead']>
  },
): AppSettings {
  const current = getSettings(db)
  // `office`/`letterhead` são aninhados: mescla campo a campo para
  // atualizações parciais não apagarem o restante (logomarca, cores...).
  const nextOffice = patch.office ? { ...current.office, ...patch.office } : current.office
  const nextLetterhead = patch.letterhead
    ? { ...current.letterhead, ...patch.letterhead }
    : current.letterhead
  const next = coerceSettings({
    ...current,
    ...patch,
    office: nextOffice,
    letterhead: nextLetterhead,
  })
  db.insert(settings)
    .values({ key: 'app', value: next, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: next, updatedAt: new Date().toISOString() },
    })
    .run()
  return next
}

export function resetSettings(db: AppDatabase): AppSettings {
  return saveSettings(db, DEFAULT_SETTINGS)
}

export function countRows(db: AppDatabase): { clients: number; services: number } {
  const clientCount = db.select({ id: clients.id }).from(clients).all().length
  const serviceCount = db.select({ id: services.id }).from(services).all().length
  return { clients: clientCount, services: serviceCount }
}

export function archiveClientRecursively(db: AppDatabase, clientId: string): void {
  const now = new Date().toISOString()
  db.update(clients)
    .set({ status: 'archived', updatedAt: now })
    .where(eq(clients.id, clientId))
    .run()
}
