import { describe, expect, it } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import {
  addHoliday,
  applyGroup,
  createDepartment,
  createGroup,
  createObligation,
  deleteDepartment,
  deleteObligation,
  listDepartments,
  listGroups,
  listHolidays,
  listLinksByClient,
  listAllLinks,
  listNotifications,
  markAllNotificationsRead,
  clearReadNotifications,
  pasteLinks,
  removeHoliday,
  setClientObligationLink,
  updateGroup,
  updateObligation,
} from '../../electron/main/db/repositories/obligations'
import { generateDueNotifications } from '../../electron/main/notifications/obligations-scheduler'
import { createClient } from '../../electron/main/db/repositories/clients'
import { createDatabase } from '../../electron/main/db/database'
import { MIGRATIONS } from '../../electron/main/db/migrations'
import {
  computeDueDate,
  describeObligationRule,
  isOccurrenceMonth,
  nextDueDate,
  notificationDueDate,
  obligationRuleIssues,
} from '../../shared/obligation-rules'
import {
  easterSunday,
  getNationalHolidays,
  isBusinessDay,
  nthBusinessDayOfMonth,
  formatDateBr,
  addDays,
} from '../../shared/holidays'
import { obligationInputSchema } from '../../shared/contracts'

const CPF_1 = '52998224725'
const CPF_2 = '11144477735'
const CPF_3 = '39053344705'
const CPF_4 = '98765432100'

function seedBase(db: ReturnType<typeof createDatabase>['db']) {
  const dept = createDepartment(db, { name: 'Fiscal', description: 'Obrigações fiscais' })
  const client1 = createClient(db, { type: 'PJ', name: 'Empresa A', document: CPF_1 })
  const client2 = createClient(db, { type: 'PJ', name: 'Empresa B', document: CPF_2 })
  return { dept, client1, client2 }
}

const mensalRule = {
  recurrence: 'mensal' as const,
  dueRule: 'dia_fixo' as const,
  diaFixo: 15,
  diaUtil: null,
  mesReferencia: null,
  antecedenciaNotificacaoDias: 7,
}

describe('calendário — feriados e dias úteis', () => {
  it('calcula a Páscoa pelo algoritmo gregoriano', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05')
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe('2027-03-28')
    expect(easterSunday(2028).toISOString().slice(0, 10)).toBe('2028-04-16')
  })

  it('lista feriados nacionais fixos e móveis', () => {
    const holidays = getNationalHolidays(2026)
    const byDate = new Map(holidays.map((h) => [h.date, h.name]))
    expect(byDate.get('2026-01-01')).toContain('Confraterniza')
    expect(byDate.get('2026-04-03')).toBe('Sexta-feira da Paixão')
    expect(byDate.get('2026-02-17')).toContain('Carnaval')
    expect(byDate.get('2026-06-04')).toContain('Corpus Christi')
    expect(byDate.get('2026-11-20')).toContain('Consciência Negra')
  })

  it('isBusinessDay respeita fins de semana, nacionais e extras', () => {
    expect(isBusinessDay('2026-04-20')).toBe(true) // segunda
    expect(isBusinessDay('2026-04-21')).toBe(false) // Tiradentes
    expect(isBusinessDay('2026-04-18')).toBe(false) // sábado
    expect(isBusinessDay('2026-04-20', ['2026-04-20'])).toBe(false) // feriado extra
  })

  it('N-ésimo dia útil do mês ignora feriado inicial', () => {
    // Maio/2026: 01/05 é Dia do Trabalho; 02-03 fim de semana.
    expect(nthBusinessDayOfMonth(2026, 4, 1)).toBe('2026-05-04')
    expect(nthBusinessDayOfMonth(2026, 4, 5)).toBe('2026-05-08')
    // Com feriado extra no dia 04, o 1º dia útil desloca para o dia 05.
    expect(nthBusinessDayOfMonth(2026, 4, 1, ['2026-05-04'])).toBe('2026-05-05')
  })

  it('addDays e formatDateBr', () => {
    expect(addDays('2026-02-27', 1)).toBe('2026-02-28')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-08', 7)).toBe('2026-03-15')
    expect(formatDateBr('2026-03-15')).toBe('15/03/2026')
  })
})

