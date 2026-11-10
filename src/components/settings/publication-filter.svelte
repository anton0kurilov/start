<script lang="ts">
    import {onDestroy} from 'svelte'
    import type {AppController} from '../../app/controller'
    import TextareaField from '../ui/textarea-field.svelte'
    import Button from '../ui/button.svelte'
    let {phrases, controller}: {phrases: string[]; controller: AppController} =
        $props()
    let draft = $state(''),
        saved = $state(false)
    let lastSaved = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    $effect(() => {
        const value = phrases.join('\n')
        if (value !== lastSaved) {
            draft = value
            lastSaved = value
            saved = false
        }
    })
    export function resetDraft() {
        draft = phrases.join('\n')
        lastSaved = draft
        saved = false
        clearTimeout(timer)
    }
    function save(event: SubmitEvent) {
        event.preventDefault()
        draft = controller.filter(draft.split('\n')).join('\n')
        lastSaved = draft
        saved = true
        clearTimeout(timer)
        timer = setTimeout(() => (saved = false), 5000)
    }
    onDestroy(() => clearTimeout(timer))
</script>

<form
    class="settings__card settings__block"
    data-action="save-publication-filter"
    onsubmit={save}
    oninput={() => {
        saved = false
        clearTimeout(timer)
    }}
>
    <div class="settings__card-head">
        <h4 class="settings__subtitle">Скрывать по словам и фразам</h4>
        <p class="settings__note" id="publication-filter-help">
            По одному слову или фразе на строку. Публикация скрывается, если её
            заголовок содержит любую из строк. Регистр не учитывается.
        </p>
    </div>
    <TextareaField
        class="settings__filter-input"
        label="Слова и фразы"
        name="blockedTitlePhrases"
        rows={8}
        bind:value={draft}
        placeholder={'реклама\nспециальное предложение'}
        aria-describedby="publication-filter-help"
        spellcheck="false"
    />
    <div class="settings__actions-row">
        <Button
            variant="primary"
            class="settings__submit"
            type="submit"
            aria-live="polite">{saved ? 'Сохранено' : 'Сохранить'}</Button
        >
    </div>
</form>
