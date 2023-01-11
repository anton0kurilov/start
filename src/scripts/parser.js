const moment = require('moment'),
    parser = require('rss-parser')

let data = {
    TheVerge: {
        rss: 'https://www.theverge.com/rss/index.xml',
        element: '#col1',
        icon: 'https://www.theverge.com/favicon.ico',
    },
    MacRumors: {
        rss: 'https://feeds.macrumors.com/MacRumors-All',
        element: '#col2',
        icon: 'https://macrumors.com/favicon.ico',
    },
    NinetoFiveGoogle: {
        rss: 'https://9to5google.com/feed/',
        element: '#col3',
        icon: 'https://9to5google.com/favicon.ico',
    },
    Vedomosti: {
        rss: 'https://www.vedomosti.ru/rss/rubric/technology.xml',
        element: '#col4',
        icon: 'https://www.vedomosti.ru/favicon.ico',
    },
    TechMeme: {
        rss: 'https://www.techmeme.com/feed.xml',
        element: '#col5',
        icon: 'https://www.techmeme.com/favicon.ico',
    },
}

let parserObj = new parser()

;(async () => {
    try {
        for (let i = 0; i < Object.keys(data).length; i++) {
            let feed = await parserObj.parseURL(
                'https://cors-anywhere.herokuapp.com/' +
                    Object.values(data)[i].rss
            )
            let element = document.createElement('section')
            element.id = 'col' + (i + 1)
            element.className = 'body__column'
            let elementHeader =
                    '<h3 class="body__column-header"><img src="' +
                    Object.values(data)[i].icon +
                    '" class="body__column-header-icon">' +
                    feed.title +
                    '</h3>',
                elementContent = ''
            feed.items.forEach((item) => {
                let itemDate = moment(item.pubDate).fromNow()
                elementContent +=
                    '<a href="' +
                    item.link +
                    '" target="_blank"><div class="content__item"><i class="content__item-time" title="' +
                    item.pubDate +
                    '">' +
                    itemDate +
                    '</i><h2 class="content__item-title">' +
                    item.title +
                    '</h2></div></a>'
            })
            element.innerHTML = elementHeader + elementContent
            document.querySelector('.body').appendChild(element)
        }
    } catch (err) {
        let errorBlock = document.querySelector('.error')
        errorBlock.style.display = 'block'
        errorBlock.innerHTML = err.name + ': ' + err.message
    }
})()
