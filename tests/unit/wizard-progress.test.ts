import { describe, expect, it } from 'vitest'
import { shouldEmitWizardProgress } from '../../electron/main/recipes/recorder'

/** C8 — broadcast `wizard:progress` limitado a ~1/s (contadores ao vivo). */
describe('shouldEmitWizardProgress (C8)', () => {
  it('bloqueia emissões dentro de 1s da anterior', () => {
    const last = 1_000
    expect(shouldEmitWizardProgress(last, last + 999)).toBe(false)
    expect(shouldEmitWizardProgress(last, last + 100)).toBe(false)
  })

  it('libera na marca de 1s', () => {
    const last = 1_000
    expect(shouldEmitWizardProgress(last, last + 1_000)).toBe(true)
  })

  it('libera após intervalo longo', () => {
    expect(shouldEmitWizardProgress(0, 5_000)).toBe(true)
  })

  it('respeita intervalo mínimo customizado', () => {
    expect(shouldEmitWizardProgress(1_000, 1_500, 100)).toBe(true)
    expect(shouldEmitWizardProgress(1_000, 1_050, 100)).toBe(false)
  })

  it('nunca emite mais de 1/s em loop de 10 minutos de gravação', () => {
    const start = 0
    let last = -1_000
    let emitted = 0
    for (let at = start; at < 600_000; at += 250) {
      if (shouldEmitWizardProgress(last, at)) {
        emitted += 1
        last = at
      }
    }
    // 10 min de polling 250ms ⇒ no máximo ~601 emissões (1/s), não 2400
    expect(emitted).toBeLessThanOrEqual(601)
    expect(emitted).toBeGreaterThan(500)
  })
})
