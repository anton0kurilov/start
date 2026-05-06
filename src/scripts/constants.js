export const STORAGE_KEY = 'start:rss:v1'
export const CORS_PROXY = 'https://cors.kurilov.workers.dev/?url='
export const FETCH_TIMEOUT = 12000
export const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000
export const MAX_ITEMS_PER_FOLDER = 40
export const MAX_VISITED_ITEMS = 4000
export const MAX_CLICKED_ITEMS = 4000
export const MODEL_STATE_SCHEMA_VERSION = 1
export const MODEL_VERSION = 1
export const MAX_MODEL_EVENTS = 6000
export const MAX_MODEL_FEATURES = 2400
export const MAX_MODEL_FEATURES_PER_ITEM = 28
export const MODEL_IMPRESSION_NEGATIVE_DELAY_MS = 18 * 60 * 60 * 1000
export const MODEL_RECENCY_HALF_LIFE_MS = 45 * 24 * 60 * 60 * 1000
export const MODEL_RANKER_EPOCHS = 18
export const MODEL_RANKER_LEARNING_RATE = 0.1
export const MODEL_RANKER_REGULARIZATION = 0.0008
export const MODEL_CALIBRATION_EPOCHS = 80
export const MODEL_CALIBRATION_LEARNING_RATE = 0.08
export const MODEL_MAX_ABS_WEIGHT = 6
export const MODEL_POSITIVE_WEIGHT = 1.8
export const MODEL_EXPLICIT_NEGATIVE_WEIGHT = 2.4
export const MODEL_WEAK_NEGATIVE_WEIGHT = 0.35
export const MODEL_MIN_SAMPLES_FOR_PERCENT = 36
export const MODEL_MIN_SAMPLES_FOR_APPROXIMATE_PERCENT = 120
export const MODEL_MIN_HOLDOUT_SAMPLES = 10
export const MODEL_MAX_ACCEPTABLE_ECE = 0.08
export const MODEL_MAX_APPROXIMATE_ECE = 0.2
export const MODEL_SYNC_INTERVAL_MS = 60000
export const DEFAULT_SETTINGS = {
    autoMarkReadOnScroll: false,
    autoRefreshFeeds: false,
    showFavoritesColumn: false,
}
