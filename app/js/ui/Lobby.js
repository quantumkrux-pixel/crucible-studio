// Full-screen project launch lobby: create, reopen, and delete
// projects, each showing a thumbnail of its scene. Shown at startup
// and whenever the user backs out of a project. Also links to the
// user guide and README (static markup in index.html).
export default class Lobby {
  constructor(store, { onOpen, onCreate }, folder = null){
    this.store = store;
    this.onOpen = onOpen;
    this.onCreate = onCreate;
    this.folder = folder;
    this.el = document.getElementById('lobby');
    this.grid = document.getElementById('project-grid');
    this.folderBar = document.getElementById('folder-bar');
    this.#buildFolderBar();
  }
  #buildFolderBar(){
    if (!this.folderBar) return;
    // Hidden entirely when the File System Access API isn't available.
    if (!this.folder){ this.folderBar.style.display = 'none'; return; }
    this.#renderFolderBar();
  }
  #renderFolderBar(){
    const linked = this.folder.linked;
    this.folderBar.innerHTML = linked
      ? `<span class="folder-status">📁 Saving to <strong>${this.folder.name}</strong></span>
         <button class="folder-btn" data-act="change">Change…</button>
         <button class="folder-btn" data-act="unlink">Unlink</button>`
      : `<span class="folder-status">Projects are stored in this browser.</span>
         <button class="folder-btn primary" data-act="link">Save to a folder…</button>`;
    this.folderBar.querySelector('[data-act="link"]')?.addEventListener('click', () => this.#link());
    this.folderBar.querySelector('[data-act="change"]')?.addEventListener('click', () => this.#link());
    this.folderBar.querySelector('[data-act="unlink"]')?.addEventListener('click', async () => {
      await this.folder.unlink(); this.#renderFolderBar();
    });
  }
  async #link(){
    try {
      await this.folder.link();
      this.#renderFolderBar();
    } catch (e){ /* user cancelled the picker */ }
  }
  async show(){
    this.el.classList.add('open');
    if (this.folder) this.#renderFolderBar();
    await this.#render();
  }
  hide(){ this.el.classList.remove('open'); }

  async #render(){
    const list = await this.store.list();
    this.grid.innerHTML = '';
    this.grid.appendChild(this.#newCard());
    list.forEach(p => this.grid.appendChild(this.#card(p)));
  }
  #newCard(){
    const card = document.createElement('div');
    card.className = 'proj-card new';
    // read auth state from the account button (AuthPanel keeps it current)
    const signedOut = () => {
      const acct = document.getElementById('account-btn');
      return acct && acct.dataset.state === 'out';
    };
    const idle = () => {
      const gated = signedOut();
      card.classList.toggle('gated', gated);
      card.innerHTML = `<div class="thumb plus">+</div>
        <div class="meta"><div class="pname">New project</div>
        <div class="pdate">${gated ? '🔒 Sign in to start' : 'Start from a fresh scene'}</div></div>`;
    };
    idle();
    card.addEventListener('click', () => {
      if (card.querySelector('input')) return;
      // signed out → go straight to sign-in instead of a dead name field
      if (signedOut()){ this.onCreate(''); return; }
      card.innerHTML = `<div class="thumb plus">+</div><div class="meta">
        <input class="pname-input" placeholder="Project name" maxlength="40">
        <div class="pdate">Enter to create · Esc to cancel</div></div>`;
      const inp = card.querySelector('input');
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') this.onCreate(inp.value);
        if (ev.key === 'Escape') idle();
      });
      inp.addEventListener('blur', () => setTimeout(() => { if (card.querySelector('input')) idle(); }, 150));
      inp.focus();
    });
    return card;
  }
  #card(p){
    const card = document.createElement('div');
    card.className = 'proj-card';
    const date = new Date(p.updated).toLocaleString([], { dateStyle:'medium', timeStyle:'short' });
    card.innerHTML = `
      <div class="thumb">${p.thumb ? `<img src="${p.thumb}" alt="">` :
        `<svg viewBox="0 0 24 24" fill="none" stroke="#3a4150" stroke-width="1.4">
           <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>`}</div>
      <div class="meta"><div class="pname"></div><div class="pdate">Edited ${date}</div></div>
      <div class="pacts">
        <button class="pact" data-act="rename" title="Rename">✎</button>
        <button class="pact" data-act="clone" title="Clone project">⧉</button>
        <button class="pact pdel" data-act="delete" title="Delete project">✕</button>
      </div>`;
    card.querySelector('.pname').textContent = p.name;   // safe for any name
    card.addEventListener('click', () => this.onOpen(p));
    card.querySelector('[data-act="rename"]').addEventListener('click', e => {
      e.stopPropagation();
      this.#renameInline(card, p);
    });
    card.querySelector('[data-act="clone"]').addEventListener('click', async e => {
      e.stopPropagation();
      await this.store.clone(p.id);
      this.#render();
    });
    const del = card.querySelector('[data-act="delete"]');
    del.addEventListener('click', async e => {
      e.stopPropagation();
      if (!del.classList.contains('confirm')){
        del.classList.add('confirm');
        del.textContent = 'Delete?';
        setTimeout(() => { del.classList.remove('confirm'); del.textContent = '✕'; }, 2500);
        return;
      }
      await this.store.remove(p.id);
      this.#render();
    });
    return card;
  }
  #renameInline(card, p){
    const meta = card.querySelector('.meta');
    meta.innerHTML = `<input class="pname-input" maxlength="40">
      <div class="pdate">Enter to save · Esc to cancel</div>`;
    const inp = meta.querySelector('input');
    inp.value = p.name;
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('keydown', async ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter'){ await this.store.rename(p.id, inp.value); this.#render(); }
      if (ev.key === 'Escape') this.#render();
    });
    inp.addEventListener('blur', () => setTimeout(() => {
      if (meta.querySelector('input')) this.#render();
    }, 150));
    inp.focus();
    inp.select();
  }
}
