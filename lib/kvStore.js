import { supabase } from './supabaseClient';

const TABLE = 'kv_store';
const DEVICE_KEY = 'std_line_device_id';

// "Personal" (shared=false) data is scoped per-browser using a random id kept in
// localStorage, since this app has no login system. "Shared" (shared=true) data
// is global for everyone who opens the site. Swap this out for a real user id
// once you add authentication.
function getDeviceId() {
  if (typeof window === 'undefined') return 'server';
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function scopePrefix(shared) {
  return shared ? 'shared::' : `device::${getDeviceId()}::`;
}

function scopedKey(key, shared) {
  return scopePrefix(shared) + key;
}

export const storage = {
  async get(key, shared = false) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('value')
      .eq('key', scopedKey(key, shared))
      .maybeSingle();
    if (error || !data) return null;
    return { key, value: JSON.stringify(data.value), shared };
  },

  async set(key, value, shared = false) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (e) {
      parsed = value;
    }
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key: scopedKey(key, shared), value: parsed, updated_at: new Date().toISOString() });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('storage.set failed', error);
      return null;
    }
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    const { error } = await supabase.from(TABLE).delete().eq('key', scopedKey(key, shared));
    if (error) return null;
    return { key, deleted: true, shared };
  },

  // ดึงทั้ง key และ value ของทุกคีย์ที่ขึ้นต้นด้วย prefix ในคำขอเดียว
  // (เดิมต้อง list แล้ว get ทีละคีย์ ~120 คำขอเรียงกัน ทำให้ตอนเปิดเว็บค้างนาน)
  async getAll(prefix = '', shared = false) {
    const scoped = scopePrefix(shared) + prefix;
    const { data, error } = await supabase.from(TABLE).select('key,value').like('key', `${scoped}%`);
    if (error || !data) return null;
    const stripLen = scopePrefix(shared).length;
    return data.map((row) => ({ key: row.key.substring(stripLen), value: JSON.stringify(row.value) }));
  },

  async list(prefix = '', shared = false) {
    const scoped = scopePrefix(shared) + prefix;
    const { data, error } = await supabase.from(TABLE).select('key').like('key', `${scoped}%`);
    if (error || !data) return null;
    const stripLen = scopePrefix(shared).length;
    return { keys: data.map((row) => row.key.substring(stripLen)), prefix, shared };
  },
};
