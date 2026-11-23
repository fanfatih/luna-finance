import type { Db } from './adapter'
import { getSetting, setSetting } from './finance'
import { DEFAULT_TEMPLATES, templateKey, type TemplateKind } from '@/lib/template'

export type Templates = Record<TemplateKind, string>

/** Template yang dipakai: hasil ubahan pengguna, atau bawaan kalau belum pernah diubah. */
export async function loadTemplates(db: Db): Promise<Templates> {
  const [tim, akun] = await Promise.all([getSetting(db, templateKey('tim')), getSetting(db, templateKey('akun'))])
  return { tim: tim || DEFAULT_TEMPLATES.tim, akun: akun || DEFAULT_TEMPLATES.akun }
}

/** Template yang sama dengan bawaan disimpan kosong, supaya pembaruan bawaan ikut terpakai. */
export async function saveTemplates(db: Db, next: Templates): Promise<void> {
  for (const k of ['tim', 'akun'] as const) {
    await setSetting(db, templateKey(k), next[k] === DEFAULT_TEMPLATES[k] ? '' : next[k])
  }
}
