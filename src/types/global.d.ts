import type { AurumBitPortalApi } from '../../shared/contracts'

declare global {
  interface Window {
    aurumBitPortal: AurumBitPortalApi
  }
}

export {}
