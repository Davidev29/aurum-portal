import { describe, expect, it } from 'vitest'
import {
  isAllowedHost,
  matchesDomainPattern,
  clientInputSchema,
  clientUpdateSchema,
  credentialCreateSchema,
  credentialUpdateSchema,
  serviceInputSchema,
  serviceFilterSchema,
  sessionOpenSchema,
  certificateImportSchema,
  certificateExportBackupSchema,
} from '../../shared/contracts'
import { recipeDefinitionSchema, resolveRecipeTemplate } from '../../shared/recipe'

describe('allowlist de dominios', () => {
  it('compara host exato sem diferenciar maiusculas', () => {
    expect(matchesDomainPattern('gov.br', 'gov.br')).toBe(true)
    expect(matchesDomainPattern('GOV.BR', 'gov.br')).toBe(true)
    expect(matchesDomainPattern('www.gov.br', 'gov.br')).toBe(false)
    expect(matchesDomainPattern('evilgov.br', 'gov.br')).toBe(false)
  })

  it('suporta curinga apenas para subdominios', () => {
    expect(matchesDomainPattern('sso.exemplo.gov.br', '*.exemplo.gov.br')).toBe(true)
    expect(matchesDomainPattern('exemplo.gov.br', '*.exemplo.gov.br')).toBe(true)
    expect(matchesDomainPattern('outro.gov.br', '*.exemplo.gov.br')).toBe(false)
    expect(matchesDomainPattern('exemplo.gov.br', '*.gov.br')).toBe(true)
    expect(matchesDomainPattern('a.b.gov.br', '*.gov.br')).toBe(true)
  })

  it('verifica qualquer padrao da lista', () => {
    expect(isAllowedHost('sso.acesso.gov.br', ['gov.br', 'sso.acesso.gov.br'])).toBe(true)
    expect(isAllowedHost('malicioso.com', ['gov.br'])).toBe(false)
    expect(isAllowedHost('anything.com', [])).toBe(false)
  })
})

describe('schemas de entrada', () => {
  it('valida cliente PF/PJ e consentimento', () => {
    expect(
      clientInputSchema.parse({
        type: 'PJ',
        name: 'Empresa Exemplo',
        document: '11.222.333/0001-81',
        tags: ['fiscal'],
        consent: true,
      }),
    ).toMatchObject({ type: 'PJ', tags: ['fiscal'] })

    expect(() =>
      clientInputSchema.parse({ type: 'PF', name: 'X', document: '123' }),
    ).toThrow()
    expect(() =>
      clientInputSchema.parse({ type: 'OUTRO', name: 'X', document: '52998224725' }),
    ).toThrow()
    expect(clientUpdateSchema.parse({ name: 'Novo nome' })).toEqual({ name: 'Novo nome' })
  })

  it('valida credenciais e exige senha na criacao', () => {
    const input = {
      clientId: 'c1',
      serviceId: 's1',
      label: 'Matriz',
      username: '52998224725',
      usernameType: 'cpf',
      password: 'senha-forte',
    }
    expect(credentialCreateSchema.parse(input)).toMatchObject(input)
    expect(() => credentialCreateSchema.parse({ ...input, password: '' })).toThrow()
    expect(credentialUpdateSchema.parse({ label: 'Novo' })).toEqual({ label: 'Novo' })
  })

  it('valida servico HTTPS e coerencia de metodos', () => {
    const service = {
      name: 'Portal',
      slug: 'portal',
      category: 'Outros',
      baseUrl: 'https://portal.exemplo.gov.br/',
      allowedDomains: ['portal.exemplo.gov.br'],
      authMethods: ['certificate', 'password'],
      defaultAuth: 'certificate',
    }
    expect(serviceInputSchema.parse(service)).toMatchObject({ slug: 'portal' })
    expect(() => serviceInputSchema.parse({ ...service, baseUrl: 'http://inseguro' })).toThrow()
    expect(() => serviceInputSchema.parse({ ...service, slug: 'slug invalido' })).toThrow()
    expect(() =>
      serviceInputSchema.parse({ ...service, authMethods: ['password'], defaultAuth: 'certificate' }),
    ).toThrow()
    expect(serviceFilterSchema.parse({ category: 'Outros', favorite: true })).toMatchObject({
      category: 'Outros',
    })
  })

  it('valida abertura de sessao e backup', () => {
    expect(
      sessionOpenSchema.parse({
        serviceId: 's1',
        clientId: 'c1',
        authMethod: 'certificate',
        certificateId: 'cert1',
      }),
    ).toMatchObject({ authMethod: 'certificate' })
    expect(() =>
      sessionOpenSchema.parse({ serviceId: 's1', clientId: 'c1', authMethod: 'token' }),
    ).toThrow()
    expect(() =>
      certifiateSchemaHelper({ serviceId: 's1', clientId: 'c1', authMethod: 'password' }),
    ).not.toThrow()
    expect(
      certificateImportSchema.parse({
        filePath: 'C:\\certificados\\a.pfx',
        password: 'segredo',
        install: true,
      }),
    ).toMatchObject({ install: true })
    expect(() => certificateImportSchema.parse({ filePath: 'a', password: '' })).toThrow()
    expect(
      certificateExportBackupSchema.parse({ id: 'cert1', passphrase: 'frase com 12+' }),
    ).toMatchObject({ id: 'cert1' })
    expect(() => certificateExportBackupSchema.parse({ id: 'cert1', passphrase: 'curta' })).toThrow()
  })
})

function certifiateSchemaHelper(input: unknown) {
  return sessionOpenSchema.parse(input)
}

describe('receitas', () => {
  it('normaliza defaults e rejeita passos invalidos', () => {
    const recipe = recipeDefinitionSchema.parse({
      version: 1,
      service: 'portal',
      auth: 'password',
      steps: [{ action: 'fill', selectors: ['#user'], value: '{{credential.username}}' }],
      postLogin: { selectors: ['text=Sair'] },
    })
    expect(recipe.autoSubmit).toBe(false)
    expect(recipe.onFailure).toBe('manual')
    expect(recipe.postLogin.timeoutMs).toBe(45_000)
    expect(() =>
      recipeDefinitionSchema.parse({
        version: 2,
        service: 'x',
        auth: 'password',
        steps: [],
        postLogin: { selectors: ['body'] },
      }),
    ).toThrow()
    expect(() =>
      recipeDefinitionSchema.parse({
        version: 1,
        service: 'x',
        auth: 'password',
        steps: [{ action: 'click' }],
        postLogin: { selectors: [] },
      }),
    ).toThrow()
  })

  it('resolve placeholders de credencial e cliente', () => {
    expect(
      resolveRecipeTemplate('{{credential.username}}/{{credential.password}}', {
        username: 'u',
        password: 'p',
      }),
    ).toBe('u/p')
    expect(
      resolveRecipeTemplate('{{client.name}} {{client.document}} {{desconhecido}}', {
        clientName: 'Empresa',
        document: '11222333000181',
      }),
    ).toBe('Empresa 11222333000181 {{desconhecido}}')
  })
})
