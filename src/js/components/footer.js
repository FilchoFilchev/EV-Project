export function renderFooter() {
  document.querySelector('#footer').innerHTML = `
    <footer class="border-top mt-auto py-4">
      <div class="container d-flex flex-column flex-sm-row justify-content-between gap-2">
        <span class="text-secondary">&copy; ${new Date().getFullYear()} EchoVault</span>
        <div class="d-flex gap-3">
          <a class="link-secondary link-offset-2" href="#terms">Terms</a>
          <a class="link-secondary link-offset-2" href="#privacy">Privacy</a>
        </div>
      </div>
    </footer>
  `
}
