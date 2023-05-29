const bodyElement = document.querySelector('body')
const moment = require('moment'),
    adminElement = document.createElement('div'),
    monthsArr = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ],
    dateObj = new Date(),
    dateMinutes = String(dateObj.getMinutes()).padStart(2, '0'),
    dateHours = String(dateObj.getHours()).padStart(2, '0')
adminElement.className = 'admin'
adminElement.innerHTML = `Last updated at <b>${dateHours}:${dateMinutes}</b>`
bodyElement.appendChild(adminElement)

console.log(moment(dateObj).fromNow())
