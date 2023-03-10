import sources from '../../public/assets/data/sources.json'

const moment = require('moment'),
    parser = require('rss-parser'),
    parserObj = new parser(),
    bodyElement = document.querySelector('.body')

export let sourcesCount = Object.keys(sources).length
;(async () => {
    try {
        for (let i = 0; i < sourcesCount; i++) {
            // parse this RSS feed
            let feed = await parserObj.parseURL(
                'https://cors.kurilov.workers.dev/?uri' +
                    Object.values(sources)[i].rss
            )

            // create a feed column and set number of them
            bodyElement.style.gridTemplateColumns = `repeat(${sourcesCount}, 1fr)`
            let element = document.createElement('section')
            element.id = `col${i + 1}`
            element.className = 'body__column'

            // create a feed header with name and favicon
            let elementHeader = `<div class="body__column-header-container"><h3 class="body__column-header"><img src="${
                    Object.values(sources)[i].icon
                }" class="body__column-header-icon" alt="${feed.title}">${
                    feed.title
                }</h3></div>`,
                elementContent = ''

            // create feed blocks for every item in the RSS feed
            feed.items.forEach((item) => {
                let itemDate = moment(item.pubDate).fromNow(),
                    newPubBadge = ``

                // check if this post is new (published less than half an hour ago)
                if (
                    new Date().getTime() - new Date(item.pubDate).getTime() <
                    1800000
                ) {
                    newPubBadge = `🔥 `
                }

                // concate a string with all posts of this feed
                elementContent += `<a href="${item.link}" target="_blank"><div class="content__item"><i class="content__item-time" title="${item.pubDate}">${newPubBadge}${itemDate}</i><h2 class="content__item-title">${item.title}</h2></div></a>`
            })
            element.innerHTML = elementHeader + elementContent

            // push a feed item to the page
            bodyElement.appendChild(element)
        }
    } catch (err) {
        // create an error badge and push it to the page
        let errorElement = document.createElement('div'),
            errorCloseElement =
                '<div id="errClose" class="error-close">close</div>'
        errorElement.className = 'error'
        errorElement.innerHTML = `<div class="error-text">${err.name}: ${err.message}</div> ${errorCloseElement}`
        bodyElement.appendChild(errorElement)
        document
            .querySelector('#errClose')
            .addEventListener('click', function () {
                errorElement.remove()
            })
    }
})()
