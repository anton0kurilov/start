export function createId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function normalizeUrl(value) {
    if (!value) {
        return ''
    }
    const trimmed = value.trim()
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed
    }
    return `https://${trimmed}`
}

export function decodeHtmlEntities(value) {
    const input = String(value || '')
    if (!input || !input.includes('&') || typeof document === 'undefined') {
        return input
    }

    const decoder = document.createElement('textarea')
    let decoded = input
    for (let index = 0; index < 2; index += 1) {
        decoder.innerHTML = decoded
        const next = decoder.value
        if (next === decoded) {
            break
        }
        decoded = next
    }
    return decoded
}

export function getHostname(url) {
    try {
        return new URL(url).hostname.replace('www.', '')
    } catch (error) {
        return url
    }
}

export function formatRelativeTime(date) {
    if (!date || Number.isNaN(date.getTime())) {
        return 'без даты'
    }
    const now = Date.now()
    const diff = now - date.getTime()
    const minutes = Math.round(diff / 60000)
    const rtf = new Intl.RelativeTimeFormat('ru', {numeric: 'auto'})
    if (Math.abs(minutes) < 60) {
        return rtf.format(-minutes, 'minute')
    }
    const hours = Math.round(diff / 3600000)
    if (Math.abs(hours) < 24) {
        return rtf.format(-hours, 'hour')
    }
    const days = Math.round(diff / 86400000)
    if (Math.abs(days) < 7) {
        return rtf.format(-days, 'day')
    }
    const weeks = Math.round(diff / 604800000)
    if (Math.abs(weeks) < 5) {
        return rtf.format(-weeks, 'week')
    }
    const months = Math.round(diff / 2629800000)
    if (Math.abs(months) < 12) {
        return rtf.format(-months, 'month')
    }
    const years = Math.round(diff / 31557600000)
    return rtf.format(-years, 'year')
}

export function formatCountLabel(count, [one, few, many]) {
    const absolute = Math.abs(Number(count)) % 100
    const lastDigit = absolute % 10

    if (absolute > 10 && absolute < 20) {
        return `${count} ${many}`
    }
    if (lastDigit > 1 && lastDigit < 5) {
        return `${count} ${few}`
    }
    if (lastDigit === 1) {
        return `${count} ${one}`
    }
    return `${count} ${many}`
}
