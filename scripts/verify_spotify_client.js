import https from 'node:https';

https.get('https://martindavies-code.github.io/deck-order/', (res) => {
  let html = '';
  res.on('data', chunk => { html += chunk; });
  res.on('end', () => {
    const match = html.match(/assets\/index-[^"]+\.js/);
    if (!match) {
      console.log('No js bundle found');
      return;
    }
    console.log('Found bundle:', match[0]);
    https.get('https://martindavies-code.github.io/deck-order/' + match[0], (res2) => {
      let js = '';
      res2.on('data', chunk => { js += chunk; });
      res2.on('end', () => {
        const hasId = js.includes('b43c7e5e5185453facd81041c4556ede');
        console.log('Spotify Client ID present in live bundle:', hasId);
      });
    });
  });
});
