// Geometry only: Svelte owns cards and the new-items indicator.
export function createReadingPosition(
    column: HTMLElement,
    content: HTMLElement,
    notice: (visible: boolean) => void,
    mark: (keys: string[]) => void,
    autoRead: () => boolean,
) {
    let pending = new Set<string>()
    let previousHidden = new Set<string>()
    let previousTop = 0
    let suppressedUntil = 0
    let scrollingToTopUntil = 0
    let saved: {
        key: string
        offset: number
        top: number
        outer: number
        keys: Set<string>
    } | null = null
    const items = () =>
        Array.from(content.querySelectorAll<HTMLElement>('.feed__item'))
    const top = () =>
        Math.max(
            column.getBoundingClientRect().top,
            content.getBoundingClientRect().top,
        )
    const key = (el: HTMLElement) => el.dataset.cardKey || ''
    const scrollTop = () => column.scrollTop + content.scrollTop
    function baseline() {
        previousHidden = new Set(
            items()
                .filter((el) => el.getBoundingClientRect().bottom <= top())
                .map(key),
        )
        previousTop = scrollTop()
    }
    function updateNotice() {
        const cards = items()
        if (!scrollTop()) pending.clear()
        for (const k of pending) {
            const card = cards.find((el) => key(el) === k)
            if (
                !card ||
                card.classList.contains('feed__item--visited') ||
                card.getBoundingClientRect().bottom > top()
            )
                pending.delete(k)
        }
        notice(pending.size > 0)
    }
    function capture() {
        if (saved || performance.now() < scrollingToTopUntil) return
        const cards = items()
        const anchor = cards.find(
            (el) => el.getBoundingClientRect().bottom > top(),
        )
        saved = {
            key: anchor ? key(anchor) : '',
            offset: anchor ? anchor.getBoundingClientRect().top - top() : 0,
            top: content.scrollTop,
            outer: column.scrollTop,
            keys: new Set(cards.map(key)),
        }
    }
    function restore() {
        if (performance.now() < scrollingToTopUntil) {
            saved = null
            baseline()
            updateNotice()
            return
        }
        if (!saved) {
            baseline()
            return
        }
        const prior = saved
        saved = null
        suppressedUntil = performance.now() + 250
        const cards = items()
        const anchor = cards.find((el) => key(el) === prior.key)
        column.scrollTop = prior.outer
        content.scrollTop = prior.top
        if (anchor && prior.top + prior.outer > 0) {
            const scroller = prior.outer > prior.top ? column : content
            scroller.scrollTop +=
                anchor.getBoundingClientRect().top - top() - prior.offset
        }
        if (prior.top + prior.outer > 0)
            for (const card of cards)
                if (!prior.keys.has(key(card))) pending.add(key(card))
        baseline()
        updateNotice()
    }
    function scroll() {
        if (saved) return
        const hidden = items().filter(
            (el) => el.getBoundingClientRect().bottom <= top(),
        )
        const moved = scrollTop() > previousTop
        if (moved && autoRead() && performance.now() > suppressedUntil) {
            const keys = hidden
                .filter((el) => !previousHidden.has(key(el)))
                .map((el) => el.dataset.itemKey || '')
                .filter(Boolean)
            if (keys.length) mark([...new Set(keys)])
        }
        baseline()
        updateNotice()
    }
    function toTop() {
        suppressedUntil = performance.now() + 1500
        scrollingToTopUntil = suppressedUntil
        saved = null
        const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth'
        content.scrollTo({top: 0, behavior})
        column.scrollTo({top: 0, behavior})
        pending.clear()
        notice(false)
    }
    baseline()
    return {capture, restore, scroll, toTop, baseline}
}
