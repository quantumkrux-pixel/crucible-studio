// LicenseManager — the frontend's view of the user's entitlement.
//
// IMPORTANT: this is for UX only (showing/hiding buttons, prompting to
// buy). The REAL enforcement is server-side:
//   * the 1-project cap is enforced by RLS on INSERT (0001_init.sql)
//   * export is gated by the authorize-export Edge Function
// So even if someone flips `this.licensed` in dev tools, the database
// still refuses the 2nd project and the function still refuses export.
//
// State:
//   signedIn : is there an auth session
//   licensed : has the user paid (from profiles.licensed)
//
// Emits on the bus: 'auth:changed' whenever either flips.

import { getSupabase, getUser, onAuthChange, isConfigured } from './supabaseClient.js';

export default class LicenseManager {
  constructor(bus){
    this.bus = bus;
    this.signedIn = false;
    this.licensed = false;
    this.user = null;
    this.ready = false;
  }
  async init(){
    if (!isConfigured()){
      // Backend not configured yet: app runs in "local only" mode.
      this.ready = true;
      this.bus.emit('auth:changed', this.state());
      return;
    }
    await this.#refresh();
    // react to login/logout/token refresh
    onAuthChange(async () => { await this.#refresh(); });
    this.ready = true;
  }
  async #refresh(){
    this.user = await getUser();
    this.signedIn = !!this.user;
    this.licensed = this.signedIn ? await this.#fetchLicensed() : false;
    this.bus.emit('auth:changed', this.state());
  }
  async #fetchLicensed(){
    try {
      const supa = await getSupabase();
      const { data, error } = await supa
        .from('profiles').select('licensed').eq('id', this.user.id).single();
      if (error) return false;
      return !!data?.licensed;
    } catch { return false; }
  }
  state(){ return { signedIn:this.signedIn, licensed:this.licensed, user:this.user }; }

  // ---- gating helpers (UX-level; server is the real gate) ----
  canExport(){ return this.licensed; }
  projectLimit(){ return this.licensed ? Infinity : 1; }
  canCreateProject(currentCount){ return currentCount < this.projectLimit(); }

  // ---- purchase flow ----
  // Calls the create-checkout Edge Function and redirects to Stripe.
  async startCheckout(){
    const supa = await getSupabase();
    const { data: { session } } = await supa.auth.getSession();
    if (!session) throw new Error('Please sign in first');
    const res = await fetch(`${supa.supabaseUrl}/functions/v1/create-checkout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const out = await res.json();
    if (out.url) window.location.href = out.url;
    else throw new Error(out.error || 'Checkout failed');
  }

  // Server-side export authorization. Returns true only if the Edge
  // Function confirms the license. Falls back to the local flag if the
  // backend isn't configured (dev / offline build).
  async authorizeExport(){
    if (!isConfigured()) return true;          // local/offline build
    if (!this.signedIn) return false;
    try {
      const supa = await getSupabase();
      const { data: { session } } = await supa.auth.getSession();
      const res = await fetch(`${supa.supabaseUrl}/functions/v1/authorize-export`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const out = await res.json();
      return !!out.allowed;
    } catch { return false; }
  }
}
