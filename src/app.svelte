<script lang="ts">
    import {onMount} from 'svelte'
    import {createAppController} from './app/controller'
    import FeedBoard from './components/feed-board.svelte'
    import FloatingControls from './components/floating-controls.svelte'
    import SettingsDialog from './components/settings/settings-dialog.svelte'
    const controller = createAppController()
    const appState = controller.state
    let settingsOpen = $state(false)
    onMount(() => {
        controller.start()
        return () => controller.dispose()
    })
    function key(event: KeyboardEvent) {
        if (
            event.defaultPrevented ||
            event.repeat ||
            event.altKey ||
            event.shiftKey
        )
            return
        const target = event.target as Element
        if (target.closest('input,textarea,select,[contenteditable]')) return
        const refresh =
            (event.key === 'F5' && !event.ctrlKey && !event.metaKey) ||
            (event.code === 'KeyR' && (event.ctrlKey || event.metaKey))
        if (refresh) {
            event.preventDefault()
            void controller.refresh()
        }
    }
</script>

<svelte:window onkeydown={key} />
<main class="app">
    <div class="app__content" inert={settingsOpen}>
        <FeedBoard state={$appState} {controller} /><FloatingControls
            state={$appState}
            {controller}
            openSettings={() => (settingsOpen = true)}
        />
    </div>
    <SettingsDialog
        state={$appState}
        {controller}
        open={settingsOpen}
        onclose={() => (settingsOpen = false)}
    />
</main>
