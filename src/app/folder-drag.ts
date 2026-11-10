export function folderDrag(
    list: HTMLElement,
    options: {
        getOrder: () => string[]
        setOrder: (ids: string[]) => void
        commit: (ids: string[]) => boolean
        announce: (message: string, error?: boolean) => void
    },
) {
    let drag: {
        id: string
        pointer: number
        startX: number
        startY: number
        y: number
        offset: number
        original: string[]
        row: HTMLElement
        handle: HTMLElement
        preview?: HTMLElement
    } | null = null
    let frame = 0
    let focusFrame = 0
    const rows = () =>
        Array.from(
            list.querySelectorAll<HTMLElement>(':scope > [data-folder-id]'),
        )
    function finish(cancel: boolean) {
        if (!drag) return
        const current = drag
        drag = null
        cancelAnimationFrame(frame)
        current.preview?.remove()
        current.row.classList.remove('settings__folder--dragging')
        current.handle.setAttribute('aria-pressed', 'false')
        if (list.hasPointerCapture(current.pointer))
            list.releasePointerCapture(current.pointer)
        const ids = options.getOrder()
        if (cancel) {
            options.setOrder(current.original)
            options.announce('Перемещение отменено.')
        } else if (ids.join('|') !== current.original.join('|')) {
            if (!options.commit(ids)) {
                options.setOrder(current.original)
                options.announce(
                    'Не удалось сохранить порядок колонок. Попробуйте ещё раз.',
                    true,
                )
            } else
                options.announce(
                    `Колонка перемещена: позиция ${ids.indexOf(current.id) + 1} из ${ids.length}. Порядок сохранён.`,
                )
        }
        cancelAnimationFrame(focusFrame)
        focusFrame = requestAnimationFrame(() =>
            current.handle.focus({preventScroll: true}),
        )
    }
    function position() {
        if (!drag?.preview) return
        drag.preview.style.transform = `translate3d(0, ${drag.y - drag.offset}px, 0)`
        const remaining = rows().filter(
            (row) => row.dataset.folderId !== drag?.id,
        )
        const index = remaining.findIndex((row) => {
            const r = row.getBoundingClientRect()
            return drag!.y < r.top + r.height / 2
        })
        const ids = remaining.map((row) => row.dataset.folderId!)
        ids.splice(index < 0 ? ids.length : index, 0, drag.id)
        if (ids.join('|') !== options.getOrder().join('|'))
            options.setOrder(ids)
    }
    function autoScroll() {
        if (!drag?.preview) return
        const scroller = list.closest<HTMLElement>('.settings__content')
        if (scroller) {
            const r = scroller.getBoundingClientRect()
            const delta =
                drag.y < r.top + 48
                    ? -Math.min(16, (r.top + 48 - drag.y) / 3)
                    : drag.y > r.bottom - 48
                      ? Math.min(16, (drag.y - r.bottom + 48) / 3)
                      : 0
            if (delta) {
                scroller.scrollTop += delta
                position()
            }
        }
        frame = requestAnimationFrame(autoScroll)
    }
    function down(event: PointerEvent) {
        const handle = (event.target as Element).closest<HTMLButtonElement>(
            '[data-action="reorder-folder"]',
        )
        const row = handle?.closest<HTMLElement>('[data-folder-id]')
        if (
            !handle ||
            handle.disabled ||
            !row ||
            event.button !== 0 ||
            !event.isPrimary ||
            drag
        )
            return
        event.preventDefault()
        handle.focus({preventScroll: true})
        drag = {
            id: row.dataset.folderId!,
            pointer: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            y: event.clientY,
            offset: event.clientY - row.getBoundingClientRect().top,
            original: [...options.getOrder()],
            row,
            handle,
        }
        list.setPointerCapture(event.pointerId)
    }
    function move(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointer) return
        event.preventDefault()
        drag.y = event.clientY
        if (
            !drag.preview &&
            Math.hypot(
                event.clientX - drag.startX,
                event.clientY - drag.startY,
            ) >= 5
        ) {
            const rect = drag.row.getBoundingClientRect()
            const preview = drag.row.cloneNode(true) as HTMLElement
            preview.removeAttribute('data-folder-id')
            preview.removeAttribute('id')
            preview
                .querySelectorAll('[id]')
                .forEach((el) => el.removeAttribute('id'))
            preview.classList.add('settings__folder--drag-preview')
            preview.inert = true
            preview.setAttribute('aria-hidden', 'true')
            preview.style.left = `${rect.left}px`
            preview.style.width = `${rect.width}px`
            list.parentElement!.append(preview)
            drag.preview = preview
            drag.row.classList.add('settings__folder--dragging')
            drag.handle.setAttribute('aria-pressed', 'true')
            frame = requestAnimationFrame(autoScroll)
        }
        position()
    }
    function up(event: PointerEvent) {
        if (event.pointerId === drag?.pointer) finish(false)
    }
    function cancel() {
        finish(true)
    }
    function key(event: KeyboardEvent) {
        if (drag && event.key === 'Escape') {
            event.preventDefault()
            cancel()
        }
    }
    list.addEventListener('pointerdown', down)
    list.addEventListener('lostpointercapture', cancel)
    window.addEventListener('pointermove', move, {passive: false})
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    document.addEventListener('keydown', key)
    return {
        cancel,
        destroy() {
            cancel()
            cancelAnimationFrame(focusFrame)
            list.removeEventListener('pointerdown', down)
            list.removeEventListener('lostpointercapture', cancel)
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', cancel)
            window.removeEventListener('blur', cancel)
            document.removeEventListener('keydown', key)
        },
    }
}
