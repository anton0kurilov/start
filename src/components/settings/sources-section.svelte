<script lang="ts">
    import {onMount, tick} from 'svelte'
    import type {Folder} from '../../app/types'
    import type {AppController} from '../../app/controller'
    import {folderDrag} from '../../app/folder-drag'
    import {getHostname, formatCountLabel} from '../../scripts/utils.js'
    import Button from '../ui/button.svelte'
    import IconButton from '../ui/icon-button.svelte'
    import TextField from '../ui/text-field.svelte'
    import FeedComposer from './feed-composer.svelte'
    let {folders, controller}: {folders: Folder[]; controller: AppController} =
        $props()
    let expanded = $state<string[]>([])
    let order = $state<string[]>([])
    let creating = $state(false),
        folderName = $state(''),
        adding = $state<string | null>(null),
        pending = $state(false)
    let edit = $state<{
        folderId: string
        feedId?: string
        name: string
        url: string
    } | null>(null)
    let editError = $state(''),
        status = $state(''),
        statusError = $state(false)
    let list: HTMLElement
    let root: HTMLElement
    let drag: ReturnType<typeof folderDrag> | undefined
    const displayed = $derived(
        order.length === folders.length &&
            order.every((id) => folders.some((f) => f.id === id))
            ? order.map((id) => folders.find((f) => f.id === id)!)
            : folders,
    )
    $effect(() => {
        const ids = folders.map((f) => f.id)
        if (
            order.length &&
            (order.length !== ids.length ||
                order.some((id) => !ids.includes(id)))
        )
            order = []
    })
    onMount(() => {
        drag = folderDrag(list, {
            getOrder: () => displayed.map((f) => f.id),
            setOrder: (ids) => (order = ids),
            commit: async (ids) => (await controller.reorder(ids)).ok,
            announce: (message, error = false) => {
                status = message
                statusError = error
            },
        })
        return () => drag?.destroy()
    })
    export function cancelEditing() {
        edit = null
        editError = ''
        drag?.cancel()
    }
    export function resetDrafts() {
        cancelEditing()
        creating = false
        folderName = ''
        adding = null
        expanded = []
        order = []
    }
    export async function beginCreate() {
        creating = true
        await focus('[name="folderName"]')
    }
    async function focus(selector: string) {
        await tick()
        const input = root.querySelector<HTMLInputElement>(selector)
        input?.focus()
        input?.select?.()
    }
    function toggle(id: string) {
        expanded = expanded.includes(id)
            ? expanded.filter((k) => k !== id)
            : [...expanded, id]
    }
    async function create(event: SubmitEvent) {
        event.preventDefault()
        if (!folderName.trim()) return
        const id = await controller.createFolder(folderName)
        if (!id) return
        folderName = ''
        creating = false
        await focus(`[data-folder-id="${id}"] .settings__folder-toggle`)
    }
    function beginEdit(folder: Folder, feedId?: string) {
        const feed = folder.feeds.find((feed) => feed.id === feedId)
        edit = {
            folderId: folder.id,
            feedId,
            name: feed?.name || folder.name,
            url: feed?.url || '',
        }
        editError = ''
        void focus('[data-editor-name]')
    }
    async function save() {
        if (!edit?.name.trim()) return
        const result = await (edit.feedId
            ? controller.updateFeed({
                  folderId: edit.folderId,
                  feedId: edit.feedId,
                  name: edit.name,
                  url: edit.url,
              })
            : controller.updateFolder(edit.folderId, edit.name))
        if (result.ok) {
            edit = null
            editError = ''
        } else
            editError =
                ('error' in result &&
                    typeof result.error === 'string' &&
                    result.error) ||
                'Не удалось сохранить изменения.'
    }
    async function closeComposer() {
        const id = adding
        adding = null
        await tick()
        root.querySelector<HTMLButtonElement>(
            `[data-folder-id="${id}"] [data-add-feed]`,
        )?.focus()
    }
    async function keyboard(event: KeyboardEvent, id: string) {
        if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !['ArrowUp', 'ArrowDown'].includes(event.key)
        )
            return
        event.preventDefault()
        const ids = displayed.map((f) => f.id),
            i = ids.indexOf(id),
            j = i + (event.key === 'ArrowUp' ? -1 : 1)
        if (j < 0 || j >= ids.length) return
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        const result = await controller.reorder(ids)
        if (result.ok) {
            order = ids
            status = `Колонка: позиция ${j + 1} из ${ids.length}. Порядок сохранён.`
        } else {
            status = 'Не удалось сохранить порядок колонок. Попробуйте ещё раз.'
            statusError = true
        }
        await tick()
        const handle = root.querySelector<HTMLButtonElement>(
            `[data-folder-id="${id}"] [data-action="reorder-folder"]`,
        )
        handle?.focus({preventScroll: true})
        handle?.scrollIntoView({block: 'nearest'})
    }