describe('regras de recorrência', () => {
  it('obligationRuleIssues valida compatibilidade recorrência × regra', () => {
    expect(obligationRuleIssues(mensalRule)).toEqual([])
    expect(obligationRuleIssues({ ...mensalRule, mesReferencia: 3 })).not.toEqual([])
    expect(obligationRuleIssues({ ...mensalRule, dueRule: null })).not.toEqual([])
    expect(
      obligationRuleIssues({ ...mensalRule, dueRule: 'dia_util', diaFixo: 15, diaUtil: 5 }),
    ).not.toEqual([])
    expect(obligationRuleIssues({ ...mensalRule, diaFixo: 32 })).not.toEqual([])
    expect(
      obligationRuleIssues({
        recurrence: 'eventual',
        dueRule: null,
        diaFixo: null,
        diaUtil: null,
        mesReferencia: null,
        antecedenciaNotificacaoDias: 7,
      }),
    ).toEqual([])
    expect(
      obligationRuleIssues({
        recurrence: 'eventual',
        dueRule: 'dia_fixo',
        diaFixo: 10,
        diaUtil: null,
        mesReferencia: null,
        antecedenciaNotificacaoDias: 7,
      }),
    ).not.toEqual([])
    expect(
      obligationRuleIssues({
        recurrence: 'bimestral',
        dueRule: 'dia_fixo',
        diaFixo: 10,
        diaUtil: null,
        mesReferencia: null, // âncora obrigatória
        antecedenciaNotificacaoDias: 7,
      }),
    ).not.toEqual([])
    expect(
      obligationRuleIssues({
        recurrence: 'anual',
        dueRule: 'dia_util',
        diaFixo: null,
        diaUtil: 5,
        mesReferencia: 3,
        antecedenciaNotificacaoDias: 15,
      }),
    ).toEqual([])
  })

  it('isOccurrenceMonth respeita a âncora de cada recorrência', () => {
    expect(isOccurrenceMonth({ recurrence: 'mensal', mesReferencia: null }, 2026, 0)).toBe(true)
    expect(isOccurrenceMonth({ recurrence: 'eventual', mesReferencia: null }, 2026, 0)).toBe(false)
    // Bimestral ancorado em janeiro: jan, mar, mai, jul, set, nov
    expect(isOccurrenceMonth({ recurrence: 'bimestral', mesReferencia: 1 }, 2026, 0)).toBe(true)
    expect(isOccurrenceMonth({ recurrence: 'bimestral', mesReferencia: 1 }, 2026, 1)).toBe(false)
    expect(isOccurrenceMonth({ recurrence: 'bimestral', mesReferencia: 1 }, 2026, 2)).toBe(true)
    // Semestral ancorado em março: mar, set
    expect(isOccurrenceMonth({ recurrence: 'semestral', mesReferencia: 3 }, 2026, 2)).toBe(true)
    expect(isOccurrenceMonth({ recurrence: 'semestral', mesReferencia: 3 }, 2026, 8)).toBe(true)
    expect(isOccurrenceMonth({ recurrence: 'semestral', mesReferencia: 3 }, 2026, 5)).toBe(false)
    // Anual
    expect(isOccurrenceMonth({ recurrence: 'anual', mesReferencia: 12 }, 2026, 11)).toBe(true)
    expect(isOccurrenceMonth({ recurrence: 'anual', mesReferencia: 12 }, 2026, 10)).toBe(false)
  })

  it('computeDueDate aplica dia fixo com clamp no fim do mês', () => {
    expect(computeDueDate({ ...mensalRule, diaFixo: 31 }, 2026, 1)).toBe('2026-02-28') // fev
    expect(computeDueDate({ ...mensalRule, diaFixo: 31 }, 2026, 3)).toBe('2026-04-30') // abr
    expect(computeDueDate({ ...mensalRule, diaFixo: 15 }, 2026, 5)).toBe('2026-06-15')
  })

  it('computeDueDate aplica N-ésimo dia útil', () => {
    // Maio/2026: 1º útil = 04, 5º útil = 08 (feriado 01/05)
    expect(
      computeDueDate({ ...mensalRule, dueRule: 'dia_util', diaFixo: null, diaUtil: 5 }, 2026, 4),
    ).toBe('2026-05-08')
  })

  it('nextDueDate encontra a próxima ocorrência', () => {
    expect(nextDueDate(mensalRule, '2026-03-01')).toBe('2026-03-15')
    expect(nextDueDate(mensalRule, '2026-03-16')).toBe('2026-04-15')
    expect(
      nextDueDate(
        { ...mensalRule, recurrence: 'eventual', dueRule: null, diaFixo: null },
        '2026-03-01',
      ),
    ).toBeNull()
    expect(
      nextDueDate(
        { ...mensalRule, recurrence: 'anual', mesReferencia: 12, diaFixo: 20 },
        '2026-03-01',
      ),
    ).toBe('2026-12-20')
  })

  it('notificationDueDate dispara exatamente na antecedência', () => {
    expect(notificationDueDate(mensalRule, '2026-03-08')).toBe('2026-03-15')
    expect(notificationDueDate(mensalRule, '2026-03-09')).toBeNull()
    expect(
      notificationDueDate({ ...mensalRule, antecedenciaNotificacaoDias: 0 }, '2026-03-15'),
    ).toBe('2026-03-15')
    expect(describeObligationRule(mensalRule)).toContain('todo mês')
  })

  it('obligationInputSchema rejeita regra incompatível', () => {
    expect(() =>
      obligationInputSchema.parse({
        name: 'Evento qualquer',
        sigla: 'EVT',
        departmentId: 'dep-1',
        recurrence: 'eventual',
        dueRule: 'dia_fixo',
        diaFixo: 10,
        antecedenciaNotificacaoDias: 7,
      }),
    ).toThrow()
    const parsed = obligationInputSchema.parse({
      name: 'DCTF',
      sigla: 'dctf',
      departmentId: 'dep-1',
      recurrence: 'mensal',
      dueRule: 'dia_fixo',
      diaFixo: 15,
      antecedenciaNotificacaoDias: 7,
    })
    expect(parsed.sigla).toBe('DCTF')
  })
})

