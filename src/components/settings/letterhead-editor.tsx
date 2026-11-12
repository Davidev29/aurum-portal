'use client'

import * as React from 'react'
import {
  Barcode,
  Check,
  ChevronDown,
  Eye,
  FileText,
  LayoutGrid,
  Loader2,
  Palette,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import {
  LETTERHEAD_PRESET_CATEGORIES,
  LETTERHEAD_PRESETS,
  applyLetterheadPreset,
  generateTrackingCode,
  isHexColor,
  type LetterheadPreset,
  type LetterheadSettings,
} from '@shared/letterhead'
import type { OfficeProfile } from '@shared/types'
import { formatDocument } from '@shared/validation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface Props {
  office: OfficeProfile
  value: LetterheadSettings
  onChange: (next: LetterheadSettings) => void
  generating?: boolean
  onGenerateTest?: () => void
}

const COLOR_FIELDS: Array<{
  key: 'primaryColor' | 'accentColor' | 'inkColor' | 'mutedColor' | 'surfaceColor'
  label: string
  hint: string
}> = [
  {
    key: 'primaryColor',
    label: 'Cor primária',
    hint: 'Barra divisória, título e cabeçalho de tabelas.',
  },
  { key: 'accentColor', label: 'Cor de acento', hint: 'Filete fino abaixo da barra e detalhes.' },
  { key: 'inkColor', label: 'Texto principal', hint: 'Títulos e corpo do documento.' },
  { key: 'mutedColor', label: 'Texto secundário', hint: 'Metadados e rodapé.' },
  {
    key: 'surfaceColor',
    label: 'Fundo do título',
    hint: 'Faixa clara atrás do título do relatório.',
  },
]

const TOGGLES: Array<{
  key:
    | 'showCnpj'
    | 'showRegistrations'
    | 'showAddress'
    | 'showContact'
    | 'showManager'
    | 'showTradeName'
  title: string
  description: string
}> = [
  { key: 'showCnpj', title: 'Exibir CNPJ', description: 'Linha de identificação abaixo do nome.' },
  {
    key: 'showRegistrations',
    title: 'Exibir IM/IE/Registro',
    description: 'Inscrições e registro profissional.',
  },
  {
    key: 'showAddress',
    title: 'Exibir endereço',
    description: 'Logradouro, cidade e UF no cabeçalho.',
  },
  { key: 'showContact', title: 'Exibir contato', description: 'Telefone, e-mail e site.' },
  {
    key: 'showManager',
    title: 'Exibir gestor (emissor)',
    description: 'Nome do gestor à direita. CPF nunca é exibido.',
  },
  {
    key: 'showTradeName',
    title: 'Priorizar nome fantasia',
    description: 'Destaque para o fantasia na primeira linha.',
  },
]

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function ThemeCard({
  preset,
  active,
  onSelect,
}: {
  preset: LetterheadPreset
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={`Tema ${preset.name}`}
      title={`${preset.description} — clique para aplicar`}
      onClick={onSelect}
      className={cn(
        'pv-pressable w-full rounded-2xl border p-2.5 text-left',
        active
          ? 'border-[var(--pv-accent)] bg-[var(--pv-accent-soft)]/50 shadow-[var(--pv-shadow)] ring-2 ring-[var(--pv-accent)]/30'
          : 'border-[var(--pv-border)] bg-[var(--pv-panel)] hover:border-[var(--pv-border-strong)]',
      )}
    >
      <span
        aria-hidden="true"
        className="block rounded-xl px-3 py-2.5"
        style={{ background: preset.colors.surfaceColor }}
      >
        <span
          className="block h-2 w-14 rounded-full"
          style={{ background: preset.colors.primaryColor }}
        />
        <span
          className="mt-1 block h-[3px] w-7 rounded-full"
          style={{ background: preset.colors.accentColor }}
        />
        <span
          className="mt-2 block h-1.5 w-full rounded-full opacity-70"
          style={{ background: preset.colors.inkColor }}
        />
        <span
          className="mt-1 block h-1.5 w-2/3 rounded-full opacity-40"
          style={{ background: preset.colors.mutedColor }}
        />
      </span>
      <span className="mt-2 flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {preset.name}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-[var(--pv-muted)]">
            {preset.description}
          </span>
        </span>
        {active ? (
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--pv-accent-solid)] text-[var(--pv-on-accent)]"
            aria-label="Tema aplicado"
          >
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
          </span>
        ) : null}
      </span>
      <span className="mt-1.5 flex items-center gap-1" aria-hidden="true">
        <span
          className="h-3 w-3 rounded-full ring-1 ring-black/10"
          style={{ background: preset.colors.primaryColor }}
        />
        <span
          className="h-3 w-3 rounded-full ring-1 ring-black/10"
          style={{ background: preset.colors.accentColor }}
        />
        <span
          className="h-3 w-3 rounded-full ring-1 ring-black/10"
          style={{ background: preset.colors.inkColor }}
        />
        <span className="ml-1 text-[10px] uppercase tracking-[0.08em] text-[var(--pv-faint)]">
          {preset.category}
        </span>
      </span>
    </button>
  )
}

