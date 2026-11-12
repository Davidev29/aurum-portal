/**
 * bwip-js publica os tipos apenas sob condições "browser"/"node"/"electron"
 * do campo exports; o tsconfig `moduleResolution: bundler` não resolve
 * nenhuma delas para um import dinâmico. Declaração mínima aqui para o
 * bundler (Next) resolver em runtime via package.json.
 */
declare module 'bwip-js' {
  interface BwipOptions {
    bcid: string
    text: string
    scale?: number
    height?: number
    includetext?: boolean
    backgroundcolor?: string
    barcolor?: string
    paddingwidth?: number
    paddingheight?: number
    monochrome?: boolean
  }
  const bwipjs: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toBuffer?: (opts: BwipOptions) => Promise<any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toCanvas?: (canvas: any, opts: BwipOptions) => unknown
    [key: string]: unknown
  }
  export = bwipjs
}
