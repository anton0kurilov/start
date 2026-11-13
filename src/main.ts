import {mount, unmount} from 'svelte'
import {createRepository, type Repository} from './app/repository.ts'
import {createLocalDatabase} from './app/local-database.ts'
import {migrateLegacy} from './app/migration.ts'
import {createCloud} from './app/cloud.ts'
import {setStateStorage} from './scripts/storage.js'
import './styles/base.scss'

async function start() {
    const database = createLocalDatabase()
    await migrateLegacy(database)
    const active =
        (await database.getMetadata<string>('active-profile')) || 'guest'
    let repository = await createRepository(
        database,
        (await database.load(active)).profile ? active : 'guest',
    )
    setStateStorage({
        loadState: () => repository.state,
        saveState: () => true,
        clearState: () => true,
    })
    const [{default: App}, domain] = await Promise.all([
        import('./app.svelte'),
        import('./scripts/domain.js'),
    ])
    let app: ReturnType<typeof mount>
    const cloud = createCloud(database, async (next: Repository) => {
        if (app) await unmount(app)
        if (next !== repository) repository.close()
        repository = next
        domain.hydrateState(next.state)
        app = mount(App, {
            target: document.getElementById('app')!,
            props: {repository, cloud},
        })
    })
    app = mount(App, {
        target: document.getElementById('app')!,
        props: {repository, cloud},
    })
    void cloud.bootstrap(repository)
}
void start().catch(() => {
    const target = document.getElementById('app')!
    const message = document.createElement('p')
    message.setAttribute('role', 'alert')
    message.textContent =
        'Не удалось открыть локальное хранилище. Данные прежней версии сохранены. Проверьте свободное место и разрешение на хранение данных, затем перезагрузите страницу.'
    const retry = document.createElement('button')
    retry.className = 'btn'
    retry.textContent = 'Повторить'
    retry.onclick = () => location.reload()
    target.replaceChildren(message, retry)
})