export function LetterheadEditor({ office, value, onChange, generating, onGenerateTest }: Props) {
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  const [fineTuningOpen, setFineTuningOpen] = React.useState(false)
  const [themeSearch, setThemeSearch] = React.useState('')

  const patch = <K extends keyof LetterheadSettings>(key: K, next: LetterheadSettings[K]) => {
    const isColorKey = typeof key === 'string' && (key as string).endsWith('Color')
    onChange({ ...value, [key]: next, presetId: isColorKey ? 'custom' : value.presetId })
  }

  const currentPreset = LETTERHEAD_PRESETS.find((preset) => preset.id === value.presetId) ?? null
  const currentThemeName = currentPreset?.name ?? 'Personalizado'

  const normalizedSearch = React.useMemo(() => normalizeSearch(themeSearch), [themeSearch])
  const filteredPresets = React.useMemo(() => {
    if (!normalizedSearch) return LETTERHEAD_PRESETS
    return LETTERHEAD_PRESETS.filter((preset) =>
      normalizeSearch(`${preset.name} ${preset.description} ${preset.category}`).includes(
        normalizedSearch,
      ),
    )
  }, [normalizedSearch])

  const sampleCode = React.useMemo(
    () => generateTrackingCode(new Date(2026, 10, 9), () => 0.42),
    [],
  )

  const name = value.showTradeName && office.tradeName ? office.tradeName : office.legalName
  const addressLine = [office.address, [office.city, office.state].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' - ')
  const contactLine = [office.phone, office.email, office.website].filter(Boolean).join(' - ')
  const registrations = [
    office.municipalRegistration ? `IM ${office.municipalRegistration}` : '',
    office.stateRegistration ? `IE ${office.stateRegistration}` : '',
    office.registration ? `Registro ${office.registration}` : '',
  ]
    .filter(Boolean)
    .join(' - ')

  const logoBox =
    value.logoSize === 's' ? 'h-7 w-14' : value.logoSize === 'l' ? 'h-11 w-[90px]' : 'h-9 w-[72px]'

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid content-start gap-6">
        {/* Tema: minimalista — biblioteca oculta até clicar */}
        <div className="rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex shrink-0 overflow-hidden rounded-full ring-1 ring-black/10"
              >
                <span className="h-6 w-6" style={{ background: value.primaryColor }} />
                <span className="h-6 w-6" style={{ background: value.accentColor }} />
                <span className="h-6 w-6" style={{ background: value.surfaceColor }} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Palette className="h-4 w-4 text-[var(--pv-muted)]" aria-hidden="true" />
                  Tema: {currentThemeName}
                </span>
                <span className="block text-xs text-[var(--pv-muted)]">
                  {LETTERHEAD_PRESETS.length} temas prontos — escolha pelo card, sem ajustar cores.
                </span>
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLibraryOpen((open) => !open)}
              aria-expanded={libraryOpen}
              aria-controls="letterhead-theme-library"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              Biblioteca de temas
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', libraryOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </Button>
          </div>

          {libraryOpen ? (
            <div
              id="letterhead-theme-library"
              className="pv-anim-slide-up mt-4 border-t border-[var(--pv-border-subtle)] pt-4"
            >
              <div className="relative mb-3">
                <Search
                  className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
                  aria-hidden="true"
                />
                <Input
                  value={themeSearch}
                  onChange={(event) => setThemeSearch(event.target.value)}
                  placeholder="Buscar tema (ex.: verde, minimalista, bordô)…"
                  className="pl-10 pr-10"
                  aria-label="Buscar tema"
                />
                {themeSearch ? (
                  <button
                    type="button"
                    onClick={() => setThemeSearch('')}
                    aria-label="Limpar busca de temas"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)]"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {filteredPresets.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--pv-muted)]">
                  Nenhum tema encontrado para “{themeSearch}”.
                </p>
              ) : normalizedSearch ? (
                <div
                  role="radiogroup"
                  aria-label="Temas"
                  className="pv-scroll grid max-h-[380px] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2"
                >
                  {filteredPresets.map((preset) => (
                    <ThemeCard
                      key={preset.id}
                      preset={preset}
                      active={value.presetId === preset.id}
                      onSelect={() => onChange(applyLetterheadPreset(value, preset.id))}
                    />
                  ))}
                </div>
              ) : (
                <div className="pv-scroll max-h-[380px] space-y-4 overflow-y-auto pr-1">
                  {LETTERHEAD_PRESET_CATEGORIES.map((category) => {
                    const items = filteredPresets.filter((preset) => preset.category === category)
                    if (items.length === 0) return null
                    return (
                      <div key={category}>
                        <div className="pv-eyebrow mb-2">{category}</div>
                        <div
                          role="radiogroup"
                          aria-label={`Temas ${category}`}
                          className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
                        >
                          {items.map((preset) => (
                            <ThemeCard
                              key={preset.id}
                              preset={preset}
                              active={value.presetId === preset.id}
                              onSelect={() => onChange(applyLetterheadPreset(value, preset.id))}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <p className="mt-3 text-[11px] leading-relaxed text-[var(--pv-muted)]">
                Clique em um card para aplicar na hora. Barra, logomarca e visibilidade não mudam;
                só as cores.
              </p>
            </div>
          ) : null}
        </div>

        {/* Ajuste fino (oculto por padrão) */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFineTuningOpen((open) => !open)}
            aria-expanded={fineTuningOpen}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Ajuste fino das cores
            {value.presetId === 'custom' ? (
              <span className="rounded-full bg-[var(--pv-accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--pv-accent)]">
                Personalizado
              </span>
            ) : null}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', fineTuningOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </Button>
          {fineTuningOpen ? (
            <div className="pv-anim-slide-up mt-2 grid grid-cols-1 gap-4 rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-4 sm:grid-cols-2">
              {COLOR_FIELDS.map((field) => {
                const colorValue = value[field.key]
                return (
                  <Field key={field.key} label={field.label} hint={field.hint}>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={isHexColor(colorValue) ? colorValue : '#000000'}
                        onChange={(event) =>
                          patch(
                            field.key,
                            event.target.value as LetterheadSettings[typeof field.key],
                          )
                        }
                        aria-label={field.label}
                        className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] p-1"
                      />
                      <Input
                        value={colorValue}
                        onChange={(event) =>
                          patch(
                            field.key,
                            event.target.value as LetterheadSettings[typeof field.key],
                          )
                        }
                        maxLength={7}
                        placeholder="#243C9E"
                        className="font-mono"
                        aria-label={`${field.label} em hexadecimal`}
                      />
                    </div>
                    {!isHexColor(colorValue) ? (
                      <span className="pv-error">Use o formato #RRGGBB.</span>
                    ) : null}
                  </Field>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Estilo da barra">
            <Select
              value={value.barStyle}
              onChange={(event) =>
                patch('barStyle', event.target.value as LetterheadSettings['barStyle'])
              }
            >
              <option value="solid">Sólida + filete</option>
              <option value="double">Dupla</option>
              <option value="thin">Fina</option>
            </Select>
          </Field>
          <Field label="Espessura da barra (pt)">
            <Input
              type="number"
              min={1}
              max={4}
              value={value.barWidth}
              onChange={(event) => patch('barWidth', Number(event.target.value))}
            />
          </Field>
          <Field label="Tamanho da logomarca">
            <Select
              value={value.logoSize}
              onChange={(event) =>
                patch('logoSize', event.target.value as LetterheadSettings['logoSize'])
              }
            >
              <option value="s">Pequena</option>
              <option value="m">Média</option>
              <option value="l">Grande</option>
            </Select>
          </Field>
        </div>

        <Field label="Fonte do título do relatório">
          <Select
            value={value.titleFont}
            onChange={(event) =>
              patch('titleFont', event.target.value as LetterheadSettings['titleFont'])
            }
          >
            <option value="helvetica">Helvetica (sans, moderna)</option>
            <option value="times">Times (serifada, clássica)</option>
          </Select>
        </Field>

        <div className="overflow-hidden rounded-xl border border-[var(--pv-border)]">
          {TOGGLES.map((toggle) => (
            <div
              key={toggle.key}
              className="flex items-center justify-between gap-4 border-b border-[var(--pv-border-subtle)] px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-snug">{toggle.title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--pv-muted)]">
                  {toggle.description}
                </p>
              </div>
              <Switch
                checked={value[toggle.key]}
                onCheckedChange={(checked) =>
                  patch(toggle.key, checked as LetterheadSettings[typeof toggle.key])
                }
                aria-label={toggle.title}
              />
            </div>
          ))}
        </div>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--pv-muted)]">
          <Barcode className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Todo documento recebe um código de rastreio único com barcode Code128 no cabeçalho da
          primeira página (à direita, acima da barra) — é obrigatório e não pode ser desativado. Se a
          geração do barcode real falhar, o documento carrega uma representação figurativa do código.
          O código em texto aparece no rodapé de todas as páginas. O CPF do gestor nunca é exibido.
        </p>

        {onGenerateTest ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onGenerateTest} disabled={generating}>
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              {generating ? 'Gerando…' : 'Gerar PDF de teste'}
            </Button>
            <span className="text-xs text-[var(--pv-muted)]">
              Modelo com título, tabela e rodapé — confira margens e barcode.
            </span>
          </div>
        ) : null}
      </div>

      {/* Pré-visualização editorial (escala de A4) */}
      <div className="content-start">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <Eye className="h-4 w-4 text-[var(--pv-muted)]" aria-hidden="true" />
          Pré-visualização
        </div>
        <div
          aria-label="Pré-visualização do timbrado"
          className="rounded-lg bg-white p-4 text-[#0F1B2D] shadow-[0_8px_28px_rgba(15,23,42,0.12)]"
          style={{
            fontFamily:
              value.titleFont === 'times' ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif',
          }}
        >
          <div className="flex items-start gap-2.5">
            <div
              className={cn(
                'flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[#E2E6ED] bg-[#F8F9FB]',
                logoBox,
              )}
            >
              {office.logoBase64 ? (
                <img
                  src={office.logoBase64}
                  alt=""
                  className="max-h-full max-w-full object-contain p-0.5"
                />
              ) : (
                <span className="text-[7px] font-bold tracking-widest text-[#94A3B8]">LOGO</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {name ? (
                <div className="truncate text-[11px] font-bold leading-tight">{name}</div>
              ) : null}
              {value.showTradeName && office.tradeName && office.legalName ? (
                <div className="truncate text-[6.5px] text-[#64748B]">{office.legalName}</div>
              ) : null}
              {value.showCnpj && office.cnpj ? (
                <div className="text-[6.5px] text-[#64748B]">
                  CNPJ {formatDocument(office.cnpj)}
                </div>
              ) : null}
              {value.showRegistrations && registrations ? (
                <div className="truncate text-[6px] text-[#64748B]">{registrations}</div>
              ) : null}
              {value.showAddress && addressLine ? (
                <div className="truncate text-[6px] text-[#64748B]">{addressLine}</div>
              ) : null}
              {value.showContact && contactLine ? (
                <div className="truncate text-[6px] text-[#64748B]">{contactLine}</div>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <div
                className="text-[5px] font-bold tracking-widest"
                style={{ color: value.primaryColor }}
              >
                EMISSOR
              </div>
              {value.showManager && office.managerName ? (
                <div className="max-w-[92px] truncate text-[7px] font-bold">
                  {office.managerName}
                </div>
              ) : null}
              <div className="text-[5.5px] text-[#64748B]">09/11/2026 14:30</div>
              <div className="mt-1.5">
                <span
                  aria-hidden="true"
                  className="block h-[13px] w-[104px] bg-[repeating-linear-gradient(90deg,#0F1B2D_0_1px,transparent_1px_2px,#0F1B2D_2px_3px,transparent_3px_5px,#0F1B2D_5px_6px,transparent_6px_7px)]"
                />
                <span className="block font-mono text-[5px] font-bold leading-tight text-[#64748B]">
                  {sampleCode}
                </span>
              </div>
            </div>
          </div>

          <div
            className="mt-2.5"
            style={{
              height: value.barStyle === 'thin' ? 1 : value.barWidth,
              background: value.primaryColor,
            }}
          />
          <div
            className="mt-[3px]"
            style={{
              height: value.barStyle === 'double' ? 1 : 0.8,
              width: value.barStyle === 'double' ? '100%' : '24%',
              background: value.accentColor,
            }}
          />

          <div className="mt-3 px-2 py-2.5" style={{ background: value.surfaceColor }}>
            <div className="flex items-center justify-between gap-2">
              <span
                className="text-[5px] font-bold tracking-[0.18em]"
                style={{ color: value.primaryColor }}
              >
                RELATORIO OFICIAL
              </span>
              <span className="text-[5px] text-[#64748B]">CODIGO: {sampleCode}</span>
            </div>
            <div
              className="mt-1 text-[13px] font-bold leading-tight"
              style={{ color: value.inkColor }}
            >
              Relatório de Auditoria
            </div>
            <div className="text-[6.5px]" style={{ color: value.mutedColor }}>
              Eventos no período de 01/11/2026 a 09/11/2026
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[8px] font-bold" style={{ color: value.primaryColor }}>
              Eventos
            </div>
            <div className="mt-1 overflow-hidden rounded-sm text-[6.5px]">
              <div
                className="grid grid-cols-[1.1fr_1fr_1.4fr] gap-1 px-1.5 py-1 font-bold text-white"
                style={{ background: value.primaryColor }}
              >
                <span>DATA</span>
                <span>TIPO</span>
                <span>ENTIDADE</span>
              </div>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="grid grid-cols-[1.1fr_1fr_1.4fr] gap-1 border border-t-0 border-[#E2E6ED] px-1.5 py-1"
                  style={{ background: row % 2 === 0 ? '#fff' : '#F8F9FB' }}
                >
                  <span>09/11/2026</span>
                  <span>settings.updated</span>
                  <span>settings</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between border-t border-[#E2E6ED] pt-1.5">
            <span className="text-[5.5px] text-[#64748B]">Gerado localmente - AurumBit Portal</span>
            <span className="text-[5.5px] text-[#64748B]">Pagina 1 de 1</span>
            <span className="font-mono text-[5px] font-bold text-[#64748B]">{sampleCode}</span>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--pv-muted)]">
          O prévio usa seus dados reais; o PDF final é A4 com margens de 18 mm e barcode Code128
          (ou representação figurativa, se a geração falhar).
        </p>
      </div>
    </div>
  )
}
