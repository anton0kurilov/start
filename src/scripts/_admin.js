const bodyElement = document.querySelector('body')
const moment = require('moment'),
    adminElement = document.createElement('div'),
    dateObj = new Date(),
    dateMinutes = String(dateObj.getMinutes()).padStart(2, '0'),
    dateHours = String(dateObj.getHours()).padStart(2, '0'),
    refreshButtonContent =
        '<a id="refreshButton" title="Refresh this app" class="admin__refresh">↻</a>'
adminElement.className = 'admin'
adminElement.innerHTML = `Last updated at <b>${dateHours}:${dateMinutes}</b> ${refreshButtonContent}`
bodyElement.appendChild(adminElement)

// Update the page
const refreshButtonElement = document.querySelector('#refreshButton')
refreshButtonElement.addEventListener('click', () => {
    location.reload()
})
