/**
 * @deprecated ESTRATÉGIA DESCOMISIONADA (11/nov/2026).
 *
 * O overlay injetado por DOM foi substituído por visibilidade nativa da
 * WebContentsView: `view.setVisible(false)` durante o boot por certificado,
 * loading full-screen na página `/session` (opaco) e revelação atômica em
 * `SessionManager.markAuthenticated()`. Nenhum código deve importar este
 * módulo. Mantido dormente para eventual análise de rollback; remover após
 * um release sem regressões. Ver ESTUDO_STORE_ECAC_ZERO_TELA.md.
 */

const LOADING_STYLES = `
  <style id="pv-loading-styles">
    #pv-loading-overlay {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      background: #0b1220 !important;
      color: #e5e7eb !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: wait !important;
      user-select: none !important;
      overflow: hidden !important;
    }
    #pv-loading-overlay * {
      box-sizing: border-box !important;
    }
    #pv-loading-overlay .pv-logo {
      width: 48px !important;
      height: 48px !important;
      margin-bottom: 16px !important;
      border-radius: 12px !important;
      background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4) !important;
    }
    #pv-loading-overlay .pv-logo svg {
      width: 24px !important;
      height: 24px !important;
      fill: white !important;
    }
    #pv-loading-overlay .pv-spinner {
      width: 40px !important;
      height: 40px !important;
      margin-bottom: 20px !important;
      border: 3px solid rgba(59, 130, 246, 0.2) !important;
      border-top-color: #3b82f6 !important;
      border-radius: 50% !important;
      animation: pv-spin 0.8s linear infinite !important;
    }
    #pv-loading-overlay .pv-title {
      font-size: 16px !important;
      font-weight: 600 !important;
      color: #f1f5f9 !important;
      margin-bottom: 8px !important;
      letter-spacing: 0.02em !important;
    }
    #pv-loading-overlay .pv-message {
      font-size: 13px !important;
      color: #94a3b8 !important;
      margin-bottom: 24px !important;
      min-height: 18px !important;
      text-align: center !important;
    }
    #pv-loading-overlay .pv-progress {
      width: 200px !important;
      height: 4px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      border-radius: 2px !important;
      overflow: hidden !important;
    }
    #pv-loading-overlay .pv-progress-bar {
      height: 100% !important;
      background: linear-gradient(90deg, #3b82f6, #22d3ee) !important;
      width: 0% !important;
      transition: width 0.3s ease !important;
    }
    #pv-loading-overlay .pv-hint {
      font-size: 11px !important;
      color: #64748b !important;
      margin-top: 16px !important;
      animation: pv-pulse 2s ease-in-out infinite !important;
    }
    @keyframes pv-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes pv-pulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
    /* Esconder qualquer conteudo atras do overlay */
    body > *:not(#pv-loading-overlay),
    #pv-loading-overlay ~ * {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    html, body {
      overflow: hidden !important;
    }
  </style>
`;

const LOADING_HTML = (message: string, progress: number) => `
  <div id="pv-loading-overlay">
    <div class="pv-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    </div>
    <div class="pv-spinner"></div>
    <div class="pv-title">Autenticando sessão</div>
    <div class="pv-message" id="pv-loading-message">${message}</div>
    <div class="pv-progress">
      <div class="pv-progress-bar" id="pv-loading-progress" style="width: ${progress}%"></div>
    </div>
    <div class="pv-hint" id="pv-loading-hint">Mantenha esta janela aberta enquanto finalizamos o acesso...</div>
  </div>
`;

const LOADING_MESSAGES = [
  'Inicializando sessão isolada...',
  'Criptografando canal de comunicação...',
  'Validando certificado digital A1...',
  'Estabelecendo handshake mTLS...',
  'Apresentando certificado ao portal...',
  'Autenticando identidade no gov.br...',
  'Confirmando sessão ativa...',
  'Finalizando acesso...',
];

/** Tempo máximo (ms) que o overlay permanece antes de forçar remoção (modo manual). */
export const LOADING_OVERLAY_MAX_MS = 45_000;

