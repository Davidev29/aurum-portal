import Database from 'better-sqlite3'
const db = new Database(process.env.APPDATA + '\\aurumbit-portal\\aurumbit-portal.db')
const serviceIds = ['builtin-sped', 'builtin-esocial-unificado', 'builtin-incp-icp', 'builtin-caixa-fgts']

const sessionRows = db
  .prepare('SELECT id FROM sessions WHERE service_id IN (' + serviceIds.map(() => '?').join(',') + ')')
  .all(...serviceIds) as Array<{ id: string }>
const sessionIds = sessionRows.map((r) => r.id)
console.log('sessions a remover:', sessionIds)

// 1. Deleta audit_events referenciando estas sessões (entity=session, entity_id) ou com sessionId/clientId/serviceId no metadata_json
if (sessionIds.length > 0) {
  const placeholders = sessionIds.map(() => '?').join(',')
  const byEntity = db.prepare(`DELETE FROM audit_events WHERE entity = 'session' AND entity_id IN (${placeholders})`).run(...sessionIds)
  console.log('audit_events (entity=session) removidas:', byEntity.changes)

  const byMetadata = db
    .prepare(
      `DELETE FROM audit_events WHERE metadata_json LIKE '%' || ? || '%'`,
    )
    .run(sessionIds[0])
  console.log('audit_events (metadata menciona sessão[0]):', byMetadata.changes)

  // mais rigoroso: para cada sessionId, deleta linhas cuja metadata json contém a string
  let totalByMetadata = 0
  for (const sid of sessionIds) {
    const res = db.prepare("DELETE FROM audit_events WHERE metadata_json LIKE '%' || ? || '%'").run(sid)
    totalByMetadata += res.changes
  }
  console.log('audit_events (metadata menciona qualquer sessão):', totalByMetadata)
}

// 2. Deleta audit_events referenciando os services (entity=service, entity_id)
const byServiceEntity = db
  .prepare(
    'DELETE FROM audit_events WHERE entity = ? AND entity_id IN (' + serviceIds.map(() => '?').join(',') + ')',
  )
  .run('service', ...serviceIds)
console.log('audit_events (entity=service) removidas:', byServiceEntity.changes)

// 3. Recipes (já confirmado 0, re-rodar por segurança)
const recipesCount = db
  .prepare('DELETE FROM recipes WHERE service_id IN (' + serviceIds.map(() => '?').join(',') + ')')
  .run(...serviceIds)
console.log('recipes removidas:', recipesCount.changes)

// 4. Deleta as sessões
if (sessionIds.length > 0) {
  const sessionsCount = db
    .prepare('DELETE FROM sessions WHERE id IN (' + sessionIds.map(() => '?').join(',') + ')')
    .run(...sessionIds)
  console.log('sessions removidas:', sessionsCount.changes)
}

// 5. Deleta os services
const servicesCount = db
  .prepare('DELETE FROM services WHERE id IN (' + serviceIds.map(() => '?').join(',') + ')')
  .run(...serviceIds)
console.log('services removidos:', servicesCount.changes)

const remainingServices = db
  .prepare('SELECT id FROM services WHERE id IN (' + serviceIds.map(() => '?').join(',') + ')')
  .all(...serviceIds)
const remainingSessions = db
  .prepare('SELECT id FROM sessions WHERE service_id IN (' + serviceIds.map(() => '?').join(',') + ')')
  .all(...serviceIds)
console.log('verificação — services restantes:', remainingServices.length, 'sessions restantes:', remainingSessions.length)
