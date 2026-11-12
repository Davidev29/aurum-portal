'use client'

import { aurumBitPortal } from '@/lib/api'

/** Bytes → base64 (sem estourar a pilha com spread em arquivos grandes). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** Salva um PDF de relatório via diálogo nativo (processo principal). */
export async function saveReportPdf(options: {
  filename: string
  bytes: Uint8Array
  trackingCode: string
  title: string
}): Promise<{ path: string; trackingCode: string | null }> {
  return aurumBitPortal().reports.savePdf({
    filename: options.filename,
    dataBase64: bytesToBase64(options.bytes),
    trackingCode: options.trackingCode,
    title: options.title,
  })
}
