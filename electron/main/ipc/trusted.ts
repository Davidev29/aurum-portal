import type { WebContents } from 'electron'

/**
 * Registro explicito das superficies confiaveis do aplicativo.
 * Conteudo remoto (WebContentsView de portais e popups OAuth) nunca e registrado
 * e, portanto, nunca consegue chamar o IPC do main.
 */
export class TrustedContentsRegistry {
  private readonly contents = new Map<number, WebContents>()

  add(webContents: WebContents): void {
    if (webContents.isDestroyed()) return
    this.contents.set(webContents.id, webContents)
    webContents.once('destroyed', () => {
      this.contents.delete(webContents.id)
    })
  }

  has(webContents: WebContents): boolean {
    if (webContents.isDestroyed()) return false
    return this.contents.get(webContents.id) === webContents
  }

  all(): WebContents[] {
    return Array.from(this.contents.values()).filter((contents) => !contents.isDestroyed())
  }

  clear(): void {
    this.contents.clear()
  }
}
