// Make columns header clickable for scrolling to the top of feeds
window.setTimeout(() => {
    const columnHeaderElement = document.querySelectorAll(
        '.body__column-header-container'
    )
    for (let i = 0; i < columnHeaderElement.length; i++) {
        columnHeaderElement[i].addEventListener('click', function () {
            this.parentElement.scrollTo({top: 0, behavior: 'smooth'})
        })
    }
}, 3000)
