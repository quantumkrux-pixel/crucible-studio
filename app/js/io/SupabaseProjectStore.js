// SupabaseProjectStore — same interface as ProjectStore, but backed by
// the Supabase `projects` table instead of local IndexedDB. Enables
// cross-device sync (projects follow the logged-in user).
//
// The 1-project free-tier cap is NOT checked here — it's enforced by
// the database RLS policy on INSERT, so `create()` will simply get an
// error from Supabase if an unlicensed user exceeds the limit. We
// surface that as a typed error the UI can catch.
//
// Index entries returned by list() match the local store's shape
// ({ id, name, updated, thumb }) so the Lobby renders identically.

import { getSupabase } from '../auth/supabaseClient.js';

export class ProjectLimitError extends Error {
  constructor(){ super('Free plan is limited to 1 project. Upgrade to save more.'); this.name = 'ProjectLimitError'; }
}
export class NotSignedInError extends Error {
  constructor(){ super('Sign in to create and sync projects.'); this.name = 'NotSignedInError'; }
}

export default class SupabaseProjectStore {
  async #supa(){ return getSupabase(); }

  async list(){
    const supa = await this.#supa();
    const { data, error } = await supa
      .from('projects')
      .select('id, name, updated_at, thumbnail')
      .order('updated_at', { ascending: false });
    if (error) return [];
    return (data ?? []).map(r => ({
      id: r.id, name: r.name,
      updated: new Date(r.updated_at).getTime(),
      thumb: r.thumbnail ?? null,
    }));
  }

  async create(name){
    const supa = await this.#supa();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) throw new NotSignedInError();
    const { data, error } = await supa
      .from('projects')
      .insert({ user_id: user.id, name: (name || 'Untitled').trim() || 'Untitled', data: {} })
      .select('id, name, updated_at, thumbnail')
      .single();
    if (error){
      // RLS INSERT policy rejection (over the free-tier cap) surfaces here
      if (error.code === '42501' || /row-level security/i.test(error.message))
        throw new ProjectLimitError();
      throw error;
    }
    return { id: data.id, name: data.name, updated: new Date(data.updated_at).getTime(), thumb: null };
  }

  async rename(id, name){
    const supa = await this.#supa();
    await supa.from('projects').update({ name: (name || '').trim() || 'Untitled' }).eq('id', id);
  }

  async clone(id){
    const supa = await this.#supa();
    const { data: src, error } = await supa
      .from('projects').select('name, data, thumbnail').eq('id', id).single();
    if (error || !src) return null;
    const { data: { user } } = await supa.auth.getUser();
    const { data, error: insErr } = await supa
      .from('projects')
      .insert({ user_id: user.id, name: src.name + ' copy', data: src.data, thumbnail: src.thumbnail })
      .select('id, name, updated_at, thumbnail')
      .single();
    if (insErr){
      if (insErr.code === '42501' || /row-level security/i.test(insErr.message))
        throw new ProjectLimitError();
      return null;
    }
    return { id: data.id, name: data.name, updated: new Date(data.updated_at).getTime(), thumb: data.thumbnail };
  }

  async saveProject(id, dataJson, thumb){
    const supa = await this.#supa();
    const patch = { data: JSON.parse(dataJson) };
    if (thumb) patch.thumbnail = thumb;
    await supa.from('projects').update(patch).eq('id', id);
  }

  async loadProject(id){
    const supa = await this.#supa();
    const { data, error } = await supa.from('projects').select('data').eq('id', id).single();
    if (error || !data) return null;
    return JSON.stringify(data.data);
  }

  async remove(id){
    const supa = await this.#supa();
    await supa.from('projects').delete().eq('id', id);
  }
}
