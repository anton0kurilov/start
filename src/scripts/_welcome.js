// create a Welcome block and push it to the page

const welcomeBody = document.createElement('div')

export function showWelcome() {
    welcomeBody.className = 'welcome'
    welcomeBody.innerHTML = '<div class="welcome__loader"></div>'
    document.querySelector('body').appendChild(welcomeBody)
}

export function hideWelcome() {
    welcomeBody.style.opacity = '0'
    welcomeBody.addEventListener('transitionend', () => welcomeBody.remove())
}
