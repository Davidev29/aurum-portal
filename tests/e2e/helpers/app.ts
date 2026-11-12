import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createDatabase } from '../../../electron/main/db/database'
import { services } from '../../../electron/main/db/schema'
import { saveRecipe } from '../../../electron/main/db/repositories/recipes'
import type { RecipeDefinition, RecipeStep } from '../../../shared/recipe'

export interface LaunchOptions {
  userData: string
}

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  root: string
  userData: string
}

export function projectRoot(): string {
  return path.resolve(__dirname, '../../..')
}

export function createUserDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'aurumbit-portal-e2e-'))
}

export function removeUserDataDir(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch {
    // O Electron pode manter handles abertos por alguns instantes no Windows.
  }
}

function childEnv(root: string, userData: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
  return {
    ...env,
    AURUMBIT_WEB_ROOT: path.join(root, 'out'),
    AURUMBIT_USER_DATA: userData,
    AURUMBIT_E2E_ALLOW_LOCAL_TLS: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  }
}

export async function launchAurumBitPortal(options: LaunchOptions): Promise<LaunchedApp> {
  const root = projectRoot()
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${options.userData}`],
    cwd: root,
    env: childEnv(root, options.userData),
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, root, userData: options.userData }
}

export interface SeedOptions {
  serviceId: string
  baseUrl: string
  withRecipe: boolean
}

export const E2E_LOGIN_RECIPE: RecipeDefinition = {
  version: 1,
  service: 'e2e-local',
  auth: 'password',
  steps: [
    { action: 'fill', selectors: ['#user'], value: '{{credential.username}}' },
    { action: 'fill', selectors: ['#pass'], value: '{{credential.password}}' },
  ] satisfies RecipeStep[],
  postLogin: { selectors: ['text=Painel E2E'], timeoutMs: 1000 },
  autoSubmit: false,
  onFailure: 'manual',
  captchaSelectors: ['#captcha'],
  twoFactorSelectors: ['#otp'],
}

export function seedDatabase(dbPath: string, options: SeedOptions): void {
  const database = createDatabase(dbPath)
  try {
    const now = new Date().toISOString()
    database.db
      .insert(services)
      .values({
        id: options.serviceId,
        slug: options.serviceId,
        name: 'Portal E2E',
        category: 'Outros',
        baseUrl: options.baseUrl,
        allowedDomains: ['127.0.0.1'],
        authMethods: ['password'],
        defaultAuth: 'password',
        logoPath: null,
        notes: 'Servico local criado exclusivamente para testes E2E.',
        isBuiltin: false,
        enabled: true,
        favorite: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    if (options.withRecipe) {
      saveRecipe(database.db, options.serviceId, E2E_LOGIN_RECIPE)
    }
  } finally {
    database.close()
  }
}
