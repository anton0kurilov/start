<script lang="ts">
    import {onMount, tick} from 'svelte'
    import type {AppController} from '../app/controller'
    import type {AppViewState} from '../app/types'
    import FeedColumn from './feed-column.svelte'
    let {state, controller}: {state: AppViewState; controller: AppController} =
        $props()
    let element: HTMLElement
    onMount(() =>
        controller.beforeUpdate(() => {
            const left = element.getBoundingClientRect().left
            const cols = Array.from(
                element.querySelectorAll<HTMLElement>('.columns__item'),
            )
            const anchor = cols.find(
                (col) => col.getBoundingClientRect().right > left,
            )
            if (!anchor) return
            const key = anchor.dataset.columnKey
            const offset = anchor.getBoundingClientRect().left - left
            void tick().then(() => {
                const match = Array.from(
                    element.querySelectorAll<HTMLElement>('.columns__item'),
                ).find((col) => col.dataset.columnKey === key)
                if (match)
                    element.scrollLeft +=
                        match.getBoundingClientRect().left -
                        element.getBoundingClientRect().left -
                        offset
            })
        }),
    )
</script>

<section
    class="columns"
    class:columns--empty={!state.folders.length}
    data-columns
    bind:this={element}
>
    {#if !state.folders.length}<div class="columns__empty">
            Создайте первую колонку и подпишитесь на поток в настройках
        </div>
    {:else}{#each state.columns as column (column.key)}<FeedColumn
                {column}
                {controller}
                autoRead={state.settings.autoMarkReadOnScroll}
                now={state.now}
            />{/each}{/if}
</section>