describe('migration v5', () => {
  it('cria as tabelas do módulo de obrigações', () => {
    const sqlite = new BetterSqlite3(':memory:')
    try {
      const v5 = MIGRATIONS.find((m) => m.version === 5)?.sql ?? ''
      sqlite.exec(v5)
      const tables = (
        sqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
          .all() as Array<{
          name: string
        }>
      ).map((row) => row.name)
      for (const table of [
        'departments',
        'obligations',
        'obligation_groups',
        'obligation_group_items',
        'client_obligations',
        'notifications',
        'extra_holidays',
      ]) {
        expect(tables).toContain(table)
      }
    } finally {
      sqlite.close()
    }
  })
})

describe('departamentos — CRUD e exclusão bloqueada', () => {
  it('bloqueia exclusão com obrigações vinculadas; libera após exclusão', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const dept = createDepartment(db, { name: 'Trabalhista' })
      const obligation = createObligation(db, {
        ...mensalRule,
        name: 'GFIP',
        sigla: 'GFIP',
        departmentId: dept.id,
      })
      expect(() => deleteDepartment(db, dept.id)).toThrow(/obrigaç/i)
      deleteObligation(db, obligation.id)
      expect(() => deleteDepartment(db, dept.id)).not.toThrow()
      expect(listDepartments(db)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('rejeita nomes duplicados (case-insensitive)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      createDepartment(db, { name: 'Fiscal' })
      expect(() => createDepartment(db, { name: '  fiscal ' })).toThrow(/duplicad/i)
    } finally {
      close()
    }
  })
})

describe('obrigações — sigla única por departamento', () => {
  it('permite a mesma sigla em departamentos diferentes, mas não no mesmo', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const fiscal = createDepartment(db, { name: 'Fiscal' })
      const contabil = createDepartment(db, { name: 'Contábil' })
      createObligation(db, {
        ...mensalRule,
        name: 'DCTF Fiscal',
        sigla: 'DCTF',
        departmentId: fiscal.id,
      })
      expect(() =>
        createObligation(db, {
          ...mensalRule,
          name: 'DCTF Contábil',
          sigla: 'dctf',
          departmentId: fiscal.id,
        }),
      ).toThrow(/sigla/i)
      const other = createObligation(db, {
        ...mensalRule,
        name: 'DCTF Contábil',
        sigla: 'DCTF',
        departmentId: contabil.id,
      })
      expect(other.id).toBeTruthy()
    } finally {
      close()
    }
  })

  it('edição para eventual limpa as colunas da regra', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const dept = createDepartment(db, { name: 'Fiscal' })
      const obligation = createObligation(db, {
        ...mensalRule,
        name: 'SPED',
        sigla: 'SPED',
        departmentId: dept.id,
      })
      expect(obligation.dueRule).toBe('dia_fixo')
      const updated = updateObligation(db, obligation.id, { recurrence: 'eventual' })
      expect(updated.recurrence).toBe('eventual')
      expect(updated.dueRule).toBeNull()
      expect(updated.diaFixo).toBeNull()
      expect(updated.nextDueDate).toBeNull()
    } finally {
      close()
    }
  })

  it('update rejeita regra incompatível mesmo fora do zod', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const dept = createDepartment(db, { name: 'Fiscal' })
      const obligation = createObligation(db, {
        ...mensalRule,
        name: 'SPED',
        sigla: 'SPED',
        departmentId: dept.id,
      })
      expect(() =>
        updateObligation(db, obligation.id, { dueRule: 'dia_util', diaUtil: 20 }),
      ).toThrow()
    } finally {
      close()
    }
  })
})

