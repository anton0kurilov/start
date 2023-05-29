// create a Welcome block and push it to the page
const welcomeBody = document.createElement('div')
welcomeBody.className = 'welcome'
welcomeBody.innerHTML = '<h1 class="welcome__header">Hello, Friend</h1>'
document.querySelector('body').appendChild(welcomeBody)

// hide the Welcome block after 3s
window.setTimeout(() => {
    welcomeBody.style.opacity = '0'
}, 3000)
welcomeBody.addEventListener('transitionend', () => welcomeBody.remove())
