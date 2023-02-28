// create a Welcome block and push it to the page
const welcomeBody = document.createElement('div'),
    monthsArr = [
        'января',
        'февраля',
        'марта',
        'апреля',
        'мая',
        'июня',
        'июля',
        'августа',
        'сентября',
        'октября',
        'ноября',
        'декабря',
    ],
    dateObj = new Date(),
    dateMinutes = String(dateObj.getMinutes()).padStart(2, '0'),
    dateMonth = dateObj.getMonth(),
    welcomeHeader = '<h1 class="welcome__header">Hello, Friend</h1>',
    welcomeTime = `<h3 class="welcome__time">Сейчас ${dateObj.getHours()}:${dateMinutes}, ${dateObj.getDate()} ${
        monthsArr[dateMonth]
    }</h3>`
welcomeBody.className = 'welcome'
welcomeBody.innerHTML = welcomeHeader + welcomeTime
document.querySelector('body').appendChild(welcomeBody)

// hide the Welcome block after 3s
window.setTimeout(() => {
    welcomeBody.style.opacity = '0'
}, 3000)
welcomeBody.addEventListener('transitionend', () => welcomeBody.remove())