</script>

<div class="settings__section-shell" bind:this={root}>
    <div class="settings__actions-row">
        <Button
            variant="primary"
            class="settings__submit settings__create-column"
            data-action="toggle-folder-form"
            aria-expanded={creating}
            aria-controls="settings-folder-form"
            onclick={() => {
                creating = !creating
                if (creating) void focus('[name="folderName"]')
            }}>Новая колонка</Button
        >
    </div>
    {#if creating}
        <div
            class="settings__card settings__block settings__folder-composer"
            id="settings-folder-form"
        >
            <div class="settings__card-head">
                <h4 class="settings__subtitle">Новая колонка</h4>
                <p class="settings__note">
                    Отдельная колонка помогает развести темы и источники.
                </p>
            </div>
            <form class="form settings__form" onsubmit={create}>
                <TextField
                    label="Название колонки"
                    name="folderName"
                    bind:value={folderName}
                    placeholder="Например, Дизайн"
                    required
                />
                <div class="settings__actions-row">
                    <Button
                        type="submit"
                        variant="primary"
                        class="settings__submit">Создать колонку</Button
                    ><Button
                        class="settings__submit"
                        onclick={() => {
                            creating = false
                            folderName = ''
                            void focus('[data-action="toggle-folder-form"]')
                        }}>Отмена</Button
                    >
                </div>
            </form>
        </div>
    {/if}
    <p
        class="settings__reorder-status"
        class:settings__reorder-status--error={statusError}
        role="status"
    >
        {status}
    </p>
    <div class="settings__list" data-folders bind:this={list}>
        {#each displayed as folder (folder.id)}
            <div class="settings__folder" data-folder-id={folder.id}>
                <div
                    class="settings__folder-header"
                    class:settings__folder-header--editing={edit?.folderId ===
                        folder.id && !edit.feedId}
                >
                    {#if edit?.folderId === folder.id && !edit.feedId}
                        <form
                            class="settings__folder-editor"
                            onsubmit={(event) => {
                                event.preventDefault()
                                save()
                            }}
                        >
                            <input
                                class="control"
                                aria-label="Название колонки"
                                data-editor-name
                                required
                                bind:value={edit.name}
                            />
                            <div class="settings__folder-meta">
                                {formatCountLabel(folder.feeds.length, [
                                    'подписка',
                                    'подписки',
                                    'подписок',
                                ])}
                            </div>
                            <div class="settings__folder-actions">
                                <Button
                                    variant="primary"
                                    class="settings__folder-btn"
                                    type="submit">Сохранить</Button
                                ><Button
                                    class="settings__folder-btn"
                                    onclick={() => (edit = null)}>Отмена</Button
                                >
                            </div>
                        </form>
                    {:else}
                        <IconButton
                            class="settings__icon-btn settings__folder-drag-handle"
                            icon="drag"
                            label={`Переместить колонку «${folder.name}»`}
                            title="Перетащите колонку или используйте стрелки вверх и вниз"
                            aria-description="Перетащите колонку или используйте стрелки вверх и вниз"
                            data-action="reorder-folder"
                            disabled={folders.length < 2}
                            onkeydown={(event) => keyboard(event, folder.id)}
                        />
                        <Button
                            class="settings__folder-toggle"
                            aria-expanded={expanded.includes(folder.id)}
                            aria-controls={`settings-folder-content-${folder.id}`}
                            onclick={() => toggle(folder.id)}
                            ><span class="settings__folder-info"
                                ><span
                                    class="settings__folder-name"
                                    title={folder.name}>{folder.name}</span
                                ><span class="settings__folder-meta"
                                    >{formatCountLabel(folder.feeds.length, [
                                        'подписка',
                                        'подписки',
                                        'подписок',
                                    ])}</span
                                ></span
                            ></Button
                        >
                        <div class="settings__folder-actions">
                            <IconButton
                                class="settings__icon-btn"
                                icon="edit"
                                label="Изменить колонку"
                                onclick={() => beginEdit(folder)}
                            /><IconButton
                                class="settings__icon-btn"
                                variant="danger"
                                icon="delete"
                                label="Удалить колонку"
                                onclick={() =>
                                    controller.removeFolder(folder.id)}
                            />
                        </div>
                    {/if}
                </div>
                <div
                    class="settings__folder-content"
                    id={`settings-folder-content-${folder.id}`}
                    hidden={!expanded.includes(folder.id)}
                >
                    <div class="settings__feeds">
                        {#each folder.feeds as feed (feed.id)}
                            <div
                                class="settings__feed"
                                class:settings__feed--editing={edit?.feedId ===
                                    feed.id}
                                data-feed-id={feed.id}
                            >
                                {#if edit?.feedId === feed.id}
                                    <form
                                        class="settings__feed-editor"
                                        onsubmit={(event) => {
                                            event.preventDefault()
                                            save()
                                        }}
                                    >
                                        <div class="settings__feed-fields">
                                            <input
                                                class="control"
                                                aria-label="Название подписки"
                                                data-editor-name
                                                bind:value={edit.name}
                                                required
                                            /><input
                                                class="control"
                                                aria-label="URL-адрес потока"
                                                inputmode="url"
                                                bind:value={edit.url}
                                                aria-invalid={!!editError}
                                                aria-describedby="feed-edit-error"
                                                required
                                            />
                                        </div>
                                        <p
                                            id="feed-edit-error"
                                            class="settings__form-error"
                                            role="alert"
                                            hidden={!editError}
                                        >
                                            {editError}
                                        </p>
                                        <div class="settings__feed-actions">
                                            <Button
                                                variant="primary"
                                                class="settings__feed-btn"
                                                type="submit">Сохранить</Button
                                            ><Button
                                                class="settings__feed-btn"
                                                onclick={() => (edit = null)}
                                                >Отмена</Button
                                            >
                                        </div>
                                    </form>
                                {:else}
                                    <div class="settings__feed-info">
                                        <div
                                            class="settings__feed-name"
                                            title={feed.name}
                                        >
                                            {feed.name}
                                        </div>
                                        <div
                                            class="settings__feed-url"
                                            title={feed.url}
                                        >
                                            {getHostname(feed.url)}
                                        </div>
                                    </div>
                                    <div class="settings__feed-actions">
                                        <IconButton
                                            class="settings__icon-btn settings__icon-btn--favorite"
                                            icon="star"
                                            label={feed.isFavorite
                                                ? 'Убрать подписку из избранного'
                                                : 'Добавить подписку в избранное'}
                                            aria-pressed={feed.isFavorite}
                                            onclick={() =>
                                                controller.favorite(
                                                    folder.id,
                                                    feed.id,
                                                    !feed.isFavorite,
                                                )}
                                        /><IconButton
                                            class="settings__icon-btn"
                                            icon="edit"
                                            label="Изменить подписку"
                                            onclick={() =>
                                                beginEdit(folder, feed.id)}
                                        /><IconButton
                                            class="settings__icon-btn"
                                            variant="danger"
                                            icon="delete"
                                            label="Удалить подписку"
                                            onclick={() =>
                                                controller.removeFeed(
                                                    folder.id,
                                                    feed.id,
                                                )}
                                        />
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                    {#if adding === folder.id}<FeedComposer
                            {folder}
                            {controller}
                            oncancel={closeComposer}
                            onpending={(value) => (pending = value)}
                        />
                    {:else}<div class="settings__actions-row">
                            <Button
                                class="settings__submit"
                                data-add-feed
                                disabled={pending}
                                aria-expanded="false"
                                aria-controls="settings-feed-form"
                                onclick={() => (adding = folder.id)}
                                >{folder.feeds.length
                                    ? 'Добавить подписку'
                                    : 'Добавить первую подписку'}</Button
                            >
                        </div>{/if}
                </div>
            </div>
        {/each}
    </div>
    {#if !folders.length}<div class="settings__empty">
            Пока нет колонок. Создайте первую и добавьте подписки.
        </div>{/if}
</div>
