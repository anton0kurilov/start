export const STORAGE_KEY = 'start:rss:v1'
export const CORS_PROXY = 'https://cors.kurilov.workers.dev/?url='
export const FETCH_TIMEOUT = 12000
export const MAX_ITEMS_PER_FOLDER = 40
export const MAX_VISITED_ITEMS = 4000
export const MAX_CLICKED_ITEMS = 4000
export const MAX_CLICK_MODEL_SOURCES = 160
export const MAX_CLICK_MODEL_SOURCE_HOSTS = 220
export const MAX_CLICK_MODEL_HOSTS = 200
export const MAX_CLICK_MODEL_TOKENS = 600
export const CLICK_MODEL_V2_DIMENSION = 512
export const CLICK_MODEL_V2_SCHEMA_VERSION = 2
export const MAX_CLICK_MODEL_V2_WEIGHTS = CLICK_MODEL_V2_DIMENSION
export const MAX_CLICK_MODEL_V2_PENDING_IMPRESSIONS = 800
export const MAX_CLICK_MODEL_V2_FEATURES_PER_ITEM = 16
export const MAX_CLICK_MODEL_V2_NEGATIVE_HISTORY = 6000
export const DEFAULT_SETTINGS = {
    autoMarkReadOnScroll: false,
    useClickModelV2: false,
}
