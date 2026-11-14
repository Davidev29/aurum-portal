import { contextBridge, ipcRenderer } from 'electron'
import type { AurumBitPortalApi, AurumBitPortalEvents } from '../../shared/contracts'
import type { IpcResponse } from '../../shared/ipc'

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const response = (await ipcRenderer.invoke(channel, payload)) as IpcResponse<T>
  if (!response.ok) {
    const error = new Error(response.error.message)
    error.name = response.error.code
    Object.assign(error, { code: response.error.code, details: response.error.details })
    throw error
  }
  return response.value
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const events: AurumBitPortalEvents = {
  onSessionsChanged: (callback) => subscribe('sessions:changed', callback),
  onCertificatesChanged: (callback) => subscribe('certificates:changed', callback),
  onClientsChanged: (callback) => subscribe('clients:changed', callback),
  onCredentialsChanged: (callback) => subscribe('credentials:changed', callback),
  onClientsRefreshProgress: (callback) => subscribe('clients:refreshProgress', callback),
  onServicesChanged: (callback) => subscribe('services:changed', callback),
  onImportProgress: (callback) => subscribe('import:progress', callback),
  onDownloadProgress: (callback) => subscribe('download:progress', callback),
  onAppLocked: (callback) => subscribe('app:locked', callback),
  onSessionError: (callback) => subscribe('session:error', callback),
  onUpdateStatus: (callback) => subscribe('app:updateStatus', callback),
  onObligationsChanged: (callback) => subscribe('obligations:changed', callback),
  onNotificationsChanged: (callback) => subscribe('notifications:changed', callback),
  onWizardProgress: (callback) => subscribe('wizard:progress', callback),
}

