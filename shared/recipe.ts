import { z } from 'zod'
import { RECIPE_ACTIONS } from './constants'

export const recipeStepSchema = z.object({
  action: z.enum(RECIPE_ACTIONS),
  selectors: z.array(z.string().min(1).max(500)).max(40).optional(),
  value: z.string().max(4000).optional(),
  key: z.string().max(50).optional(),
  script: z.string().max(16_000).optional(),
  url: z.string().url().max(2000).optional(),
  /** Guardas de URL para a action `waitForURL` (espera a URL satisfazer incl./excl.). */
  urlIncludes: z.array(z.string().min(1).max(500)).max(5).optional(),
  urlExcludes: z.array(z.string().min(1).max(500)).max(5).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  optional: z.boolean().optional(),
})

export type RecipeStep = z.infer<typeof recipeStepSchema>

export const postLoginSchema = z.object({
  selectors: z.array(z.string().min(1).max(500)).min(1).max(20),
  timeoutMs: z.number().int().min(500).max(180_000).default(45_000),
  /**
   * Guardas de URL aplicadas durante a detecção de pós-login. Ambos os
   * filtros (inclusão/exclusão) usam `location.href.includes(...)`. Úteis
   * para portais cujo botão de pós-login aparece também em páginas públicas
   * (ex.: exigir `cav.receita.fazenda.gov.br` e excluir `/autenticacao/`).
   */
  urlIncludes: z.array(z.string().min(1).max(500)).max(5).optional(),
  urlExcludes: z.array(z.string().min(1).max(500)).max(5).optional(),
})

export type PostLogin = z.infer<typeof postLoginSchema>

export const recipeDefinitionSchema = z.object({
  version: z.literal(1),
  service: z.string().min(1).max(100),
  auth: z.enum(['certificate', 'password']),
  steps: z.array(recipeStepSchema).max(60),
  postLogin: postLoginSchema,
  autoSubmit: z.boolean().default(false),
  onFailure: z.enum(['manual', 'abort']).default('manual'),
  captchaSelectors: z.array(z.string().min(1).max(300)).max(20).optional(),
  twoFactorSelectors: z.array(z.string().min(1).max(300)).max(20).optional(),
})

export type RecipeDefinition = z.infer<typeof recipeDefinitionSchema>

export const RECIPE_PLACEHOLDERS = [
  '{{credential.username}}',
  '{{credential.password}}',
  '{{client.document}}',
  '{{client.name}}',
] as const

export function resolveRecipeTemplate(
  template: string,
  values: { username?: string; password?: string; document?: string; clientName?: string },
): string {
  return template
    .replaceAll('{{credential.username}}', values.username ?? '')
    .replaceAll('{{credential.password}}', values.password ?? '')
    .replaceAll('{{client.document}}', values.document ?? '')
    .replaceAll('{{client.name}}', values.clientName ?? '')
}

export function containsUnresolvedPlaceholder(value: string): boolean {
  return /\{\{[^}]+\}\}/.test(value)
}
