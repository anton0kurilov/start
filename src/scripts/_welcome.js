// create a Welcome block and push it to the page
const welcomeBody = document.createElement('div'),
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
    dateHours = String(dateObj.getHours()).padStart(2, '0'),
    dateMonth = dateObj.getMonth(),
    welcomeHeader = '<h1 class="welcome__header">Hello, Friend</h1>',
    welcomeTime = `<h3 class="welcome__time">${dateHours}:${dateMinutes} • ${
        monthsArr[dateMonth]
    }, ${dateObj.getDate()}</h3>`
welcomeBody.className = 'welcome'
welcomeBody.innerHTML = welcomeHeader + welcomeTime
document.querySelector('body').appendChild(welcomeBody)

// hide the Welcome block after 3s
window.setTimeout(() => {
    welcomeBody.style.opacity = '0'
}, 3000)
welcomeBody.addEventListener('transitionend', () => welcomeBody.remove())
