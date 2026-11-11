<script lang="ts">
    import {tick} from 'svelte'
    import type {AppController} from '../../app/controller'
    import Button from '../ui/button.svelte'
    let {
        controller,
        onimport,
    }: {controller: AppController; onimport: () => void} = $props()
    let fileInput: HTMLInputElement
    let error = $state('')
    let pending = $state(false)
    let status = $state('')
    function download() {
        const blob = new Blob(
            [JSON.stringify(controller.exportJson(), null, 2)],
            {type: 'application/json'},
        )
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        const date = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        link.download = `start-feeds-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}.json`
        link.click()
        URL.revokeObjectURL(url)
    }
    async function upload() {
        const file = fileInput.files?.[0]
        if (!file || pending) return
        if (!confirm('Импорт заменит текущие колонки и потоки. Продолжить?')) {
            fileInput.value = ''
            return
        }
        error = ''
        pending = true
        status = 'Чтение файла и импорт данных…'
        try {
            await tick()
            const result = controller.importJson(await file.text())
            if (result.ok) {
                onimport()
                status =
                    'Импорт завершён. Настройки можно закрыть — ленты обновляются в фоне.'
            } else {
                status = ''
                error = result.error || 'Не удалось импортировать данные.'
            }
        } catch {
            status = ''
            error =
                'Не удалось прочитать или импортировать файл. Попробуйте ещё раз.'
        } finally {
            pending = false
            fileInput.value = ''
        }
    }
</script>

<div class="settings__transfer-grid">
    <div class="settings__card settings__block settings__action-card">
        <div class="settings__card-head">
            <h4 class="settings__subtitle">Экспорт</h4>
            <p class="settings__note">
                Сохраняет колонки, подписки и локальные настройки в один файл.
            </p>
        </div>
        <div class="settings__actions-row">
            <Button
                variant="primary"
                class="settings__submit"
                data-action="export-json"
                onclick={download}>Экспортировать в JSON</Button
            >
        </div>
    </div>
    <div class="settings__card settings__block settings__action-card">
        <div class="settings__card-head">
            <h4 class="settings__subtitle">Импорт</h4>
            <p class="settings__note">
                Выберите подготовленный JSON-файл из этого приложения.
            </p>
        </div>
        <input
            class="form__file-input"
            type="file"
            bind:this={fileInput}
            onchange={upload}
            disabled={pending}
            accept="application/json,.json,text/json,text/plain"
            aria-label="JSON-файл для импорта"
            aria-describedby="import-status import-error"
        />
        <div class="settings__actions-row">
            <Button
                variant="primary"
                class="settings__submit"
                data-action="trigger-import-file"
                disabled={pending}
                aria-busy={pending}
                aria-describedby="import-status import-error"
                onclick={() => fileInput.click()}
                >{pending ? 'Импортируем…' : 'Импортировать JSON'}</Button
            >
        </div>
        <p
            id="import-status"
            class="settings__note"
            role="status"
            hidden={!status}
        >
            {status}
        </p>
        <p
            id="import-error"
            class="settings__form-error"
            role="alert"
            hidden={!error}
        >
            {error}
        </p>
    </div>
</div>
