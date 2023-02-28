// Make columns header clickable for scrolling to the top of feeds
// Thanks to https://stackoverflow.com/questions/16149431/make-function-wait-until-element-exists/53269990#53269990

const isElementLoaded = async (selector) => {
    while (document.querySelector(selector) === null) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return document.querySelector(selector)
}

isElementLoaded('#col7').then((selector) => {
    const columnHeaderElement = document.querySelectorAll(
        '.body__column-header-container'
    )
    for (let i = 0; i < columnHeaderElement.length; i++) {
        columnHeaderElement[i].addEventListener('click', function () {
            this.parentElement.scrollTo({top: 0, behavior: 'smooth'})
        })
    }
})
