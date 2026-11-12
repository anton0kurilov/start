<script lang="ts">
    import Button from './ui/button.svelte'
    import Icon from './ui/icon.svelte'
    let {oncreatecolumn}: {oncreatecolumn: () => void} = $props()
</script>

<div class="onboarding">
    <div class="onboarding__content">
        <h1 class="onboarding__title">Ваша лента. Ваши источники.</h1>
        <p class="onboarding__lead">
            Соберите любимые сайты в одном месте.<br />
            Новые публикации появятся в колонках.
        </p>
        <ul class="onboarding__basics">
            <li class="onboarding__basic">
                <Icon name="columns" class="onboarding__icon" />
                <div>
                    <h2 class="onboarding__subtitle">Разделите по темам</h2>
                    <p class="onboarding__description">
                        Создайте колонки для работы, увлечений и всего, что
                        интересно.
                    </p>
                </div>
            </li>
            <li class="onboarding__basic">
                <Icon name="rss" class="onboarding__icon" />
                <div>
                    <h2 class="onboarding__subtitle">Добавьте потоки</h2>
                    <p class="onboarding__description">
                        Поток — это RSS/Atom-лента сайта. Публикации из него
                        попадут в выбранную колонку.
                    </p>
                </div>
            </li>
            <li class="onboarding__basic">
                <Icon name="recommended" class="onboarding__icon" />
                <div>
                    <h2 class="onboarding__subtitle">
                        Читайте, а лента подстроится
                    </h2>
                    <p class="onboarding__description">
                        Открывайте интересное, отмечайте неинтересное. Колонку
                        рекомендаций можно включить в настройках.
                    </p>
                </div>
            </li>
        </ul>
        <Button
            variant="primary"
            class="onboarding__start"
            onclick={oncreatecolumn}
            >Создать первую колонку<Icon
                name="forward"
                class="onboarding__start-icon"
            /></Button
        >
        <p class="onboarding__privacy">
            Без регистрации. Подписки и история хранятся в этом браузере.
        </p>
    </div>
</div>
