<script lang="ts">
    import type {AppViewState} from '../app/types'
    import type {AppController} from '../app/controller'
    import {formatRelativeTime} from '../scripts/utils.js'
    import IconButton from './ui/icon-button.svelte'
    let {
        state,
        controller,
        openSettings,
    }: {
        state: AppViewState
        controller: AppController
        openSettings: () => void
    } = $props()
    const date = $derived(
        state.lastUpdated ? new Date(state.lastUpdated) : null,
    )
    const text = $derived.by(() => {
        state.now
        return state.refreshing
            ? 'в процессе'
            : date
              ? formatRelativeTime(date)
              : 'еще не обновлялось'
    })
</script>

<div class="fab" role="group" aria-label="Управление лентой">
    <div
        class="fab__toast"
        data-refresh-toast
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden={!state.refreshError}
    >
        <div class="fab__toast-text">{state.refreshError}</div>
        <IconButton
            class="fab__toast-close"
            icon="close"
            iconClass="fab__toast-close-icon"
            label="Скрыть сообщение об обновлении"
            onclick={() => controller.hideRefreshError()}
        />
    </div>
    <div class="fab__updated">
        Обновлено: <span
            data-last-updated
            data-last-updated-value={state.lastUpdated}
            title={state.refreshing ? undefined : date?.toLocaleString('ru-RU')}
            >{text}</span
        >
    </div>
    <div class="fab__actions">
        <IconButton
            class={`fab__icon-btn ${state.refreshing ? 'fab__icon-btn--refreshing' : ''}`}
            icon="refresh"
            iconClass="fab__icon"
            label="Обновить ленту"
            title="Обновить ленту (Ctrl/Cmd+R, F5)"
            data-action="refresh"
            disabled={state.refreshing}
            onclick={() => controller.refresh()}
        />
        <IconButton
            class="fab__icon-btn"
            variant="primary"
            icon="settings"
            iconClass="fab__icon"
            label="Настройки"
            aria-expanded="false"
            data-action="toggle-settings"
            onclick={openSettings}
        />
    </div>
</div>
