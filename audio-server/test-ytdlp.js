import youtubedl from 'youtube-dl-exec';

async function test() {
    try {
        const output = await youtubedl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            format: 'bestaudio'
        });
        
        console.log("Stream URL:", output.url);
    } catch (err) {
        console.error(err);
    }
}
test();
