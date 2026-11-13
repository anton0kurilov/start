<script lang="ts">
    import {onMount, untrack} from 'svelte'
    import {createAppController} from './app/controller'
    import FeedBoard from './components/feed-board.svelte'
    import FloatingControls from './components/floating-controls.svelte'
    import SettingsDialog from './components/settings/settings-dialog.svelte'
    import type {Repository} from './app/repository.ts'
    import type {CloudService} from './app/cloud.ts'
    let {repository, cloud}: {repository: Repository; cloud?: CloudService} =
        $props()
    const controller = untrack(() => createAppController({repository, cloud}))
    const appState = controller.state
    let settingsOpen = $state(false)
    let settingsMounted = $state(false)
    let createColumnOnOpen = $state(false)
    let settingsTrigger = $state<HTMLElement | null>(null)
    function openSettings(createColumn = false) {
        settingsTrigger = document.activeElement as HTMLElement
        createColumnOnOpen = createColumn
        settingsMounted = true
        settingsOpen = true
    }
    onMount(() => {
        let frame = 0
        const applySafeArea = () => {
            for (const side of ['Top', 'Right', 'Bottom', 'Left'])
                document.documentElement.style.setProperty(
                    `--safeArea${side}`,
                    `env(safe-area-inset-${side.toLowerCase()})`,
                )
        }
        const refreshSafeArea = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(applySafeArea)
        }
        const events = ['pageshow', 'orientationchange', 'resize'] as const
        applySafeArea()
        for (const event of events)
            window.addEventListener(event, refreshSafeArea)
        controller.start()
        return () => {
            controller.dispose()
            cancelAnimationFrame(frame)
            for (const event of events)
                window.removeEventListener(event, refreshSafeArea)
        }
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
        <FeedBoard
            state={$appState}
            {controller}
            oncreatecolumn={() => openSettings(true)}
        /><FloatingControls
            state={$appState}
            {controller}
            {settingsOpen}
            openSettings={() => openSettings()}
        />
    </div>
    {#if settingsMounted}
        <SettingsDialog
            state={$appState}
            {controller}
            {createColumnOnOpen}
            returnFocus={settingsTrigger}
            open={settingsOpen}
            onclose={() => (settingsOpen = false)}
        />
    {/if}
</main>
