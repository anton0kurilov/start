import {test, expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'

// Exercise the exact standalone storage module in native browser IndexedDB.
// The production bundle need not expose testing hooks or internal modules.
const moduleUrl = (async () => {
    const source = await readFile(
        new URL('../../src/app/prediction-storage.ts', import.meta.url),
        'utf8',
    )
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
        },
    })
    return `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
})()

test('prediction storage commits atomic updates across connections and survives reopening', async ({
    page,
}) => {
    await page.goto('/')
    const result = await page.evaluate(
        async (url) => {
            const {createPredictionStorage} = await import(url)
            const dbName = `prediction-storage-test-${crypto.randomUUID()}`
            const first = createPredictionStorage({dbName})
            const second = createPredictionStorage({dbName})
            const profiles = await Promise.all([
                first.getProfileId(),
                second.getProfileId(),
            ])
            await Promise.all(
                Array.from({length: 20}, (_, index) =>
                    (index % 2 ? first : second).updateObservation(
                        'post',
                        (row) => ({
                            itemKey: 'post',
                            count: (row?.count || 0) + 1,
                        }),
                    ),
                ),
            )
            first.close()
            second.close()
            const reopened = createPredictionStorage({dbName})
            const observations = await reopened.listObservations()
            const profile = await reopened.getProfileId()
            reopened.close()
            return {profiles, observations, profile}
        },
        await moduleUrl,
    )
    expect(result.profiles[0]).toBe(result.profiles[1])
    expect(result.profile).toBe(result.profiles[0])
    expect(result.observations).toEqual([{itemKey: 'post', count: 20}])
})

test('prediction storage aborts invalid writes and imports without losing the archive', async ({
    page,
}) => {
    await page.goto('/')
    const result = await page.evaluate(
        async (url) => {
            const {createPredictionStorage} = await import(url)
            const storage = createPredictionStorage({
                dbName: `prediction-abort-${crypto.randomUUID()}`,
            })
            await storage.updateObservation('original', () => ({
                itemKey: 'original',
                count: 1,
            }))
            const failures = []
            for (const operation of [
                () =>
                    storage.updateObservation('original', () => {
                        throw new Error('reducer failed')
                    }),
                () =>
                    storage.updateObservation('original', () => ({
                        itemKey: 'different',
                    })),
                () =>
                    storage.updateObservation('original', () => ({
                        itemKey: 'original',
                        invalid: () => {},
                    })),
                () =>
                    storage.replaceObservations([
                        {itemKey: 'duplicate'},
                        {itemKey: 'duplicate'},
                    ]),
                () =>
                    storage.replaceObservations([
                        {itemKey: 'new', invalid: () => {}},
                    ]),
            ]) {
                try {
                    await operation()
                    failures.push(false)
                } catch {
                    failures.push(true)
                }
            }
            const observations = await storage.listObservations()
            await storage.replaceObservations(
                [{itemKey: 'imported', count: 2}],
                'imported-profile',
            )
            const imported = await storage.listObservations()
            const profile = await storage.getProfileId()
            storage.close()
            return {failures, observations, imported, profile}
        },
        await moduleUrl,
    )
    expect(result.failures).toEqual([true, true, true, true, true])
    expect(result.observations).toEqual([{itemKey: 'original', count: 1}])
    expect(result.imported).toEqual([{itemKey: 'imported', count: 2}])
    expect(result.profile).toBe('imported-profile')
})

test('prediction clear follows queued writes, resets profile and exposes unavailability', async ({
    page,
}) => {
    await page.goto('/')
    const result = await page.evaluate(
        async (url) => {
            const {createPredictionStorage} = await import(url)
            const storage = createPredictionStorage({
                dbName: `prediction-clear-${crypto.randomUUID()}`,
            })
            const oldProfile = await storage.getProfileId()
            const writing = storage.updateObservation('old', () => ({
                itemKey: 'old',
            }))
            const clearing = storage.clear()
            await Promise.all([writing, clearing])
            const observations = await storage.listObservations()
            const profile = await storage.getProfileId()
            storage.close()
            const failures = []
            for (const instance of [
                storage,
                createPredictionStorage({factory: null}),
            ]) {
                try {
                    await instance.listObservations()
                    failures.push(false)
                } catch {
                    failures.push(true)
                }
            }
            return {oldProfile, profile, observations, failures}
        },
        await moduleUrl,
    )
    expect(result.oldProfile).not.toBe(result.profile)
    expect(result.observations).toEqual([])
    expect(result.failures).toEqual([true, true])
})
