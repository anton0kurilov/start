<script lang="ts">
    import {tick} from 'svelte'
    import type {AppController} from '../../app/controller'
    import Button from '../ui/button.svelte'
    let {
        controller,
        onimport,
    }: {controller: AppController; onimport: () => void} = $props()
    let fileInput: HTMLInputElement
    let exportError = $state('')
    let importError = $state('')
    let pending = $state<'export' | 'import' | null>(null)
    let status = $state('')
    async function download() {
        if (pending) return
        pending = 'export'
        exportError = ''
        try {
            const blob = new Blob(
                [JSON.stringify(await controller.exportBackup(), null, 2)],
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
        } catch {
            exportError =
                'Не удалось экспортировать сохранённую историю. Повторите попытку.'
        } finally {
            pending = null
        }
    }
    async function upload() {
        const file = fileInput.files?.[0]
        if (!file || pending) return
        if (!confirm('Импорт заменит текущие колонки и потоки. Продолжить?')) {
            fileInput.value = ''
            return
        }
        importError = ''
        pending = 'import'
        status = 'Чтение файла и импорт данных…'
        try {
            await tick()
            const result = await controller.importBackup(await file.text())
            if (result.ok) {
                onimport()
                status =
                    'Импорт завершён. Настройки можно закрыть — ленты обновляются в фоне.'
            } else {
                status = ''
                importError = result.error || 'Не удалось импортировать данные.'
            }
        } catch {
            status = ''
            importError =
                'Не удалось прочитать или импортировать файл. Попробуйте ещё раз.'
        } finally {
            pending = null
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
                disabled={pending !== null}
                aria-busy={pending === 'export'}
                aria-describedby="export-error"
                onclick={download}
                >{pending === 'export'
                    ? 'Экспортируем…'
                    : 'Экспортировать в JSON'}</Button
            >
        </div>
    </div>
    <p
        id="export-error"
        class="settings__form-error"
        role="alert"
        hidden={!exportError}
    >
        {exportError}
    </p>
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
            disabled={pending !== null}
            accept="application/json,.json,text/json,text/plain"
            aria-label="JSON-файл для импорта"
            aria-describedby="import-status import-error"
        />
        <div class="settings__actions-row">
            <Button
                variant="primary"
                class="settings__submit"
                data-action="trigger-import-file"
                disabled={pending !== null}
                aria-busy={pending === 'import'}
                aria-describedby="import-status import-error"
                onclick={() => fileInput.click()}
                >{pending === 'import'
                    ? 'Импортируем…'
                    : 'Импортировать JSON'}</Button
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
    </div>
    <p
        id="import-error"
        class="settings__form-error"
        role="alert"
        hidden={!importError}
    >
        {importError}
    </p>
</div>
