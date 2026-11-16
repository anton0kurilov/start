<script lang="ts">
    import {onMount, onDestroy, setContext, tick} from 'svelte'
    import {createImpressionTracker} from '../app/impressions'
    import {createBoardPosition} from '../app/board-position'
    import type {AppController} from '../app/controller'
    import type {AppViewState} from '../app/types'
    import FeedColumn from './feed-column.svelte'
    import Onboarding from './onboarding.svelte'
    let {
        state,
        controller,
        oncreatecolumn,
    }: {
        state: AppViewState
        controller: AppController
        oncreatecolumn: () => void
    } = $props()
    const impressions = createImpressionTracker(
        (card) => controller.impression(card),
        (card, context) => controller.exposure(card, context),
    )
    setContext('impressions', impressions)
    onDestroy(() => impressions.dispose())
    let element: HTMLElement
    onMount(() => {
        const position = createBoardPosition(element)
        return controller.beforeUpdate(() => {
            if (position.capture()) void tick().then(position.restore)
        })
    })
</script>

<section
    class="columns"
    class:columns--empty={!state.folders.length}
    data-columns
    bind:this={element}
>
    {#if !state.folders.length}<Onboarding {oncreatecolumn} />
    {:else}{#each state.columns as column (column.key)}<FeedColumn
                {column}
                {controller}
                autoRead={state.settings.autoMarkReadOnScroll}
                now={state.now}
            />{/each}{/if}
</section>
