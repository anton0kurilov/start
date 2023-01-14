const moment = require('moment'),
    parser = require('rss-parser')

let data = {
    TheVerge: {
        rss: 'https://www.theverge.com/rss/index.xml',
        icon: 'https://www.theverge.com/favicon.ico',
    },
    MacRumors: {
        rss: 'https://feeds.macrumors.com/MacRumors-All',
        icon: 'https://macrumors.com/favicon.ico',
    },
    NinetoFiveGoogle: {
        rss: 'https://9to5google.com/feed/',
        icon: 'https://9to5google.com/favicon.ico',
    },
    TechMeme: {
        rss: 'https://www.techmeme.com/feed.xml',
        icon: 'https://www.techmeme.com/favicon.ico',
    },
    TechCrunch: {
        rss: 'https://techcrunch.com/feed/',
        icon: 'https://techcrunch.com/favicon.ico',
    },
    HackerNews: {
        rss: 'https://hnrss.org/frontpage',
        icon: 'https://news.ycombinator.com/favicon.ico',
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
            document.querySelector('.body').style.gridTemplateColumns =
                'repeat(' + Object.keys(data).length + ', 1fr)'
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
        let errorElement = document.createElement('div')
        errorElement.className = 'error'
        errorElement.innerHTML = err.name + ': ' + err.message
        document.querySelector('.body').appendChild(errorElement)
    }
})()
