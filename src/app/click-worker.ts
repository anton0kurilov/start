import {buildClickFeatures, trainClickModel} from '../scripts/click-model.js'

type TrainingRow = {
    snapshot: Record<string, unknown>
    context: Record<string, unknown>
    outcome: number
    embedding?: number[]
}
export type ClickTrainingRequest = {
    id: number
    a1: TrainingRow[]
    b: TrainingRow[]
}
export type ClickModel = ReturnType<typeof trainClickModel>
export type ClickTrainingResponse = {
    id: number
    a1?: ClickModel | null
    b?: ClickModel | null
    error?: string
}

const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent<ClickTrainingRequest>) => void
    postMessage: (response: ClickTrainingResponse) => void
}

scope.onmessage = ({data}) => {
    try {
        const train = (rows: TrainingRow[]) => {
            const positive = rows.filter((row) => row.outcome === 1).length
            if (positive < 5 || rows.length - positive < 5) return null
            return trainClickModel(
                rows.map((row) => ({
                    features: buildClickFeatures(
                        row.snapshot,
                        row.context,
                        row.embedding,
                    ),
                    outcome: row.outcome,
                })),
            )
        }
        scope.postMessage({id: data.id, a1: train(data.a1), b: train(data.b)})
    } catch {
        scope.postMessage({id: data.id, error: 'Training failed'})
    }
}
