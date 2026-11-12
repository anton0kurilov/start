<script lang="ts">
    import {onMount, tick} from 'svelte'
    import type {AppViewState} from '../../app/types'
    import type {AppController} from '../../app/controller'
    import Button from '../ui/button.svelte'
    import IconButton from '../ui/icon-button.svelte'
    import Icon from '../ui/icon.svelte'
    import CheckboxOption from '../ui/checkbox-option.svelte'
    import SourcesSection from './sources-section.svelte'
    import PublicationFilter from './publication-filter.svelte'
    import TransferSection from './transfer-section.svelte'
    let {
        state: view,
        controller,
        open,
        onclose,
        createColumnOnOpen = false,
        returnFocus = null,
    }: {
        state: AppViewState
        controller: AppController
        open: boolean
        onclose: () => void
        createColumnOnOpen?: boolean
        returnFocus?: HTMLElement | null
    } = $props()
    const sections = [
        {id: 'sources', label: 'Колонки и подписки'},
        {id: 'interface', label: 'Поведение интерфейса'},
        {id: 'filter', label: 'Фильтр публикаций'},
        {id: 'transfer', label: 'Импорт и экспорт'},
    ] as const
    type Section = (typeof sections)[number]['id']
    const semanticStatus = $derived.by(() => {
        switch (view.semantics?.status) {
            case 'ready':
                return {label: 'Включён', tone: 'on'}
            case 'checking':
                return {label: 'Проверка', tone: 'busy'}
            case 'downloading':
                return {label: 'Загружается', tone: 'busy'}
            case 'preparing':
                return {label: 'Подготовка', tone: 'busy'}
            case 'error':
                return {label: 'Ошибка', tone: 'error'}
            default:
                return {label: 'Выключен', tone: 'off'}
        }
    })
    let active = $state<Section>('sources'),
        sectionOpen = $state(false),
        mobile = $state(false)
    let panel: HTMLElement
    let content: HTMLElement
    let root: HTMLElement
    let sources: ReturnType<typeof SourcesSection> | undefined
    let filter: ReturnType<typeof PublicationFilter> | undefined
    const positions = new Map<Section, number>()
    let origin: HTMLElement | null = null
    let wasOpen = false
    onMount(() => {
        const query = matchMedia('(max-width:720px)')
        mobile = query.matches
        const resize = () => {
            mobile = query.matches
        }
        query.addEventListener('change', resize)
        return () => {
            query.removeEventListener('change', resize)
            document.body.classList.remove('settings-is-open')
        }
    })
    $effect(() => {
        if (open && !wasOpen) {
            wasOpen = true
            origin = returnFocus || (document.activeElement as HTMLElement)
            document.body.classList.add('settings-is-open')
            if (createColumnOnOpen) {
                active = 'sources'
                sectionOpen = true
            } else if (mobile) sectionOpen = false
            void tick().then(() => {
                if (createColumnOnOpen) {
                    content.scrollTop = 0
                    void sources?.beginCreate()
                } else
                    root.querySelector<HTMLButtonElement>(
                        mobile ? '[data-settings-section]' : '.settings__close',
                    )?.focus()
            })
        } else if (!open && wasOpen) {
            wasOpen = false
            document.body.classList.remove('settings-is-open')
            sources?.cancelEditing()
            const target = origin?.isConnected
                ? origin
                : document.querySelector<HTMLElement>(
                      '[data-action="toggle-settings"]',
                  )
            target?.focus()
        }
    })
    function remember() {
        if (content && (!mobile || sectionOpen))
            positions.set(active, content.scrollTop)
    }
    async function select(id: Section) {
        remember()
        active = id
        sectionOpen = true
        await tick()
        content.scrollTop = positions.get(id) || 0
        if (mobile)
            root.querySelector<HTMLButtonElement>('.settings__back')?.focus()
    }
    async function menu() {
        remember()
        sectionOpen = false
        await tick()
        root.querySelector<HTMLButtonElement>(
            `[data-settings-section="${active}"]`,
        )?.focus()
    }
    function close() {
        sources?.cancelEditing()
        onclose()
    }
    function key(event: KeyboardEvent) {
        if (!open || event.defaultPrevented) return
        if (event.key === 'Escape') {
            event.preventDefault()
            close()
            return
        }
        if (event.key !== 'Tab') return
        const targets = Array.from(
            panel.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
            ),
        ).filter((el) => el.getClientRects().length && !el.closest('[hidden]'))
        const first = targets[0],
            last = targets.at(-1)
        if (!first) {
            event.preventDefault()
            panel.focus()
        } else if (
            event.shiftKey &&
            (document.activeElement === first ||
                !panel.contains(document.activeElement))
        ) {
            event.preventDefault()
            last?.focus()
        } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
                !panel.contains(document.activeElement))
        ) {
            event.preventDefault()
            first.focus()
        }
    }
    function resetDrafts() {
        sources?.resetDrafts()
        filter?.resetDraft()
    }
    function reset() {
        if (confirm('Удалить все колонки, подписки и настройки приложения?')) {
            controller.reset()
            void tick().then(resetDrafts)
        }
    }
