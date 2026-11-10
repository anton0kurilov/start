<script lang="ts">
    import {onMount, getContext} from 'svelte'
    import type {ImpressionTracker} from '../app/impressions'
    import type {AppController} from '../app/controller'
    import type {Card} from '../app/types'
    import {
        formatRelativeTime,
        formatDateTime,
        normalizeHttpUrl,
    } from '../scripts/utils.js'
    import Icon from './ui/icon.svelte'
    let {
        card,
        controller,
        now,
    }: {card: Card; controller: AppController; now: number} = $props()
    let element: HTMLElement
    const href = $derived(normalizeHttpUrl(card.link))
    const label = $derived(card.usefulness.label)
    const textBadge = $derived(!label.includes('%') && label !== 'посетил')
    const time = $derived.by(() => {
        now
        return formatRelativeTime(card.date)
    })
    const fresh = $derived(
        !!card.date &&
            now - card.date.getTime() >= 0 &&
            now - card.date.getTime() <= 1800000,
    )
    function open(event: MouseEvent) {
        if (!href) event.preventDefault()
        else if (event.type !== 'auxclick' || event.button === 1)
            controller.open(card)
    }
    const impressions = getContext<ImpressionTracker>('impressions')
    onMount(() => (href ? impressions.observe(element, () => card) : undefined))
</script>

<article
    bind:this={element}
    class="feed__item"
    class:feed__item--favorite-feed={card.favorite}
    class:feed__item--visited={card.visited}
    class:feed__item--dismissed={card.dismissed}
    data-item-key={card.itemKey}
    data-card-key={card.cardKey}
>
    <a
        class="feed__item-link"
        href={href || '#'}
        target={href ? '_blank' : undefined}
        rel="noopener noreferrer"
        aria-disabled={!href || undefined}
        tabindex={href ? undefined : -1}
        data-feed-link="true"
        onclick={open}
        onauxclick={open}
    >
        <div class="feed__item-source">{card.source || 'Источник'}</div>
        <div class="feed__item-title">{card.title || 'Без заголовка'}</div>
    </a>
    <div class="feed__item-meta">
        <div
            class="feed__item-time"
            class:feed__item-time--fresh={fresh}
            title={formatDateTime(card.date)}
        >
            {time}
        </div>
        <div class="feed__item-meta-controls">
            <div class="feed__item-actions">
                <span
                    class={`feed__item-utility feed__item-utility--${card.usefulness.tone}`}
                    class:feed__item-utility--icon-only={!textBadge}
                    title={card.usefulness.title}
                    aria-label={card.usefulness.title}
                >
                    {#if card.usefulness.tone !== 'learning'}<Icon
                            name={label === 'посетил' ? 'eye' : 'like'}
                            class="feed__item-utility-icon"
                        />{/if}
                    {#if textBadge}<span class="feed__item-utility-text"
                            >{label}</span
                        >{/if}
                </span>
                <button
                    type="button"
                    class="btn btn--ghost feed__item-dismiss"
                    class:feed__item-dismiss--active={card.dismissed}
                    aria-label="Показывать меньше похожих публикаций"
                    title="Показывать меньше похожих публикаций"
                    aria-pressed={card.dismissed}
                    data-action="dismiss-feed-item"
                    onclick={() => controller.dismiss(card)}
                    ><Icon
                        name="dislike"
                        class="feed__item-dismiss-icon"
                    /></button
                >
            </div>
        </div>
    </div>
</article>
