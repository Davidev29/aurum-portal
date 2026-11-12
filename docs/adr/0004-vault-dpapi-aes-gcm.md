# ADR 0004 — Cofre local com DPAPI e AES-256-GCM

- **Status:** Aceita
- **Data:** 2026-11-04
- **Decisores:** Equipe AurumBit Portal

## Contexto

O aplicativo precisa armazenar senhas de portais, senhas de PFX e o próprio PFX. O banco SQLite fica no perfil do usuário e pode ser copiado, sincronizado por backup ou lido por outro processo. Texto claro ou ofuscação simples não são aceitáveis.

O Windows oferece o Data Protection API (DPAPI), exposto pelo Electron como `safeStorage`. Ele vincula o segredo ao perfil do usuário e, tipicamente, à máquina. Ao mesmo tempo, o cofre precisa de uma chave randômica forte para criptografar vários registros sem reutilizar nonce.

## Decisão

- Gerar uma **chave-mestra de 32 bytes** aleatórios na primeira execução.
- Protegê-la com `safeStorage.encryptString()` (DPAPI no Windows) e gravá-la em `%APPDATA%\AurumBit Portal\vault.key`.
- Derivar chaves por finalidade com **HKDF-SHA-256** a partir da chave-mestra.
- Cifrar cada segredo com **AES-256-GCM**, IV aleatório de 12 bytes e tag de 16 bytes, em envelope versionado `pv1:`.
- Usar **AAD contextual** no formato `tabela:id:campo` para impedir troca de ciphertext entre registros.
- Zerar buffers de chave quando possível (`wipeBuffer`, `clearCache`).
- Exportar backup de certificado com **Argon2id** (64 MiB, 3 iterações, paralelismo 1) e AES-256-GCM, com frase-senha mínima de 12 caracteres.

## Consequências

**Positivas**

- O arquivo do banco não expõe senhas nem PFX em texto claro.
- A chave-mestra não fica em texto claro no disco; só o mesmo perfil Windows a descriptografa.
- AAD impede que um ciphertext seja movido para outro registro sem falha de autenticação.
- Backups de certificado podem sair da máquina com proteção independente do DPAPI.

**Negativas**

- O cofre é vinculado ao perfil do Windows. Reinstalar o sistema ou trocar de máquina sem backup torna os dados irrecuperáveis.
- O aplicativo não oferece desbloqueio por senha-mestra própria; quem controla a sessão Windows controla o cofre aberto.
- Chaves e segredos ficam em memória enquanto o aplicativo está aberto; malware no mesmo usuário pode lê-los.
- O banco não é integralmente criptografado: nomes, documentos e metadados de clientes permanecem legíveis em SQLite.
- A rotação de chave-mestra não está implementada nesta versão.

## Alternativas consideradas

1. **SQLCipher para o banco inteiro.** Mais forte, mas adiciona uma dependência nativa complexa e ainda exigiria proteger a chave do banco com DPAPI.
2. **Windows Credential Manager por segredo.** Boa integração, mas pouco prático para muitos registros e para PFX binários; dificultaria backup e portabilidade.
3. **Cofre com senha-mestra definida pelo usuário.** Melhor contra acesso ao perfil, porém adiciona fricção, recuperação de senha e risco de perda total; fora do escopo do MVP.
4. **Criptografia apenas do arquivo PFX.** Insuficiente: senhas de portal e senhas de PFX também são sensíveis.
