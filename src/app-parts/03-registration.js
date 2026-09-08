(() => {
  if (globalThis.__BOSPA_REGISTRATION_UI__) return;
  globalThis.__BOSPA_REGISTRATION_UI__ = true;

  const loginCopy = new WeakMap();

  function registrationMarkup() {
    return `<div class="bospa-registration-copy"><span class="eyebrow">7 дней бесплатно</span><h1>Создайте рабочее пространство</h1><p>Добавьте квартиры и пригласите команду после первого входа. Платёжные данные для trial не требуются.</p></div>
      <div class="bospa-registration-error" data-registration-error hidden></div>
      <form data-bospa-register-form class="bospa-auth-form">
        <label><span>Ваше имя</span><input name="name" autocomplete="name" required maxlength="120" /></label>
        <label><span>Название бизнеса</span><input name="workspaceName" autocomplete="organization" required maxlength="160" placeholder="Например, Arman Apartments" /></label>
        <label><span>Email</span><input name="email" type="email" autocomplete="username" required /></label>
        <label><span>Пароль</span><input name="password" type="password" autocomplete="new-password" minlength="12" required /></label>
        <button class="button primary full" type="submit">Создать workspace</button>
      </form>
      <button class="bospa-demo-link" type="button" data-bospa-show-login>Уже есть аккаунт — войти</button>`;
  }

  function mountRegistrationCTA() {
    const gate = document.querySelector('[data-bospa-auth-gate]');
    const card = gate?.querySelector('.bospa-auth-card');
    if (!card || card.querySelector('[data-bospa-show-register]')) return;
    const demo = card.querySelector('[data-bospa-demo]');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bospa-register-link';
    button.dataset.bospaShowRegister = '';
    button.textContent = 'Создать новый бизнес';
    if (demo) demo.before(button); else card.append(button);
  }

  function showRegistration() {
    const card = document.querySelector('[data-bospa-auth-gate] .bospa-auth-card');
    if (!card) return;
    if (!loginCopy.has(card)) loginCopy.set(card, card.innerHTML);
    const brand = card.querySelector('.bospa-auth-brand')?.outerHTML || '';
    card.innerHTML = `${brand}${registrationMarkup()}`;
  }

  function showLogin() {
    const card = document.querySelector('[data-bospa-auth-gate] .bospa-auth-card');
    const html = card && loginCopy.get(card);
    if (!card || !html) {
      location.reload();
      return;
    }
    card.innerHTML = html;
    mountRegistrationCTA();
  }

  async function register(form) {
    const errorNode = form.parentElement.querySelector('[data-registration-error]');
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Создаём…';
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch('/api/v1/auth/register', {
        method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body:JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      if (globalThis.bospaRemote && payload.csrfToken) globalThis.bospaRemote.csrfToken = payload.csrfToken;
      location.reload();
    } catch (error) {
      errorNode.hidden = false;
      errorNode.textContent = error.message.includes('404') ? 'Регистрация временно недоступна. Обратитесь к команде Bospa.' : error.message;
      button.disabled = false;
      button.textContent = 'Создать workspace';
    }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-bospa-show-register]')) showRegistration();
    if (event.target.closest('[data-bospa-show-login]')) showLogin();
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-bospa-register-form]');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void register(form);
  }, true);
  const observer = new MutationObserver(() => mountRegistrationCTA());
  observer.observe(document.documentElement, {subtree:true, childList:true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountRegistrationCTA, {once:true});
  else mountRegistrationCTA();
})();
