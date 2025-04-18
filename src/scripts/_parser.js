import sources from '../../public/assets/data/sources.json'
import {hideWelcome, showWelcome} from './_welcome'

const moment = require('moment'),
    parser = require('rss-parser'),
    parserObj = new parser(),
    appElement = document.querySelector('.app')

export let sourcesCount = Object.keys(sources).length
;(async () => {
    try {
        showWelcome()
        for (let i = 0; i < sourcesCount; i++) {
            // parse this RSS feed
            let feed = await parserObj.parseURL(
                'https://cors.kurilov.workers.dev/?url=' +
                    Object.values(sources)[i].rss
            )

            // create a feed column and set number of them
            appElement.style.gridTemplateColumns = `repeat(${sourcesCount}, 1fr)`
            let element = document.createElement('section')
            element.id = `col${i + 1}`
            element.className = 'app__column'

            // create a feed header with name and favicon
            let elementHeader = `<div class="app__column-header-container"><h3 class="app__column-header">${
                    Object.values(sources)[i].title
                }<a href="${
                    feed.link
                }" target="_blank" class="app__column-header-link"><svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 24 24" height="24px" viewBox="0 0 24 24" width="24px" fill="#e3e3e3"><rect fill="none" height="24" width="24"/><path d="M9,5v2h6.59L4,18.59L5.41,20L17,8.41V15h2V5H9z"/></svg></a></h3></div>`,
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
            appElement.appendChild(element)
        }
    } catch (err) {
        // create an error badge and push it to the page
        let errorElement = document.createElement('div'),
            errorCloseElement =
                '<div id="errClose" class="error-close"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#e3e3e3"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg></div>'
        errorElement.className = 'error'
        errorElement.innerHTML = `<div class="error-text">${err.name}: ${err.message}</div> ${errorCloseElement}`
        metaColorChanger('error')
        appElement.appendChild(errorElement)
        // close an error badge
        document
            .querySelector('#errClose')
            .addEventListener('click', function () {
                errorElement.remove()
                metaColorChanger()
            })
    }
    return hideWelcome()
})()

// Change meta-color for error badge
function metaColorChanger(status) {
    switch (status) {
        case 'error':
            document
                .querySelector('meta[name="theme-color"]')
                .setAttribute('content', '#f44336')
            break
        default:
            document
                .querySelector('meta[name="theme-color"]')
                .setAttribute('content', '#000')
            break
    }
}
