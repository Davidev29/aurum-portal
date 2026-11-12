export interface IpcErrorPayload {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type IpcResponse<T> = { ok: true; value: T } | { ok: false; error: IpcErrorPayload }