describe('vínculos — independência, colagem e grupos', () => {
  it('pasteLinks cria individuais, ignora ativos e reativa inativos', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const { dept, client1, client2 } = seedBase(db)
      const o1 = createObligation(db, {
        ...mensalRule,
        name: 'O1',
        sigla: 'O1',
        departmentId: dept.id,
      })
      const o2 = createObligation(db, {
        ...mensalRule,
        name: 'O2',
        sigla: 'O2',
        departmentId: dept.id,
      })
      setClientObligationLink(db, { clientId: client2.id, obligationId: o1.id, active: true })

      // Primeira colagem: o1 já existe → skip; o2 criado.
      const first = pasteLinks(db, { targetClientId: client2.id, obligationIds: [o1.id, o2.id] })
      expect(first).toEqual({ created: 1, reactivated: 0, skipped: 1 })

      // Inativar o2 e colar de novo: reativa o2; o1 continua ativo (skipped).
      setClientObligationLink(db, { clientId: client2.id, obligationId: o2.id, active: false })
      const second = pasteLinks(db, { targetClientId: client2.id, obligationIds: [o1.id, o2.id] })
      expect(second).toEqual({ created: 0, reactivated: 1, skipped: 1 })

      // Cliente 1 permanece independente (sem vínculos).
      expect(listLinksByClient(db, client1.id)).toHaveLength(0)
      expect(listLinksByClient(db, client2.id)).toHaveLength(2)
      expect(listAllLinks(db)).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('deleteObligation bloqueia com vínculo ativo e remove vínculos inativos', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const { dept, client1 } = seedBase(db)
      const obligation = createObligation(db, {
        ...mensalRule,
        name: 'FGTS',
        sigla: 'FGTS',
        departmentId: dept.id,
      })
      setClientObligationLink(db, {
        clientId: client1.id,
        obligationId: obligation.id,
        active: true,
      })
      expect(() => deleteObligation(db, obligation.id)).toThrow(/vínculo/i)
      setClientObligationLink(db, {
        clientId: client1.id,
        obligationId: obligation.id,
        active: false,
      })
      const result = deleteObligation(db, obligation.id)
      expect(result.deletedInactiveLinks).toBe(1)
      expect(listLinksByClient(db, client1.id)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('applyGroup gera vínculos individuais por cliente e é idempotente', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const { dept, client1, client2 } = seedBase(db)
      const o1 = createObligation(db, {
        ...mensalRule,
        name: 'O1',
        sigla: 'O1',
        departmentId: dept.id,
      })
      const o2 = createObligation(db, {
        ...mensalRule,
        name: 'O2',
        sigla: 'O2',
        departmentId: dept.id,
      })
      const group = createGroup(db, { name: 'MEI', obligationIds: [o1.id, o2.id] })
      expect(group.obligationIds).toHaveLength(2)

      const first = applyGroup(db, { groupId: group.id, clientIds: [client1.id, client2.id] })
      expect(first).toEqual({ created: 4, reactivated: 0, skipped: 0 })

      const second = applyGroup(db, { groupId: group.id, clientIds: [client1.id, client2.id] })
      expect(second).toEqual({ created: 0, reactivated: 0, skipped: 4 })

      // Inativar um vínculo e reaplicar: reativa o caso individual.
      const links = listLinksByClient(db, client1.id)
      setClientObligationLink(db, {
        clientId: client1.id,
        obligationId: links[0]!.obligationId,
        active: false,
      })
      const third = applyGroup(db, { groupId: group.id, clientIds: [client1.id, client2.id] })
      expect(third).toEqual({ created: 0, reactivated: 1, skipped: 3 })

      // Editar o grupo não desfaz vínculos já criados.
      const updated = updateGroup(db, group.id, { obligationIds: [o1.id] })
      expect(updated.obligationIds).toEqual([o1.id])
      expect(listLinksByClient(db, client2.id)).toHaveLength(2)
      expect(listGroups(db)[0]?.obligations).toHaveLength(1)
    } finally {
      close()
    }
  })
})

describe('central de avisos — agendador diário', () => {
  it('gera aviso para vínculo ativo na antecedência configurada (e deduplica)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const { dept, client1, client2 } = seedBase(db)
      const client3 = createClient(db, { type: 'PJ', name: 'Empresa C', document: CPF_3 })
      const client4 = createClient(db, { type: 'PJ', name: 'Empresa D', document: CPF_4 })
      const obligation = createObligation(db, {
        ...mensalRule,
        name: 'DCTF',
        sigla: 'DCTF',
        departmentId: dept.id,
        antecedenciaNotificacaoDias: 7,
      })
      setClientObligationLink(db, {
        clientId: client1.id,
        obligationId: obligation.id,
        active: true,
      })
      setClientObligationLink(db, {
        clientId: client2.id,
        obligationId: obligation.id,
        active: true,
      })
      setClientObligationLink(db, {
        clientId: client3.id,
        obligationId: obligation.id,
        active: true,
      })
      // client4: vínculo inativo — não recebe aviso
      setClientObligationLink(db, {
        clientId: client4.id,
        obligationId: obligation.id,
        active: true,
      })
      setClientObligationLink(db, {
        clientId: client4.id,
        obligationId: obligation.id,
        active: false,
      })

      // Hoje = 08/03/2026 (antecedência 7) → vencimento 15/03/2026
      const now = new Date(2026, 2, 8, 9, 0, 0)
      const created = generateDueNotifications(db, now)
      expect(created).toBe(3)

      // Segunda passada no mesmo dia: nenhuma duplicata
      expect(generateDueNotifications(db, now)).toBe(0)

      const { notifications, unreadCount } = listNotifications(db)
      expect(notifications).toHaveLength(3)
      expect(unreadCount).toBe(3)
      expect(notifications[0]?.message).toContain('15/03/2026')
      expect(notifications[0]?.title).toContain('DCTF')

      markAllNotificationsRead(db)
      expect(listNotifications(db).unreadCount).toBe(0)
      clearReadNotifications(db)
      expect(listNotifications(db).notifications).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('não gera aviso fora da data de antecedência', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const { dept, client1 } = seedBase(db)
      const obligation = createObligation(db, {
        ...mensalRule,
        name: 'DCTF',
        sigla: 'DCTF',
        departmentId: dept.id,
        antecedenciaNotificacaoDias: 7,
      })
      setClientObligationLink(db, {
        clientId: client1.id,
        obligationId: obligation.id,
        active: true,
      })
      expect(generateDueNotifications(db, new Date(2026, 2, 9, 9, 0, 0))).toBe(0)
    } finally {
      close()
    }
  })

  it('antecedência zero gera aviso no dia do vencimento', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const { dept, client1 } = seedBase(db)
      const obligation = createObligation(db, {
        ...mensalRule,
        name: 'FGTS',
        sigla: 'FGTS',
        departmentId: dept.id,
        antecedenciaNotificacaoDias: 0,
      })
      setClientObligationLink(db, {
        clientId: client1.id,
        obligationId: obligation.id,
        active: true,
      })
      expect(generateDueNotifications(db, new Date(2026, 2, 15, 9, 0, 0))).toBe(1)
    } finally {
      close()
    }
  })

  it('obrigação eventual nunca gera aviso', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const { dept, client1 } = seedBase(db)
      const obligation = createObligation(db, {
        recurrence: 'eventual',
        dueRule: null,
        diaFixo: null,
        diaUtil: null,
        mesReferencia: null,
        antecedenciaNotificacaoDias: 7,
        name: 'Distribuição de lucros',
        sigla: 'DL',
        departmentId: dept.id,
      })
      setClientObligationLink(db, {
        clientId: client1.id,
        obligationId: obligation.id,
        active: true,
      })
      expect(generateDueNotifications(db, new Date(2026, 2, 8, 9, 0, 0))).toBe(0)
    } finally {
      close()
    }
  })
})

describe('feriados extras', () => {
  it('adiciona, lista, rejeita duplicados e remove', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const holiday = addHoliday(db, { date: '2026-08-15', name: 'Aniversário da cidade' })
      expect(holiday.date).toBe('2026-08-15')
      expect(() => addHoliday(db, { date: '2026-08-15', name: 'Outro' })).toThrow(/duplicad/i)
      expect(listHolidays(db)).toHaveLength(1)
      expect(isBusinessDay('2026-08-14')).toBe(true) // sexta-feira, sem feriado
      removeHoliday(db, holiday.id)
      expect(listHolidays(db)).toHaveLength(0)
    } finally {
      close()
    }
  })
})
