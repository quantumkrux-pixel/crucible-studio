// AuthPanel — login / sign-up modal and the account button in the
// lobby. Purely presentational; delegates to LicenseManager + the
// supabase auth helpers. Shows license status and an Upgrade button.
import { signIn, signUp, signOut, isConfigured } from './supabaseClient.js';
import toast from '../ui/toast.js';

export default class AuthPanel {
  #pendingCheckout = false;
  constructor(bus, license){
    this.bus = bus; this.license = license;
    this.#buildModal();
    this.bus.on('auth:changed', s => { this.#syncButton(s); this.#syncUpgrade(s); });
    // something needs a signed-in user (e.g. creating a project) → open sign-in
    this.bus.on('auth:prompt', () => { if (!this.license.signedIn) this.open('signin'); });
    // account button in the lobby: sign in (logged out) or menu (logged in)
    const acct = document.getElementById('account-btn');
    if (acct) acct.addEventListener('click', () => {
      if (!this.license.signedIn) this.open('signin');
      else this.#accountMenu();
    });
    // "Get Crucible3D" on the landing page links here with ?checkout=1 —
    // take the user straight toward purchase (signing in first if needed).
    this.#pendingCheckout = new URLSearchParams(location.search).has('checkout');
    if (this.#pendingCheckout && !isConfigured()){
      // backend not wired yet — can't take payment; don't trap the user
      this.#pendingCheckout = false;
      this.#clearCheckoutParam();
    } else if (this.#pendingCheckout){
      this.#armCheckoutIntent();
    }
  }
  #armCheckoutIntent(){
    // Wait until auth state is known, then route to the right step. This
    // fires on the first auth:changed after init (and again after login).
    const handler = async s => {
      if (!this.#pendingCheckout) return;
      if (s.licensed){
        this.#pendingCheckout = false;
        this.#clearCheckoutParam();
        toast('You already own the full version — thanks!');
      } else if (s.signedIn){
        // signed in, not licensed → go straight to Stripe checkout
        this.#pendingCheckout = false;
        this.#clearCheckoutParam();
        this.upgrade();
      } else {
        // not signed in → open auth; after they sign in this handler
        // re-runs (auth:changed) and proceeds to checkout above.
        this.open('signin');
      }
    };
    this.bus.on('auth:changed', handler);
  }
  #clearCheckoutParam(){
    try {
      const u = new URL(location.href);
      u.searchParams.delete('checkout');
      history.replaceState({}, '', u);
    } catch {}
  }
  // Minimal account menu: upgrade (if free) + sign out.
  #accountMenu(){
    const s = this.license.state();
    if (!s.licensed){
      if (confirm('Upgrade to the full version for $10?\n\nUnlocks unlimited projects and exporting.')) this.upgrade();
    } else {
      if (confirm('Sign out of Crucible3D?')) this.logout();
    }
  }
  // Show/hide the lobby upgrade banner based on entitlement.
  #syncUpgrade(s){
    const slot = document.getElementById('upgrade-slot');
    if (!slot) return;
    if (!isConfigured()){ slot.innerHTML = ''; return; }   // local/offline build
    if (s.signedIn && !s.licensed){
      slot.innerHTML = `<div class="upgrade-banner">
        <span>You're on the <strong>free plan</strong> — 1 project, no exporting.
        Unlock unlimited projects, exporting, and the offline app for <strong>$10</strong>.</span>
        <button class="upgrade-btn" id="upgrade-btn">Upgrade</button></div>`;
      slot.querySelector('#upgrade-btn').addEventListener('click', () => this.upgrade());
    } else if (!s.signedIn){
      slot.innerHTML = `<div class="upgrade-banner signin-required">
        <span><strong>You'll need an account to start.</strong> Creating a project requires a
        free sign-in — it takes a few seconds and keeps your work synced across devices.</span>
        <button class="upgrade-btn" id="signin-cta">Sign in / Sign up</button></div>`;
      slot.querySelector('#signin-cta').addEventListener('click', () => this.open('signin'));
    } else {
      slot.innerHTML = '';   // licensed: nothing to upsell
    }
  }
  #buildModal(){
    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'auth-modal';
    modal.innerHTML = `
      <div class="auth-card">
        <button class="auth-close" title="Close">✕</button>
        <h2 id="auth-title">Sign in</h2>
        <p class="auth-sub" id="auth-sub">Sign in to sync projects across devices.</p>
        <input type="email" id="auth-email" placeholder="you@example.com" autocomplete="email">
        <input type="password" id="auth-pass" placeholder="Password" autocomplete="current-password">
        <button class="auth-primary" id="auth-submit">Sign in</button>
        <div class="auth-switch">
          <span id="auth-switch-text">No account?</span>
          <button class="auth-link" id="auth-switch-btn">Create one</button>
        </div>
        <div class="auth-error" id="auth-error"></div>
      </div>`;
    document.body.appendChild(modal);
    this.modal = modal;
    this.mode = 'signin';

    modal.querySelector('.auth-close').addEventListener('click', () => this.close());
    modal.addEventListener('click', e => { if (e.target === modal) this.close(); });
    modal.querySelector('#auth-switch-btn').addEventListener('click', () => this.#toggleMode());
    modal.querySelector('#auth-submit').addEventListener('click', () => this.#submit());
    modal.querySelector('#auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter') this.#submit(); });
  }
  #toggleMode(){
    this.mode = this.mode === 'signin' ? 'signup' : 'signin';
    const t = this.modal;
    t.querySelector('#auth-title').textContent = this.mode === 'signin' ? 'Sign in' : 'Create account';
    t.querySelector('#auth-sub').textContent = this.mode === 'signin'
      ? 'Sign in to sync projects across devices.'
      : 'Create an account to save more projects and export your work.';
    t.querySelector('#auth-submit').textContent = this.mode === 'signin' ? 'Sign in' : 'Create account';
    t.querySelector('#auth-switch-text').textContent = this.mode === 'signin' ? 'No account?' : 'Have an account?';
    t.querySelector('#auth-switch-btn').textContent = this.mode === 'signin' ? 'Create one' : 'Sign in';
    t.querySelector('#auth-error').textContent = '';
  }
  async #submit(){
    if (!isConfigured()){
      this.#error('Backend not configured yet. Add your Supabase keys in js/auth/supabaseClient.js.');
      return;
    }
    const email = this.modal.querySelector('#auth-email').value.trim();
    const pass = this.modal.querySelector('#auth-pass').value;
    if (!email || !pass){ this.#error('Enter your email and password.'); return; }
    const btn = this.modal.querySelector('#auth-submit');
    btn.disabled = true; btn.textContent = 'Please wait…';
    try {
      const { error } = this.mode === 'signin'
        ? await signIn(email, pass)
        : await signUp(email, pass);
      if (error){ this.#error(error.message); }
      else {
        toast(this.mode === 'signin' ? 'Signed in' : 'Account created — check your email to confirm');
        this.close();
      }
    } catch (e){ this.#error(e.message || 'Something went wrong'); }
    finally { btn.disabled = false; btn.textContent = this.mode === 'signin' ? 'Sign in' : 'Create account'; }
  }
  #error(msg){ this.modal.querySelector('#auth-error').textContent = msg; }

  open(mode = 'signin'){
    if (this.mode !== mode) this.#toggleMode();
    this.modal.classList.add('open');
    this.modal.querySelector('#auth-email').focus();
  }
  close(){ this.modal.classList.remove('open'); }

  // Reflects auth state onto the lobby account button (created in Lobby).
  #syncButton(s){
    const btn = document.getElementById('account-btn');
    if (!btn) return;
    if (!s.signedIn){ btn.textContent = 'Sign in'; btn.dataset.state = 'out'; return; }
    btn.dataset.state = s.licensed ? 'licensed' : 'free';
    btn.textContent = s.licensed ? 'Account ✓' : 'Account · Free';
  }

  async upgrade(){
    try { await this.license.startCheckout(); }
    catch (e){ toast(e.message || 'Could not start checkout'); }
  }
  async logout(){ await signOut(); toast('Signed out'); }
}
