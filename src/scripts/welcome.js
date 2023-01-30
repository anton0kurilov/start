let welcomeBody = document.createElement('div'),
    welcomeHeader = '<h1 class="welcome__header">Hello, Friend</h1>'
welcomeBody.className = 'welcome'
welcomeBody.innerHTML = welcomeHeader
document.querySelector('body').appendChild(welcomeBody)

window.setTimeout(() => {
    welcomeBody.style.opacity = '0'
}, 3000)
welcomeBody.addEventListener('transitionend', () => welcomeBody.remove())
