/**
 * Autopilot de e2e da Gravação Assistida — SÓ existe em build de teste.
 *
 * Este arquivo é um gancho de teste (C6): o main registra o script na página
 * remota apenas quando `process.env.NODE_ENV === 'test'` (eliminado pelo
 * define+minify do tsup no build de produção). Em produção o arquivo nem é
 * importado — o código do autopilot NÃO existe no binário empacotado.
 *
 * O script é um IIFE auto-contido, escrito como texto puro para injetar via
 * `executeJavaScript`: sem acesso a Node, sem variáveis de ambiente — o
 * usuário e a senha E2E são literais (os mesmos exportados pelo
 * `tests/e2e/helpers/https-server.ts`).
 */
export function buildAutopilotScript(): string {
  // Preenche #wuser/#wpass disparando input/change reais (setter de protótipo,
  // como o runner faz em core.ts) e clica #entrar — ou button[type="submit"]
  // quando #entrar não existe. Entradas sintéticas são capturadas pelo recorder
  // (listeners em fase de captura no document) e gravadas como placeholders.
  return `(() => {
  var USER = '52998224725';
  var PASS = 'SenhaE2E!2026';
  var FILL_DELAY_MS = 1200;
  function setNativeValue(el, value) {
    try {
      var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && typeof setter.set === 'function') { setter.set.call(el, value); } else { el.value = value; }
    } catch (e) {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function clickEntrar() {
    var entrar = document.querySelector('#entrar');
    if (!entrar) entrar = document.querySelector('button[type="submit"]');
    if (entrar) { try { entrar.click(); } catch (e) { /* a navegação pode derrubar a página */ } }
  }
  function attempt(triesLeft) {
    var user = document.querySelector('#wuser');
    var pass = document.querySelector('#wpass');
    if (!user || !pass) {
      if (triesLeft > 0) setTimeout(function () { attempt(triesLeft - 1); }, 150);
      return;
    }
    setNativeValue(user, USER);
    setNativeValue(pass, PASS);
    // Pausa proposital: dá tempo ao drain (250 ms) para coletar os fills e
    // imita a pausa humana antes de enviar o formulário.
    setTimeout(clickEntrar, FILL_DELAY_MS);
  }
  attempt(20);
})()`
}
