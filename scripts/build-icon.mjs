/**
 * Gera build/icon.ico (multi-resolução: 256/48/32/16) a partir da logomarca
 * "aurum bit Portal" (public/Logomarca da empresa.png).
 *
 * Uso: node scripts/build-icon.mjs
 * Requer as dependências transitivas `sharp` (decode/resize) — já presente
 * no node_modules do projeto. O .ico gerado é PNG-embed (Windows Vista+),
 * aceito pelo electron-builder para o instalador e o exe.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.join(HERE, '..', 'public', 'Logomarca da empresa.png')
const TARGET = path.join(HERE, '..', 'build', 'icon.ico')
const SIZES = [256, 48, 32, 16]

const base = sharp(SOURCE, { failOn: 'error' })
const meta = await base.metadata()
console.log(`Fonte: ${meta.width}x${meta.height} ${meta.format}`)

// Fundo preto sólido preservado (a marca é ouro sobre preto).
const pngs = []
for (const size of SIZES) {
  pngs.push(
    await sharp(SOURCE)
      .resize(size, size, { fit: 'cover', background: '#000000' })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  )
}

// Container ICO: header + diretório + payloads PNG.
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(SIZES.length, 4)

const entries = []
let offset = 6 + 16 * SIZES.length
for (let i = 0; i < SIZES.length; i += 1) {
  const size = SIZES[i]
  const png = pngs[i]
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size === 256 ? 0 : size, 0) // largura (0 = 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1) // altura
  entry.writeUInt8(0, 2) // paleta
  entry.writeUInt8(0, 3) // reservado
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bits por pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(offset, 12)
  entries.push(entry)
  offset += png.length
}

fs.mkdirSync(path.dirname(TARGET), { recursive: true })
fs.writeFileSync(TARGET, Buffer.concat([header, ...entries, ...pngs]))
const kb = (fs.statSync(TARGET).size / 1024).toFixed(1)
console.log(`Escrito: ${TARGET} (${kb} KB, ${SIZES.length} resoluções)`)
