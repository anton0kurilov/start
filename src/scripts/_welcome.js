// create a Welcome block and push it to the page
let welcomeBody = document.createElement('div'),
    welcomeHeader = '<h1 class="welcome__header">Hello, Friend</h1>'
welcomeBody.className = 'welcome'
welcomeBody.innerHTML = welcomeHeader
document.querySelector('body').appendChild(welcomeBody)

// hide the Welcome block after 3s
window.setTimeout(() => {
    welcomeBody.style.opacity = '0'
}, 3000)
welcomeBody.addEventListener('transitionend', () => welcomeBody.remove())