const api: AurumBitPortalApi = {
  clients: {
    list: (filter) => call('clients:list', filter),
    get: (id) => call('clients:get', { id }),
    create: (input) => call('clients:create', input),
    update: (id, input) => call('clients:update', { id, input }),
    archive: (id) => call('clients:archive', { id }),
    restore: (id) => call('clients:restore', { id }),
    exportCsv: () => call('clients:exportCsv'),
    cnpjLookup: (input) => call('clients:cnpjLookup', input),
    refreshFromBrasilApi: () => call('clients:refreshFromBrasilApi'),
    listNotes: (clientId) => call('clients:listNotes', { clientId }),
    createNote: (input) => call('clients:createNote', input),
    updateNote: (input) => call('clients:updateNote', input),
    deleteNote: (id) => call('clients:deleteNote', { id }),
  },
  credentials: {
    list: (filter) => call('credentials:list', filter),
    create: (input) => call('credentials:create', input),
    update: (id, input) => call('credentials:update', { id, input }),
    delete: (id) => call('credentials:delete', { id }),
    reveal: (id) => call('credentials:reveal', { id }),
    copy: (id, field) => call('credentials:copy', { id, field }),
    generate: (options) => call('credentials:generate', options),
    setDefault: (id) => call('credentials:setDefault', { id }),
  },
  certificates: {
    list: (filter) => call('certificates:list', filter),
    get: (id) => call('certificates:get', { id }),
    details: (id) => call('certificates:details', { id }),
    pickPfxFiles: () => call('certificates:pickPfxFiles'),
    import: (input) => call('certificates:import', input),
    importBatch: (input) => call('certificates:importBatch', input),
    listWindows: () => call('certificates:listWindows'),
    importFromWindows: (input) => call('certificates:importFromWindows', input),
    install: (id) => call('certificates:install', { id }),
    uninstall: (input) => call('certificates:uninstall', input),
    test: (id) => call('certificates:test', { id }),
    linkClient: (input) => call('certificates:linkClient', input),
    unlinkClient: (input) => call('certificates:unlinkClient', input),
    stats: () => call('certificates:stats'),
    refreshAll: () => call('certificates:refreshAll'),
    exportBackup: (input) => call('certificates:exportBackup', input),
  },
  services: {
    list: (filter) => call('services:list', filter),
    get: (id) => call('services:get', { id }),
    create: (input) => call('services:create', input),
    update: (id, input) => call('services:update', { id, input }),
    delete: (id) => call('services:delete', { id }),
    duplicate: (id) => call('services:duplicate', { id }),
    restoreBuiltins: () => call('services:restoreBuiltins'),
    fetchLogo: (id) => call('services:fetchLogo', { id }),
    uploadLogo: (id) => call('services:uploadLogo', { id }),
  },
  sessions: {
    open: (input) => call('sessions:open', input),
    focus: (sessionId) => call('sessions:focus', { sessionId }),
    close: (sessionId) => call('sessions:close', { sessionId }),
    list: () => call('sessions:list'),
    details: (sessionId) => call('sessions:details', { sessionId }),
    navigate: (sessionId, url) => call('sessions:navigate', { sessionId, url }),
    reload: (sessionId) => call('sessions:reload', { sessionId }),
    stop: (sessionId) => call('sessions:stop', { sessionId }),
    back: (sessionId) => call('sessions:back', { sessionId }),
    forward: (sessionId) => call('sessions:forward', { sessionId }),
    setZoom: (sessionId, zoomFactor) => call('sessions:setZoom', { sessionId, zoomFactor }),
    openExternal: (sessionId, url) => call('sessions:openExternal', { sessionId, url }),
    getCredentialForManual: (sessionId, credentialId, field) =>
      call('sessions:getCredentialForManual', { sessionId, credentialId, field }),
    retryRecipe: (sessionId) => call('sessions:retryRecipe', { sessionId }),
    reveal: (sessionId) => call('sessions:reveal', { sessionId }),
  },
  recipes: {
    get: (serviceId) => call('recipes:get', { serviceId }),
    save: (input) => call('recipes:save', input),
    test: (serviceId) => call('recipes:test', { serviceId }),
    reset: (serviceId) => call('recipes:reset', { serviceId }),
    reRecord: (input) => call('recipes:reRecord', input),
  },
  wizard: {
    startRecord: (input) => call('wizard:startRecord', input),
    state: (wizardId) => call('wizard:state', { wizardId }),
    finish: (wizardId) => call('wizard:finish', { wizardId }),
    cancel: (wizardId) => call('wizard:cancel', { wizardId }),
    save: (input) => call('wizard:save', input),
    discard: (wizardId) => call('wizard:discard', { wizardId }),
  },
  pdf: {
    pickFile: () => call('pdf:pickFile'),
    loadPreview: (token: string) => call('pdf:loadPreview', { token }),
    sign: (input) => call('pdf:sign', input),
    testTsa: (input) => call('pdf:testTsa', input),
    release: (token: string) => call('pdf:release', { token }),
    reveal: (input) => call('pdf:reveal', input),
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
    reset: () => call('settings:reset'),
  },
  reports: {
    savePdf: (input) => call('reports:savePdf', input),
  },
  audit: {
    list: (filter) => call('audit:list', filter),
    export: (format, filter) => call('audit:export', { format, filter }),
  },
  obligations: {
    listDepartments: () => call('obligations:departments:list'),
    createDepartment: (input) => call('obligations:departments:create', input),
    updateDepartment: (id, input) => call('obligations:departments:update', { id, input }),
    setDepartmentActive: (id, active) => call('obligations:departments:setActive', { id, active }),
    deleteDepartment: (id) => call('obligations:departments:delete', { id }),
    listObligations: (filter) => call('obligations:list', filter),
    createObligation: (input) => call('obligations:create', input),
    updateObligation: (id, input) => call('obligations:update', { id, input }),
    setObligationActive: (id, active) => call('obligations:setActive', { id, active }),
    deleteObligation: (id) => call('obligations:delete', { id }),
    listGroups: () => call('obligations:groups:list'),
    createGroup: (input) => call('obligations:groups:create', input),
    updateGroup: (id, input) => call('obligations:groups:update', { id, input }),
    deleteGroup: (id) => call('obligations:groups:delete', { id }),
    applyGroup: (input) => call('obligations:groups:apply', input),
    listLinks: () => call('obligations:links:list'),
    listLinksByClient: (clientId) => call('obligations:links:listByClient', { clientId }),
    setLink: (input) => call('obligations:links:set', input),
    updateLink: (input) => call('obligations:links:update', input),
    removeLink: (id) => call('obligations:links:remove', { id }),
    pasteLinks: (input) => call('obligations:links:paste', input),
    listMonth: (input) => call('obligations:month:list', input),
    setDelivery: (input) => call('obligations:deliveries:set', input),
    listNotifications: () => call('obligations:notifications:list'),
    markNotificationRead: (id) => call('obligations:notifications:markRead', { id }),
    markAllNotificationsRead: () => call('obligations:notifications:markAllRead'),
    clearReadNotifications: () => call('obligations:notifications:clearRead'),
    listHolidays: () => call('obligations:holidays:list'),
    addHoliday: (input) => call('obligations:holidays:add', input),
    removeHoliday: (id) => call('obligations:holidays:remove', { id }),
  },
  app: {
    info: () => call('app:info'),
    lock: () => call('app:lock'),
    unlock: () => call('app:unlock'),
    openLogs: () => call('app:openLogs'),
    checkUpdates: () => call('app:checkUpdates'),
  },
  events,
}

contextBridge.exposeInMainWorld('aurumBitPortal', api)
