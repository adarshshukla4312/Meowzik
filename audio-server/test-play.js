import play from 'play-dl';

async function test() {
    try {
        const stream = await play.stream('dQw4w9WgXcQ');
        console.log("Stream URL:", stream.url);
        console.log("Stream Type:", stream.type);
    } catch (err) {
        console.error(err);
    }
}
test();
