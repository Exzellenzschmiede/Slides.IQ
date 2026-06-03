// ─── Slides.IQ — Marketing landing logic ──────────────────────────────────
// (Multi-language i18n + language switcher are wired in the marketing
//  workstream; this provides the interactive baseline.)

// Current year in footer
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// FAQ accordion
document.querySelectorAll('.faq-q').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.faq-item')?.classList.toggle('open');
  });
});

// If already logged in, swap Login/Register for a single "Zur App" action.
(async () => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return;
    const login = document.getElementById('nav-login');
    const register = document.getElementById('nav-register');
    if (login) login.remove();
    if (register) {
      register.textContent = 'Zur App';
      register.href = '/app';
    }
  } catch { /* not logged in — keep default nav */ }
})();

// Language switcher: persist choice (applied across the marketing site in the
// i18n workstream). Default from storage → browser → 'de'.
const langSelect = document.getElementById('lang-select');
if (langSelect) {
  const stored = localStorage.getItem('landingLang');
  const initial = stored || (navigator.language || 'de').slice(0, 2);
  if ([...langSelect.options].some((o) => o.value === initial)) langSelect.value = initial;
  langSelect.addEventListener('change', () => {
    localStorage.setItem('landingLang', langSelect.value);
    document.documentElement.lang = langSelect.value;
    // Full re-translation is applied in the i18n workstream.
  });
}
