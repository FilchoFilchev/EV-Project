const TRANSITION_DURATION_MS = 220

export function initPageTransitions() {
  const pageContent = document.querySelector('#page-content')

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const link = event.target.closest('a[href]')
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return

    const destination = new URL(link.href, window.location.href)
    if (destination.origin !== window.location.origin) return
    if (destination.hash && destination.href.split('#')[0] === window.location.href.split('#')[0]) return
    if (destination.href === window.location.href) return

    event.preventDefault()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.location.assign(destination.href)
      return
    }

    pageContent?.classList.add('ev-page-leaving')
    window.setTimeout(() => {
      window.location.assign(destination.href)
    }, TRANSITION_DURATION_MS)
  })

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !pageContent) return
    pageContent.classList.remove('ev-page-leaving')
  })
}
