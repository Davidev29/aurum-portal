/**
 * Sistema de movimento — AurumBit Portal
 * Tokens e helpers para micro-interações sutis (sem bounce).
 * Ver docs/motion-system.md para a projeção completa.
 */
export const motion = {
  easeSpring: 'cubic-bezier(0.33, 1.24, 0.4, 1)',
  easeSpringSoft: 'cubic-bezier(0.25, 1.1, 0.35, 1)',
  easeOutExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  durations: { micro: 120, fast: 160, base: 220, slow: 380, modal: 340 },
} as const

/** Anexa ripple de clique a qualquer elemento (usado como fallback fora do Button). */
export function attachRipple(element: HTMLElement, isDark = false) {
  const rect = element.getBoundingClientRect()
  const rippleSize = Math.max(rect.width, rect.height)
  const event = window.event as MouseEvent | undefined
  const x = (event?.clientX ?? rect.left + rect.width / 2) - rect.left - rippleSize / 2
  const y = (event?.clientY ?? rect.top + rect.height / 2) - rect.top - rippleSize / 2
  const ripple = document.createElement('span')
  ripple.className = isDark ? 'pv-ripple pv-ripple--dark' : 'pv-ripple'
  ripple.style.width = ripple.style.height = `${rippleSize}px`
  ripple.style.left = `${x}px`
  ripple.style.top = `${y}px`
  element.appendChild(ripple)
  window.setTimeout(() => ripple.remove(), 550)
}

export const motionClasses = {
  page: 'pv-page-transition',
  pop: 'pv-anim-pop',
  scale: 'pv-anim-scale',
  slideRight: 'pv-anim-slide-right',
  slideLeft: 'pv-anim-slide-left',
  slideUp: 'pv-anim-slide-up',
  checkPop: 'pv-anim-check-pop',
  heartPop: 'pv-anim-heart-pop',
  shake: 'pv-anim-shake',
  staggerSpring: 'pv-stagger-spring',
  pressable: 'pv-pressable',
  lift: 'pv-lift',
  iconBtn: 'pv-icon-btn',
  btn: 'pv-btn',
} as const