export function buildLoadingOverlayHtml(message: string, progress: number): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${LOADING_STYLES}</head><body>${LOADING_HTML(message, progress)}</body></html>`;
}

export function buildInjectScript(message: string, progress: number): string {
  return `(function(){
    if (document.getElementById('pv-loading-overlay')) return;
    // Insere o estilo no head
    const style = document.createElement('style');
    style.id = 'pv-loading-styles';
    style.textContent = ${JSON.stringify(LOADING_STYLES)};
    const head = document.head || document.getElementsByTagName('head')[0];
    if (head) head.appendChild(style);
    // Insere o overlay no body (primeiro filho para ficar acima)
    const body = document.body || document.getElementsByTagName('body')[0];
    if (!body) return 'no-body';
    const div = document.createElement('div');
    div.id = 'pv-loading-overlay';
    div.innerHTML = ${JSON.stringify(LOADING_HTML(message, progress))};
    body.insertBefore(div, body.firstChild);
    // Esconde conteudo da pagina atras do overlay
    const hideContent = () => {
      document.querySelectorAll('body > *:not(#pv-loading-overlay)').forEach(el => {
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
      });
    };
    hideContent();
    const observer = new MutationObserver(hideContent);
    observer.observe(document.body, { childList: true, subtree: true });
    // Guarda referencia do observer para remocao posterior
    (window as any).__pvLoadingObserver = observer;
    return 'overlay-injected';
  })()`;
}

export function buildUpdateMessageScript(message: string, progress: number): string {
  return `(function(){
    const msg = document.getElementById('pv-loading-message');
    const bar = document.getElementById('pv-loading-progress');
    const hint = document.getElementById('pv-loading-hint');
    if (msg) msg.textContent = ${JSON.stringify(message)};
    if (bar) bar.style.width = ${progress} + '%';
    if (hint && ${JSON.stringify(message)}.includes('Finalizando')) hint.textContent = 'Pouco instante...';
    return 'overlay-updated';
  })()`;
}

export function buildRemoveOverlayScript(): string {
  return `(function(){
    // Remove o observer se existir
    try {
      const obs = (window as any).__pvLoadingObserver;
      if (obs && typeof obs.disconnect === 'function') {
        obs.disconnect();
      }
      delete (window as any).__pvLoadingObserver;
    } catch {}
    // Remove o overlay
    const overlay = document.getElementById('pv-loading-overlay');
    if (overlay) overlay.remove();
    // Remove o style injetado
    const style = document.getElementById('pv-loading-styles');
    if (style) style.remove();
    // Restaura visibilidade de TODOS os elementos do DOM
    const body = document.body || document.getElementsByTagName('body')[0];
    if (body) {
      body.style.overflow = '';
      body.style.visibility = '';
      body.style.pointerEvents = '';
      // Percorre recursivamente todos os elementos
      const all = body.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        el.style.visibility = '';
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.style.display = '';
      }
      // Restaura filhos diretos do body
      const children = body.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i];
        el.style.visibility = '';
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.style.display = '';
      }
    }
    // Restaura html e body
    const html = document.documentElement;
    if (html) {
      html.style.overflow = '';
      html.style.visibility = '';
      html.style.display = '';
    }
    // Forca repaint e reflow
    try {
      const disp = document.documentElement.style.display;
      document.documentElement.style.display = 'none';
      document.documentElement.offsetHeight; // força reflow
      document.documentElement.style.display = disp;
    } catch {}
    // Dispara evento de resize para forçar o WebContentsView a recalcular
    try {
      window.dispatchEvent(new Event('resize'));
    } catch {}
    return 'overlay-removed';
  })()`;
}

export function buildIsAuthenticatedScript(selectors: string[]): string {
  return `(function(){
    const finders = ${JSON.stringify(selectors)};
    for (const sel of finders) {
      try {
        let els;
        if (sel.startsWith('text=')) {
          const target = sel.slice(5).trim().toLowerCase();
          els = Array.from(document.querySelectorAll('body *')).filter(el => {
            if (['SCRIPT','STYLE','NOSCRIPT','HTML','BODY'].includes(el.tagName)) return false;
            const v = (el.innerText || el.textContent || '').trim().toLowerCase();
            return v === target;
          });
        } else {
          els = Array.from(document.querySelectorAll(sel));
        }
        const visible = els.some(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
            && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        });
        if (visible) return true;
      } catch {}
    }
    return false;
  })()`;
}

export { LOADING_MESSAGES };
