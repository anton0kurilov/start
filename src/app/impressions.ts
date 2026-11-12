import type {Card} from './types'
export function createImpressionTracker(
    onShow: (card: Card) => void,
    onExposure: (
        card: Card,
        context: Record<string, unknown>,
    ) => void = () => {},
) {
    let observer: IntersectionObserver | undefined
    const cards = new Map<HTMLElement, () => Card>()
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
    function cancel(element: HTMLElement) {
        clearTimeout(timers.get(element))
        timers.delete(element)
    }
    return {
        observe(element: HTMLElement, getCard: () => Card) {
            if (typeof IntersectionObserver === 'undefined') return () => {}
            if (!observer)
                observer = new IntersectionObserver(
                    (entries) => {
                        for (const entry of entries) {
                            const element = entry.target as HTMLElement
                            cancel(element)
                            if (
                                entry.isIntersecting &&
                                entry.intersectionRatio >= 0.6
                            ) {
                                const getCard = cards.get(element)
                                if (
                                    getCard &&
                                    !document.hidden &&
                                    !document.querySelector('.settings--open')
                                ) {
                                    const column =
                                        element.closest?.('[data-column-key]')
                                    const siblings =
                                        column?.querySelectorAll('.feed__item')
                                    onExposure(getCard(), {
                                        column:
                                            column?.getAttribute(
                                                'data-column-key',
                                            ) === 'recommended'
                                                ? 'recommended'
                                                : 'folder',
                                        position: siblings
                                            ? Array.from(siblings).indexOf(
                                                  element,
                                              )
                                            : null,
                                    })
                                }
                                timers.set(
                                    element,
                                    setTimeout(() => {
                                        timers.delete(element)
                                        const getCard = cards.get(element)
                                        if (
                                            getCard &&
                                            !document.hidden &&
                                            !document.querySelector(
                                                '.settings--open',
                                            )
                                        )
                                            onShow(getCard())
                                    }, 1200),
                                )
                            }
                        }
                    },
                    {threshold: [0, 0.6, 1]},
                )
            cards.set(element, getCard)
            observer.observe(element)
            return () => {
                observer?.unobserve(element)
                cancel(element)
                cards.delete(element)
            }
        },
        dispose() {
            observer?.disconnect()
            observer = undefined
            timers.forEach(clearTimeout)
            timers.clear()
            cards.clear()
        },
    }
}
export type ImpressionTracker = ReturnType<typeof createImpressionTracker>
