const rp = require('request-promise')
const request = require('request')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')
const url = require('url')
const uuid = require('uuid')

const requestOptions = {
    resolveWithFullResponse: true,
    proxy: 'http://dev-proxy.oa.com:8080'
}

async function fetchIns(insId) {
    console.log(`************** 开始抓取 ${insId} **************`)
    const response = await rp.get(`https://www.instagram.com/${insId}`, requestOptions)
    if (response.statusCode !== 200) {
        console.error(`========= getHtml() statusCode: ${response.statusCode} ========`)
        return
    }
    const $ = cheerio.load(response.body)
    const script = $('body script').first().html().replace(/window/g, 'global')
    eval(script)
    const nodes = global._sharedData.entry_data.ProfilePage[0].user.media.nodes
    let end_cursor = global._sharedData.entry_data.ProfilePage[0].user.media.page_info.end_cursor
    const userId = global._sharedData.entry_data.ProfilePage[0].user.id
    const images = nodes.map(node => node.thumbnail_src)

    await downloadImage(images, insId)

    const $preload = $('link[rel="preload"]')
    if ($preload.length === 1) {
        const preload = $preload.first()
        const jsUrl = `https://www.instagram.com${preload.attr('href')}`
        const jsResponse = await rp.get(jsUrl, requestOptions)
        if (jsResponse.statusCode !== 200) {
            console.error(`========= getScript() statusCode: ${jsResponse.statusCode} ========`)
            return
        }
        const queryId = jsResponse.body.match(/queryId\:"(.+?)"/g)[1].replace(/(queryId\:")|"/g, '')

        await fetchImage({
            query_hash: queryId,
            variables: {
                id: userId,
                first: 12,
                after: end_cursor
            }
        }, insId)
    } else {
        console.error(`ERROR: $preload.length === ${$preload.length}`)
    }

}

async function downloadImage(images, insId) {
    for (let i = 0; i < images.length; i++) {
        const image = images[i]
        const info = path.parse(image)
        try {
            await new Promise((resolve, reject) => {
                request(image, {
                    proxy: requestOptions.proxy,
                    encoding: 'binary'
                }, function (error, response, body) {
                    fs.writeFile(path.join(__dirname, `images/${insId}`, info.base), body, 'binary', function (err) {
                        if (err) reject(err)
                        console.log(`${info.base} 抓取成功`)
                        resolve()
                    })
                })
            })
        } catch (err) {
            console.error(`${image} 抓取失败`)
        }
        await sleep(100)
    }
}

async function fetchImage(params, insId) {
    const apiURL = getApi(params)
    const response = await rp.get(apiURL, requestOptions)
    if (response.statusCode >= 300) {
        console.log(`============= fetchImage() statusCode: ${response.statusCode} ============`)
        await sleep(5000)
        await fetchImage(params, insId)
        return
    }
    const data = JSON.parse(response.body)
    const {
        page_info,
        edges
    } = data.data.user.edge_owner_to_timeline_media
    const {
        has_next_page,
        end_cursor
    } = page_info
    const images = edges.map(edge => {
        const {
            thumbnail_resources
        } = edge.node
        return thumbnail_resources[thumbnail_resources.length - 1].src
    })
    await downloadImage(images, insId)
    if (has_next_page) {
        params.variables.after = end_cursor
        await sleep(2000)
        await fetchImage(params, insId)
    } else {
        console.log(`************** 抓取完成 ${insId} **************\n`)
    }
}

/**
 * 获取ajax的url
 * @param {Object} params 
 * @param {String} params.query_hash
 * @param {String} params.variables
 */
function getApi(params) {
    params = {
        query_hash: params.query_hash,
        variables: JSON.stringify(params.variables)
    }
    const {
        URL
    } = require('url')

    const apiURL = new URL('https://www.instagram.com/graphql/query')
    for (const key in params) {
        if (params.hasOwnProperty(key)) {
            apiURL.searchParams.append(key, params[key])
        }
    }
    return apiURL.href
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function mkdir(path) {
    if (!fs.existsSync(path)){
        fs.mkdirSync(path);
    }
}

(function main() {
    const prompt = require('prompt')
    prompt.start()
    console.log('请输入要抓取用户的insId，多个用户用“;”隔开')
    prompt.get(['insIds'], async function (err, result) {
        mkdir(path.join(__dirname, `images`))
        const targets = result.insIds.split(';').map(insId => insId.trim())
        const insIdsStr = targets.map(target => `"${target}"`).join(', ')
        console.log(`等待抓取：${insIdsStr}`)
        for (let i = 0; i < targets.length; i++) {
            const insId = targets[i]
            mkdir(path.join(__dirname, `images/${insId}`))
            await fetchIns(insId)
        }
    })
})()