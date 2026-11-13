<script lang="ts">
    import {onDestroy} from 'svelte'
    import type {AppController} from '../../app/controller'
    import type {SyncStatus} from '../../app/sync-types'
    import {createPhrase} from '../../app/identity.ts'
    import Button from '../ui/button.svelte'
    import TextareaField from '../ui/textarea-field.svelte'
    import CheckboxOption from '../ui/checkbox-option.svelte'
    let {
        state: syncState,
        controller,
        open,
    }: {state?: SyncStatus; controller: AppController; open: boolean} = $props()
    let mode = $state<'choose' | 'create' | 'restore'>('choose')
    let phrase = $state('')
    let saved = $state(false)
    let pending = $state(false)
    let error = $state('')
    $effect(() => {
        if (!open) {
            phrase = ''
            saved = false
            mode = 'choose'
            error = ''
        }
    })
    const labels = {
        local: 'На этом устройстве',
        connecting: 'Подключение…',
        syncing: 'Синхронизация…',
        synced: 'Синхронизировано',
        offline: 'Нет подключения',
        error: 'Требуется внимание',
    }
    function create() {
        phrase = createPhrase()
        saved = false
        mode = 'create'
        error = ''
    }
    function restore() {
        phrase = ''
        saved = false
        mode = 'restore'
        error = ''
    }
    async function submit(event: SubmitEvent) {
        event.preventDefault()
        if (pending || (mode === 'create' && !saved)) return
        pending = true
        error = ''
        const result =
            mode === 'create'
                ? await controller.createSyncProfile(phrase)
                : await controller.connectSyncProfile(phrase)
        pending = false
        if (result.ok) {
            phrase = ''
            mode = 'choose'
        } else error = result.error || 'Не удалось подключить профиль.'
    }
    async function remove() {
        if (
            !confirm(
                'Удалить подписки, настройки и историю Start. из облака на всех устройствах? Данные других приложений останутся.',
            )
        )
            return
        pending = true
        try {
            await controller.deleteSyncProfile()
        } catch {
            error = 'Не удалось удалить данные. Повторите попытку.'
        } finally {
            pending = false
        }
    }
    async function disconnect() {
        pending = true
        error = ''
        try {
            await controller.disconnectSync()
        } catch {
            error = 'Не удалось отключить устройство. Повторите попытку.'
        } finally {
            pending = false
        }
    }
    onDestroy(() => {
        phrase = ''
    })
</script>

<div class="settings__section-shell" data-sync-section>
    <div class="settings__card settings__block">
        <div class="settings__card-head">
            <h4 class="settings__subtitle">Одна лента на ваших устройствах</h4>
            <p class="settings__note">
                Подписки, прочитанность, настройки и история рекомендаций
                сохраняются вместе. Для доступа нужна фраза из 12 слов.
            </p>
        </div>
        {#if !syncState?.configured}
            <p class="settings__note">
                Синхронизация пока не настроена. Данные сохраняются на этом
                устройстве.
            </p>
        {:else}
            <p class="settings__note" role="status">
                {labels[syncState.status]}{syncState.pending
                    ? ` · Ожидают отправки: ${syncState.pending}`
                    : ''}
            </p>
            {#if (error || syncState.error) && mode === 'choose'}<p
                    class="settings__form-error"
                    role="alert"
                >
                    {error || syncState.error}
                </p>{/if}
            {#if syncState.userId && mode === 'choose'}
                <div class="settings__actions-row">
                    <Button
                        class="settings__submit"
                        onclick={() => controller.syncNow()}
                        disabled={pending}>Синхронизировать</Button
                    >
                    <Button
                        class="settings__submit"
                        onclick={disconnect}
                        disabled={pending}>Отключить это устройство</Button
                    >
                </div>
                {#if syncState.status === 'error'}<Button
                        class="settings__submit"
                        onclick={restore}>Войти по фразе снова</Button
                    >{/if}
                <p class="settings__note">
                    Для другого устройства выберите вход по фразе и введите
                    сохранённые слова. Фраза даёт полный доступ к профилю.
                </p>
                <Button
                    class="settings__submit"
                    onclick={remove}
                    disabled={pending}>Удалить данные Start. из облака</Button
                >
            {:else if mode === 'choose'}
                <div class="settings__actions-row">
                    <Button
                        class="settings__submit"
                        variant="primary"
                        onclick={create}>Создать профиль синхронизации</Button
                    >
                    <Button class="settings__submit" onclick={restore}
                        >Подключить существующий профиль</Button
                    >
                </div>
            {:else}
                <form
                    class="form settings__form"
                    onsubmit={submit}
                    aria-busy={pending}
                >
                    <fieldset class="settings__fieldset" disabled={pending}>
                        <TextareaField
                            label={mode === 'create'
                                ? 'Сохраните фразу доступа'
                                : 'Фраза доступа'}
                            bind:value={phrase}
                            rows={3}
                            readonly={mode === 'create'}
                            autocomplete="off"
                            autocapitalize="none"
                            spellcheck="false"
                            required
                        />
                        {#if mode === 'create'}
                            <p class="settings__note">
                                Сохраните слова в надёжном месте. Если потерять
                                фразу и доступ ко всем устройствам, восстановить
                                профиль не получится.
                            </p>
                            <CheckboxOption
                                name="phraseSaved"
                                label="Я сохранил фразу доступа"
                                checked={saved}
                                onchange={(checked) => (saved = checked)}
                            />
                        {/if}
                        {#if error}<p class="settings__form-error" role="alert">
                                {error}
                            </p>{/if}
                        <div class="settings__actions-row">
                            <Button
                                class="settings__submit"
                                variant="primary"
                                type="submit"
                                disabled={pending ||
                                    (mode === 'create' && !saved)}
                                >{pending
                                    ? 'Подключение…'
                                    : mode === 'create'
                                      ? 'Включить синхронизацию'
                                      : 'Подключить профиль'}</Button
                            >
                            <Button
                                class="settings__submit"
                                onclick={() => {
                                    phrase = ''
                                    mode = 'choose'
                                    error = ''
                                }}
                                disabled={pending}>Отмена</Button
                            >
                        </div>
                    </fieldset>
                </form>
            {/if}
        {/if}
    </div>
</div>
