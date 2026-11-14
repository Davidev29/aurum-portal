/**
 * Detecção de gravação interrompida (C4) — função pura sobre eventos de audit.
 * Extraída do `SessionManager` para ser testável sem Electron.
 *
 * Regra: um wizard entra como "aberto" quando há `recipe.record_started` e
 * sai de "aberto" (fecha) quando há QUALQUER um destes eventos para o mesmo
 * wizard/sessão: record_finished, record_discarded, recipe.recorded,
 * recipe.record_interrupted.
 *
 * A ordem de chegada é irrelevante — repetição/reordenação de eventos
 * nunca ressuscita um wizard fechado nem congela um aberto sem final.
 */
export interface AuditEventLike {
  type: string
  entityId?: string | null
}

const STARTED = 'recipe.record_started'
const CLOSED_TYPES = new Set([
  'recipe.record_finished',
  'recipe.record_discarded',
  'recipe.recorded',
  'recipe.record_interrupted',
])

export function interruptedRecordingIdsForEvents(events: AuditEventLike[]): string[] {
  const state = new Map<string, 'open' | 'closed'>()
  for (const event of events) {
    const id = event.entityId ?? ''
    if (!id) continue
    if (event.type === STARTED) {
      if (state.get(id) !== 'closed') state.set(id, 'open')
      continue
    }
    if (CLOSED_TYPES.has(event.type)) {
      state.set(id, 'closed')
    }
  }
  return [...state.entries()].filter(([, value]) => value === 'open').map(([id]) => id)
}
