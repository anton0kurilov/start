export function createBoardPosition(board: HTMLElement) {
    let saved: {
        key: string | undefined
        left: number
        offset: number
    } | null = null
    const columns = () =>
        Array.from(board.querySelectorAll<HTMLElement>('.columns__item'))

    function capture() {
        if (saved) return false
        const left = board.getBoundingClientRect().left
        const anchor = columns().find(
            (column) => column.getBoundingClientRect().right > left,
        )
        if (!anchor) return false
        // Layout coordinates stay stable while native scrolling continues.
        saved = {
            key: anchor.dataset.columnKey,
            left: anchor.offsetLeft,
            offset: anchor.getBoundingClientRect().left - left,
        }
        return true
    }

    function restore() {
        if (!saved) return
        const prior = saved
        saved = null
        const anchor = columns().find(
            (column) => column.dataset.columnKey === prior.key,
        )
        if (!anchor || anchor.offsetLeft === prior.left) return
        // Scroll snapping may already have compensated for the layout change.
        const shift =
            anchor.getBoundingClientRect().left -
            board.getBoundingClientRect().left -
            prior.offset
        // Even assigning the current scrollLeft interrupts native momentum.
        if (shift) board.scrollLeft += shift
    }

    return {capture, restore}
}
