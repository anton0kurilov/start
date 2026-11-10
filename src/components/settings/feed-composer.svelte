<script lang="ts">
    import {onMount, tick} from 'svelte'
    import type {AppController} from '../../app/controller'
    import type {Folder} from '../../app/types'
    import TextField from '../ui/text-field.svelte'
    import Button from '../ui/button.svelte'
    let {
        folder,
        controller,
        oncancel,
        onpending,
    }: {
        folder: Folder
        controller: AppController
        oncancel: () => void
        onpending: (pending: boolean) => void
    } = $props()
    let name = $state(''),
        url = $state(''),
        error = $state(''),
        pending = $state(false)
    let form: HTMLFormElement
    onMount(() => {
        form.querySelector<HTMLInputElement>('input')?.focus()
    })
    async function submit(event: SubmitEvent) {
        event.preventDefault()
        if (pending) return
        pending = true
        error = ''
        onpending(true)
        const result = await controller.addFeed({
            folderId: folder.id,
            name,
            url,
        })
        pending = false
        onpending(false)
        if (result.ok) oncancel()
        else {
            error = result.error || 'Не удалось добавить подписку.'
            await tick()
            form.querySelector<HTMLInputElement>('[name="feedUrl"]')?.focus()
        }
    }
</script>

<div
    class="settings__feed-composer settings__block"
    class:settings__block--disabled={pending}
    id="settings-feed-form"
>
    <div class="settings__card-head">
        <h4 class="settings__subtitle">Новая подписка</h4>
        <p class="settings__note">
            Подписка будет добавлена в колонку «{folder.name}».
        </p>
    </div>
    <form
        class="form settings__form"
        bind:this={form}
        onsubmit={submit}
        aria-busy={pending}
        oninput={() => (error = '')}
    >
        <fieldset disabled={pending} class="settings__fieldset">
            <TextField
                label="Название подписки"
                name="feedName"
                bind:value={name}
                placeholder="Например, Smashing Magazine"
                required
            />
            <TextField
                label="Прямая ссылка на RSS-поток"
                name="feedUrl"
                type="url"
                bind:value={url}
                placeholder="https://example.com/feed.xml"
                required
                aria-invalid={!!error}
                aria-describedby="feed-form-error"
            />
            <p
                id="feed-form-error"
                class="settings__form-error"
                role="alert"
                hidden={!error}
            >
                {error}
            </p>
            <div class="settings__actions-row">
                <Button variant="primary" class="settings__submit" type="submit"
                    >{pending ? 'Проверка…' : 'Подписаться'}</Button
                ><Button class="settings__submit" onclick={oncancel}
                    >Отмена</Button
                >
            </div>
        </fieldset>
    </form>
</div>
