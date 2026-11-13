import type { RecipeRunResult } from './runner'

/**
 * Decisão de fallback para o agente inteligente (Gravação Assistida, D6/C7).
 *
 * O robô gravado tem PRIORIDADE sobre o agente. O agente só assume quando a
 * receita falha **no passo 0** com `failureCode === 'element-not-found'`
 * (nada foi clicado/preenchido/submetido — o portal mudou desde a gravação).
 * Em qualquer outro ponto de falha, PAUSAR → humano (nunca "consertar" uma
 * gravação que estava em captcha/2FA, nem double-submit).
 */
export function shouldFallbackToAgent(result: RecipeRunResult): boolean {
  return result.failureCode === 'element-not-found' && result.failedStep === 0
}
