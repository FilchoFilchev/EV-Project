import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'

renderNavbar('index')
renderFooter()
initPageTransitions()

const homepage = document.querySelector('.homepage-main')
const hero = document.querySelector('.hero-section')
const heroLink = document.querySelector('.hero-cta-hitarea')

if (homepage && hero && heroLink) {
  const imageWidth = 1774
  const imageHeight = 887
  const button = { x: 814, y: 542, width: 146, height: 52 }

  function positionHeroLink() {
    const { width, height } = hero.getBoundingClientRect()
    if (!width || !height) return

    const scale = Math.max(width / imageWidth, height / imageHeight)
    const renderedWidth = imageWidth * scale
    const renderedHeight = imageHeight * scale
    const [positionX, positionY] = getComputedStyle(homepage).backgroundPosition
      .split(/\s+/)
      .map((position) => parseFloat(position) / 100)
    const offsetX = (width - renderedWidth) * (positionX || 0.5)
    const offsetY = (height - renderedHeight) * (positionY || 0.5)

    heroLink.style.left = `${button.x * scale + offsetX}px`
    heroLink.style.top = `${button.y * scale + offsetY}px`
    heroLink.style.width = `${button.width * scale}px`
    heroLink.style.height = `${button.height * scale}px`
  }

  positionHeroLink()
  window.addEventListener('resize', positionHeroLink)
}
