const DRAG_THRESHOLD = 5
const SCROLL_EDGE = 48

export function createSettingsFolderInteractions({
    list,
    scrollContainer,
    status,
    onOrderChange,
}) {
    let drag = null
    let scrollFrame = null

    function getRows() {
        return Array.from(list?.children || []).filter(
            (row) => row.dataset.folderId,
        )
    }

    function announce(message, isError = false) {
        if (status) {
            status.textContent = message
            status.classList.toggle('settings__reorder-status--error', isError)
        }
    }

    function restoreOrder(rows) {
        rows.forEach((row) => {
            if (row.parentElement === list) {
                list.appendChild(row)
            }
        })
    }

    function saveOrder(originalRows, row) {
        const rows = getRows()
        if (rows.every((item, index) => item === originalRows[index])) {
            return
        }
        if (!onOrderChange(rows.map((item) => item.dataset.folderId))) {
            restoreOrder(originalRows)
            announce(
                'Не удалось сохранить порядок колонок. Попробуйте ещё раз.',
                true,
            )
            return
        }
        const name = row.querySelector('.settings__folder-name')?.textContent
        announce(
            `Колонка «${name}»: позиция ${rows.indexOf(row) + 1} из ${rows.length}. Порядок сохранён.`,
        )
    }

    function updatePosition() {
        if (!drag?.preview) {
            return
        }
        const top = drag.clientY - drag.offsetY
        drag.preview.style.transform = `translate3d(0, ${top}px, 0)`
        const rows = getRows()
        const nextRow = rows.find((row) => {
            if (row === drag.row) {
                return false
            }
            const rect = row.getBoundingClientRect()
            return drag.clientY < rect.top + rect.height / 2
        })
        const currentNextRow = rows[rows.indexOf(drag.row) + 1] || null
        if (currentNextRow !== (nextRow || null)) {
            list.insertBefore(drag.row, nextRow || null)
        }
    }

    function autoScroll() {
        if (!drag?.preview || !scrollContainer) {
            return
        }
        const rect = scrollContainer.getBoundingClientRect()
        let delta = 0
        if (drag.clientY < rect.top + SCROLL_EDGE) {
            delta = -Math.min(16, (rect.top + SCROLL_EDGE - drag.clientY) / 3)
        } else if (drag.clientY > rect.bottom - SCROLL_EDGE) {
            delta = Math.min(16, (drag.clientY - rect.bottom + SCROLL_EDGE) / 3)
        }
        if (delta) {
            scrollContainer.scrollTop += delta
            updatePosition()
        }
        scrollFrame = requestAnimationFrame(autoScroll)
    }

    function startDrag() {
        const rect = drag.row.getBoundingClientRect()
        const preview = drag.row.cloneNode(true)
        preview.removeAttribute('data-folder-id')
        preview.removeAttribute('id')
        preview.querySelectorAll('[id]').forEach((node) => {
            node.removeAttribute('id')
        })
        preview.classList.add('settings__folder--drag-preview')
        preview.setAttribute('aria-hidden', 'true')
        preview.inert = true
        preview.style.left = `${rect.left}px`
        preview.style.width = `${rect.width}px`
        list.appendChild(preview)
        drag.preview = preview
        drag.row.classList.add('settings__folder--dragging')
        drag.handle.setAttribute('aria-pressed', 'true')
        updatePosition()
        scrollFrame = requestAnimationFrame(autoScroll)
    }

    function finishDrag() {
        const finished = drag
        drag = null
        if (scrollFrame !== null) {
            cancelAnimationFrame(scrollFrame)
            scrollFrame = null
        }
        finished.preview?.remove()
        finished.row.classList.remove('settings__folder--dragging')
        finished.handle.setAttribute('aria-pressed', 'false')
        if (list.hasPointerCapture(finished.pointerId)) {
            list.releasePointerCapture(finished.pointerId)
        }
        return finished
    }

    function cancelDrag() {
        if (!drag) {
            return
        }
        const finished = finishDrag()
        restoreOrder(finished.originalRows)
        announce('Перемещение отменено.')
    }

    function handlePointerDown(event) {
        const handle = event.target.closest?.('[data-action="reorder-folder"]')
        if (
            !handle ||
            handle.disabled ||
            event.button !== 0 ||
            !event.isPrimary
        ) {
            return
        }
        const row = handle.closest('[data-folder-id]')
        if (row?.parentElement !== list || drag) {
            return
        }
        event.preventDefault()
        handle.focus({preventScroll: true})
        drag = {
            row,
            handle,
            originalRows: getRows(),
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            clientY: event.clientY,
            offsetY: event.clientY - row.getBoundingClientRect().top,
            preview: null,
        }
        list.setPointerCapture(event.pointerId)
    }

    function handlePointerMove(event) {
        if (!drag || event.pointerId !== drag.pointerId) {
            return
        }
        event.preventDefault()
        drag.clientY = event.clientY
        if (!drag.preview) {
            const distance = Math.hypot(
                event.clientX - drag.startX,
                event.clientY - drag.startY,
            )
            if (distance < DRAG_THRESHOLD) {
                return
            }
            startDrag()
        } else {
            updatePosition()
        }
    }

    function handlePointerUp(event) {
        if (!drag || event.pointerId !== drag.pointerId) {
            return
        }
        const finished = finishDrag()
        if (finished.preview) {
            saveOrder(finished.originalRows, finished.row)
        }
        finished.handle.focus({preventScroll: true})
    }

    function handlePointerCancel(event) {
        if (drag?.pointerId === event.pointerId) {
            cancelDrag()
        }
    }

    function handleKeyDown(event) {
        if (drag && event.key === 'Escape') {
            event.preventDefault()
            const handle = drag.handle
            cancelDrag()
            handle.focus({preventScroll: true})
            return
        }
        const handle = event.target.closest?.('[data-action="reorder-folder"]')
        if (
            drag ||
            !handle ||
            handle.disabled ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !['ArrowUp', 'ArrowDown'].includes(event.key)
        ) {
            return
        }
        event.preventDefault()
        const row = handle.closest('[data-folder-id]')
        const rows = getRows()
        const index = rows.indexOf(row)
        const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1)
        if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) {
            return
        }
        announce('')
        list.insertBefore(
            row,
            event.key === 'ArrowUp'
                ? rows[nextIndex]
                : rows[nextIndex + 1] || null,
        )
        saveOrder(rows, row)
        handle.focus({preventScroll: true})
        row.scrollIntoView({block: 'nearest'})
    }

    return {
        cancelDrag,
        handleKeyDown,
        handlePointerCancel,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
    }
}
