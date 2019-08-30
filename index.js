var https = require('https');

exports.handler = async (event, context) => {
    console.log('START');
    
    if (!process.env.ELASTIC_HOST)
        return context.fail("environment variable ELASTIC_HOST required");
    
    if (!process.env.ELASTIC_INDEX)
        return context.fail("environment variable ELASTIC_INDEX required");
    
    if (!process.env.ELASTIC_TIMEOUT_MS || isNaN(process.env.ELASTIC_TIMEOUT_MS))
        return context.fail("environment variable ELASTIC_TIMEOUT_MS required");
        
    console.log(`The following environment variables will be used: ELASTIC_HOST=${process.env.ELASTIC_HOST}, ELASTIC_INDEX=${process.env.ELASTIC_INDEX}, ELASTIC_TIMEOUT_MS=${process.env.ELASTIC_TIMEOUT_MS}`);
    
    //console.debug(JSON.stringify(event));
    const promises = event.Records.map(r => makeRequest(r));
    console.log('Records in progress:', promises.length);
    return await Promise.all(promises);
};

function makeRequest(record)
{
    return new Promise((resolve, reject) => {
        
        console.info('Processing:', record.EventSubscriptionArn);
        
        if (record.Sns == null) {
            console.warn(record.EventSubscriptionArn, "Sns missing");
            return resolve("Sns missing");
        }
        
         if (record.Sns.Message == null) {
            console.warn(record.EventSubscriptionArn, "Sns.Message missing");
            return resolve("Sns.Message missing");
        }
        
        // faltten the message into an elastic friendly structure
        const message = transform(record.Sns.Message);

        const options = {
            hostname: process.env.ELASTIC_HOST,
            method: 'POST',
            path: `/${process.env.ELASTIC_INDEX}/_doc/`,
            headers: { 
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(message)
            }
        };

        const request = https.request(options, (response) => {
            console.debug(record.EventSubscriptionArn, 'executing');
            var responseBody = '';
            
            response.on('data', (chunk) => {
                responseBody += chunk;
            });
            
            response.on('end', () => {
                console.info(record.EventSubscriptionArn, 'Completed:', responseBody);
                resolve(response.statusCode);
            });
            
        });
        
        request.setTimeout(parseInt(process.env.ELASTIC_TIMEOUT_MS));
        
        request.on('timeout', (ex) => {
            console.error(record.EventSubscriptionArn, 'Timeout:', ex);
            reject(Error(ex));
        });
        
        request.on('error', (ex) => {
            console.error(record.EventSubscriptionArn, 'Error:', ex);
            reject(Error(ex));
        });
        
        request.end(message);

    });// Promise
}

/* Elastic makes use of property values:
 *  - Convert dictionaries to objects
 *  - Unwrap single-element arrays 
 */
function transform(message){
    var body = JSON.parse(message);

    if (body.mail)
    {
        if (body.mail.headers)
        {
            var newHeaders = {};
            for(var i = 0; i < body.mail.headers.length; i++)
                newHeaders[body.mail.headers[i].name] = body.mail.headers[i].value;

            body.mail.headers = newHeaders;
        }

        if (body.mail.commonHeaders)
            for(var h in body.mail.commonHeaders)
                body.mail.commonHeaders[h] = tryPopOutOfArray(body.mail.commonHeaders[h]);

        if (body.mail.tags)
            for(var t in body.mail.tags)
                body.mail.tags[t] = tryPopOutOfArray(body.mail.tags[t]);

        if (body.mail.destination)
            body.mail.destination = tryPopOutOfArray(body.mail.destination);

    }
    
    if (body.delivery && body.delivery.recipients)
        body.delivery.recipients = tryPopOutOfArray(body.delivery.recipients);

    return JSON.stringify(body);
}

function tryPopOutOfArray(arr)
{
    if (Array.isArray(arr) && arr.length == 1)
        return arr[0];

    return arr;
}