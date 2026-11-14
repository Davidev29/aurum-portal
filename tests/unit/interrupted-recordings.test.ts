import { describe, expect, it } from 'vitest'
import { interruptedRecordingIdsForEvents } from '../../electron/main/recipes/interrupted'

describe('interruptedRecordingIdsForEvents (C4)', () => {
  it('started sem encerramento → aberto', () => {
    expect(
      interruptedRecordingIdsForEvents([{ type: 'recipe.record_started', entityId: 'w1' }]),
    ).toEqual(['w1'])
  })

  it('started → finished → vazio (a ordem DESC do audit não ressuscita)', () => {
    expect(
      interruptedRecordingIdsForEvents([
        { type: 'recipe.record_finished', entityId: 'w1' },
        { type: 'recipe.record_started', entityId: 'w1' },
      ]),
    ).toEqual([])
  })

  it('started → recorded → vazio', () => {
    expect(
      interruptedRecordingIdsForEvents([
        { type: 'recipe.recorded', entityId: 'w1' },
        { type: 'recipe.record_started', entityId: 'w1' },
      ]),
    ).toEqual([])
  })

  it('started → discarded → vazio', () => {
    expect(
      interruptedRecordingIdsForEvents([
        { type: 'recipe.record_discarded', entityId: 'w1' },
        { type: 'recipe.record_started', entityId: 'w1' },
      ]),
    ).toEqual([])
  })

  it('started + record_interrupted → vazio (aviso já mostrado)', () => {
    expect(
      interruptedRecordingIdsForEvents([
        { type: 'recipe.record_interrupted', entityId: 'w1' },
        { type: 'recipe.record_started', entityId: 'w1' },
      ]),
    ).toEqual([])
  })

  it('dois wizards — um fechado, um aberto', () => {
    expect(
      interruptedRecordingIdsForEvents([
        { type: 'recipe.record_finished', entityId: 'w1' },
        { type: 'recipe.record_started', entityId: 'w2' },
        { type: 'recipe.record_started', entityId: 'w1' },
      ]),
    ).toEqual(['w2'])
  })

  it('started duplicado não duplica', () => {
    expect(
      interruptedRecordingIdsForEvents([
        { type: 'recipe.record_started', entityId: 'w1' },
        { type: 'recipe.record_started', entityId: 'w1' },
      ]),
    ).toEqual(['w1'])
  })

  it('eventos sem entityId são ignorados', () => {
    expect(
      interruptedRecordingIdsForEvents([
        { type: 'recipe.record_started', entityId: null },
        { type: 'recipe.record_started' },
      ]),
    ).toEqual([])
  })
})
