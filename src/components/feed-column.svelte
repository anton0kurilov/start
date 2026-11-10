<script lang="ts">
    import {onMount, tick} from 'svelte'
    import type {Column} from '../app/types'
    import type {AppController} from '../app/controller'
    import {createReadingPosition} from '../app/reading'
    import FeedCard from './feed-card.svelte'
    import IconButton from './ui/icon-button.svelte'
    import Button from './ui/button.svelte'
    let {
        column,
        controller,
        autoRead,
        now,
    }: {
        column: Column
        controller: AppController
        autoRead: boolean
        now: number
    } = $props()
    let element: HTMLElement
    let content: HTMLElement
    let reading: ReturnType<typeof createReadingPosition> | undefined
    let newItems = $state(false)
    let dismissedErrors = $state('')
    const errorsKey = $derived(
        column.errors.map((e) => `${e.id}:${e.name}:${e.message}`).join('|'),
    )
    const allRead = $derived(
        !!column.cards.length && column.cards.every((card) => card.visited),
    )
    $effect(() => {
        if (!errorsKey) dismissedErrors = ''
    })
    onMount(() => {
        reading = createReadingPosition(
            element,
            content,
            (visible) => (newItems = visible),
            (keys) => controller.read(keys),
            () => autoRead,
        )
        return controller.beforeUpdate(() => {
            reading?.capture()
            void tick().then(() => reading?.restore())
        })
    })
    $effect(() => {
        autoRead
        reading?.baseline()
    })
</script>

<article
    bind:this={element}
    class="columns__item"
    class:columns__item--recommended={column.recommended}
    data-column-key={column.key}
    onscroll={() => reading?.scroll()}
>
    <Button
        class="columns__new-items-notice"
        hidden={!newItems}
        aria-live="polite"
        aria-label="Новые материалы сверху. Перейти к началу колонки"
        data-action="scroll-new-items-to-top"
        onclick={() => reading?.toTop()}>↑ Новые материалы</Button
    >
    <div
        class="columns__content"
        bind:this={content}
        onscroll={() => reading?.scroll()}
    >
        <div class="columns__header">
            <h2 class="columns__header-text columns__title">
                <button
                    class="columns__top-button"
                    type="button"
                    aria-label={`К началу колонки «${column.title}»`}
                    onclick={() => reading?.toTop()}>{column.title}</button
                >
            </h2>
            <IconButton
                class="columns__mark-read"
                icon="read"
                iconClass="columns__mark-read-icon"
                disabled={!column.cards.length}
                data-action="mark-column-read"
                label={allRead
                    ? 'Отметить публикации как непрочитанные'
                    : 'Отметить публикации как прочитанные'}
                onclick={() =>
                    controller.read(
                        column.cards.map((c) => c.itemKey),
                        !allRead,
                    )}
            />
        </div>
        {#if !column.hasFeeds}
            <div class="columns__empty">
                {column.recommended
                    ? 'Добавьте потоки, чтобы собрать рекомендации.'
                    : 'Добавьте потоки в эту колонку.'}
            </div>
        {:else if !column.cards.length}
            <div
                class="columns__empty"
                class:columns__empty--error={column.errors.length > 0}
            >
                {column.errors.length
                    ? 'Не удалось загрузить публикации. Попробуйте обновить позже.'
                    : column.recommended
                      ? 'Рекомендуемых публикаций пока нет.'
                      : 'Здесь пока нет публикаций.'}
            </div>
        {:else}
            {#if errorsKey && errorsKey !== dismissedErrors}
                <div class="columns__notice">
                    <div class="columns__notice-text">
                        Ошибка обновления: {column.errors
                            .map((e) => e.name)
                            .join(', ')}
                    </div>
                    <IconButton
                        class="columns__notice-close"
                        icon="close"
                        iconClass="columns__notice-close-icon"
                        label="Скрыть ошибку обновления"
                        onclick={() => (dismissedErrors = errorsKey)}
                    />
                </div>
            {/if}
            {#each column.cards as card (card.cardKey)}<FeedCard
                    {card}
                    {controller}
                    {now}
                />{/each}
        {/if}
    </div>
</article>
