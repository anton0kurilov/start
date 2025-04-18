const bodyElement = document.querySelector('body'),
    adminElement = document.createElement('div'),
    dateObj = new Date(),
    dateMinutes = String(dateObj.getMinutes()).padStart(2, '0'),
    dateHours = String(dateObj.getHours()).padStart(2, '0'),
    dateDay = String(dateObj.getDate()).padStart(2, '0'),
    dateMonth = String(dateObj.getMonth() + 1).padStart(2, '0'),
    dateYear = dateObj.getFullYear(),
    dateFull = `${dateDay}.${dateMonth}.${dateYear}`,
    refreshButtonContent =
        '<div class="admin__refresh" id="refreshButton" title="Refresh this app">' +
        '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#e3e3e3"><path d="M0 0h24v24H0z" fill="none"/><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>' +
        '</div>',
    lastUpdatedContent = `<div class="admin__update">Last updated at <span class="admin__update-time" title="${dateFull}">${dateHours}:${dateMinutes}</span></div>`
adminElement.className = 'admin'
adminElement.innerHTML = lastUpdatedContent + refreshButtonContent
bodyElement.appendChild(adminElement)

// Update the page
const refreshButtonElement = document.querySelector('#refreshButton')
refreshButtonElement.addEventListener('click', () => {
    location.reload()
})
