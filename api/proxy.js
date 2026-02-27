const https = require('https');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).send('Missing url parameter');
    }

    const decodedUrl = decodeURIComponent(url);

    if (!decodedUrl.startsWith('http')) {
        return res.status(400).send('Invalid target URL');
    }

    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
        }
    };

    return new Promise((resolve, reject) => {
        https.get(decodedUrl, options, (proxyRes) => {
            let data = Buffer.from([]);
            proxyRes.on('data', (chunk) => {
                data = Buffer.concat([data, chunk]);
            });
            proxyRes.on('end', () => {
                res.status(proxyRes.statusCode);
                // Forward content-type if it exists
                if (proxyRes.headers['content-type']) {
                    res.setHeader('Content-Type', proxyRes.headers['content-type']);
                }
                res.send(data);
                resolve();
            });
        }).on('error', (e) => {
            console.error(e);
            res.status(500).send('Proxy Error: ' + e.message);
            resolve();
        });
    });
};