</script>

<svelte:window onkeydown={key} />
<div
    bind:this={root}
    class="settings"
    class:settings--open={open}
    class:settings--section-open={sectionOpen}
    aria-hidden={!open}
    inert={!open}
>
    <button
        class="settings__backdrop"
        tabindex="-1"
        aria-label="Закрыть настройки"
        onclick={close}
    ></button>
    <div
        class="settings__panel"
        bind:this={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Настройки ленты"
        tabindex="-1"
    >
        <div class="settings__header-shell">
            <div class="settings__header">
                <IconButton
                    class="settings__back"
                    icon="back"
                    iconClass="settings__nav-icon"
                    label="Назад к разделам настроек"
                    onclick={menu}
                />
                <div class="settings__heading">
                    <div class="settings__brand settings__brand--root">
                        Настройки
                    </div>
                    <div class="settings__brand settings__brand--section">
                        {sections.find((section) => section.id === active)
                            ?.label}
                    </div>
                </div>
                <IconButton
                    class="settings__close"
                    icon="close"
                    iconClass="settings__close-icon"
                    label="Закрыть"
                    onclick={close}
                />
            </div>
        </div>
        <div class="settings__body">
            <div class="settings__navigation">
                <nav class="settings__nav" aria-label="Разделы настроек">
                    {#each sections as section}<button
                            class="settings__nav-item"
                            class:settings__nav-item--active={active ===
                                section.id}
                            type="button"
                            id={`settings-section-${section.id}`}
                            aria-current={active === section.id
                                ? 'true'
                                : undefined}
                            aria-controls={`settings-panel-${section.id}`}
                            data-settings-section={section.id}
                            onclick={() => select(section.id)}
                            ><span
                                class="settings__nav-copy"
                                id={`settings-label-${section.id}`}
                                >{section.label}</span
                            ><Icon
                                name="back"
                                class="settings__nav-icon settings__forward-icon"
                            /></button
                        >{/each}
                </nav>
                <div class="settings__nav-footer">
                    <Button
                        variant="danger"
                        class="settings__reset"
                        data-action="reset"
                        onclick={reset}>Сбросить всё</Button
                    >
                </div>
            </div>
            <div class="settings__content" bind:this={content}>
                <section
                    class="settings__section settings__panel-section"
                    aria-labelledby="settings-label-sources"
                    id="settings-panel-sources"
                    hidden={active !== 'sources'}
                >
                    <SourcesSection
                        bind:this={sources}
                        folders={view.folders}
                        {controller}
                    />
                </section>
                <section
                    class="settings__section settings__panel-section"
                    aria-labelledby="settings-label-interface"
                    id="settings-panel-interface"
                    hidden={active !== 'interface'}
                >
                    <div class="settings__card settings__block">
                        <div class="settings__card-head">
                            <h4 class="settings__subtitle">
                                Чтение и обновление
                            </h4>
                        </div>
                        <div class="settings__options">
                            <CheckboxOption
                                name="autoMarkReadOnScroll"
                                label="Отмечать публикации как прочитанные при прокрутке"
                                checked={view.settings.autoMarkReadOnScroll}
                                onchange={(checked) =>
                                    controller.setting(
                                        'autoMarkReadOnScroll',
                                        checked,
                                    )}
                            />
                            <CheckboxOption
                                name="autoRefreshFeeds"
                                label="Автообновление каждые 5 минут"
                                checked={view.settings.autoRefreshFeeds}
                                onchange={(checked) =>
                                    controller.setting(
                                        'autoRefreshFeeds',
                                        checked,
                                    )}
                            />
                            <CheckboxOption
                                name="showRecommendedColumn"
                                label="Показывать колонку с рекомендуемыми публикациями"
                                checked={view.settings.showRecommendedColumn}
                                onchange={(checked) =>
                                    controller.setting(
                                        'showRecommendedColumn',
                                        checked,
                                    )}
                            />
                        </div>
                        {#if view.predictionHistory === 'error'}
                            <p class="settings__form-error" role="status">
                                История прогнозов не сохраняется. Проверьте
                                доступное место на устройстве и перезапустите
                                приложение.
                            </p>
                        {/if}
                    </div>
                    <div class="settings__card settings__block">
                        <div class="settings__card-head">
                            <div class="settings__prediction-heading">
                                <h4 class="settings__subtitle">
                                    Смысловой прогноз
                                </h4>
                                <span
                                    class={`settings__prediction-status settings__prediction-status--${semanticStatus.tone}`}
                                    role="status"
                                    aria-label={`Смысловой прогноз: ${semanticStatus.label}`}
                                    aria-atomic="true"
                                    data-semantic-status={view.semantics
                                        ?.status || 'off'}
                                    >{semanticStatus.label}</span
                                >
                            </div>
                            <p class="settings__note">
                                Публикации обрабатываются на устройстве. Новый
                                прогноз собирает данные для проверки точности.
                            </p>
                        </div>
                        {#if ['checking', 'downloading', 'preparing'].includes(view.semantics?.status || '')}
                            <p class="settings__note" role="status">
                                {view.semantics?.status === 'preparing'
                                    ? 'Подготовка прогноза…'
                                    : `Загрузка: ${Math.round(((view.semantics?.loaded || 0) / Math.max(1, view.semantics?.total || 1)) * 100)}%`}
                            </p>
                            <Button
                                onclick={() => controller.disableSemantics()}
                                >Отменить</Button
                            >
                        {:else if view.semantics?.status === 'ready'}
                            <p class="settings__note" role="status">
                                Локальная обработка включена. Оценки проверяются
                                на последующих показах публикаций.
                            </p>
                            <Button
                                onclick={() => controller.disableSemantics()}
                                >Выключить обработку</Button
                            >
                            <Button
                                onclick={() => controller.clearSemanticFiles()}
                                >Удалить загруженные данные</Button
                            >
                        {:else}
                            {#if view.semantics?.status === 'error'}
                                <p class="settings__form-error" role="status">
                                    Не удалось подготовить прогноз. Можно
                                    повторить загрузку.
                                </p>
                                <Button
                                    onclick={() =>
                                        controller.clearSemanticFiles()}
                                    >Удалить загруженные данные</Button
                                >
                            {/if}
                            <Button
                                onclick={() => controller.enableSemantics()}
                            >
                                Загрузить данные для прогноза · {Math.ceil(
                                    (view.semantics?.total || 0) / 1000000,
                                )} МБ
                            </Button>
                        {/if}
                    </div>
                </section>
                <section
                    class="settings__section settings__panel-section"
                    aria-labelledby="settings-label-filter"
                    id="settings-panel-filter"
                    hidden={active !== 'filter'}
                >
                    <PublicationFilter
                        bind:this={filter}
                        phrases={view.settings.blockedTitlePhrases}
                        {controller}
                    />
                </section>
                <section
                    class="settings__section settings__panel-section"
                    aria-labelledby="settings-label-transfer"
                    id="settings-panel-transfer"
                    hidden={active !== 'transfer'}
                >
                    <TransferSection
                        {controller}
                        onimport={() => void tick().then(resetDrafts)}
                    />
                </section>
            </div>
        </div>
    </div>
</div>
