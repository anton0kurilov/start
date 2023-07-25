const bodyElement = document.querySelector('body'),
    adminElement = document.createElement('div'),
    dateObj = new Date(),
    dateMinutes = String(dateObj.getMinutes()).padStart(2, '0'),
    dateHours = String(dateObj.getHours()).padStart(2, '0'),
    refreshButtonContent =
        '<div class="admin__refresh" id="refreshButton" title="Refresh this app">' +
        '<span class="material-symbols-outlined">refresh</span>' +
        '</div>',
    lastUpdatedContent = `<div class="admin__lastupdatedtext">Last updated at <b>${dateHours}:${dateMinutes}</b></div>`
adminElement.className = 'admin'
adminElement.innerHTML = lastUpdatedContent + refreshButtonContent
bodyElement.appendChild(adminElement)

// Update the page
const refreshButtonElement = document.querySelector('#refreshButton')
refreshButtonElement.addEventListener('click', () => {
    location.reload()
})
