import {createClient} from '@supabase/supabase-js'
import type {LocalDatabase} from './local-database.ts'
import {SignInLocationError} from './identity.ts'

export type SupabaseConfig = {url: string; publishableKey: string}
export function supabaseConfig(): SupabaseConfig | null {
    const env = import.meta.env
    const url = env?.VITE_SUPABASE_URL?.trim()
    const publishableKey = env?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
    if (!url || !publishableKey) return null
    if (!url.startsWith('https://') && !url.startsWith('http://127.0.0.1:'))
        throw new Error('Invalid Supabase URL')
    if (publishableKey.startsWith('sb_secret_'))
        throw new Error('Use a publishable key, never a secret key')
    return {url, publishableKey}
}
export function createSupabase(
    database: LocalDatabase,
    config = supabaseConfig(),
) {
    if (!config) return null
    return createClient(config.url, config.publishableKey, {
        db: {schema: 'start'},
        auth: {
            storageKey: 'start:auth',
            detectSessionInUrl: false,
            persistSession: true,
            autoRefreshToken: true,
            storage: {
                async getItem(key) {
                    return (
                        (await database.getMetadata<string>(`auth:${key}`)) ??
                        null
                    )
                },
                async setItem(key, value) {
                    await database.setMetadata(`auth:${key}`, value)
                },
                async removeItem(key) {
                    await database.setMetadata(`auth:${key}`, null)
                },
            },
        },
    })
}
export function cloudError(error: unknown) {
    if (error instanceof SignInLocationError) return error.message
    const value = error as {code?: string; message?: string}
    const message = value?.message || ''
    if (
        ['PGRST106', 'PGRST202', '3F000', '42883'].includes(
            value?.code || '',
        ) ||
        /schema.*start|function.*start/i.test(message)
    )
        return 'Синхронизация ещё не настроена на сервере.'
    if (/PROFILE_NOT_FOUND/.test(message))
        return 'По этой фразе профиль Start. не найден.'
    if (/AUTH_OWNER_CHANGED/.test(message))
        return 'В другой вкладке изменился профиль. Для продолжения войдите по фразе снова.'
    if (/web3|provider.*disabled|unsupported.*provider/i.test(message))
        return 'Вход по фразе ещё не включён на сервере.'
    if (/fetch|network|offline/i.test(message))
        return 'Нет связи с сервером. Данные остаются на устройстве.'
    if (/12 слов|Контрольная сумма/.test(message)) return message
    if (/identity.*cleared/i.test(message))
        return 'Вход отменён. Повторите ввод фразы.'
    return 'Не удалось синхронизировать данные. Повторите попытку.'
}
export type CloudClient = NonNullable<ReturnType<typeof createSupabase>>
