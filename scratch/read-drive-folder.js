const folderUrl = "https://drive.google.com/drive/folders/1-FA_cAatT4QjeWmGdZNH92n-_19pDhm8oBwCfaa7hquckP5g77nqdEW9BikNgpN__34eVsD_?usp=sharing";

async function run() {
  console.log('Fetching Google Drive folder page...');
  const res = await fetch(folderUrl);
  const text = await res.text();
  console.log('Length of response HTML:', text.length);
  
  // Find any drive file IDs or image names
  const matches = [...text.matchAll(/drive\.google\.com\/file\/d\/([-\w]{25,})/g)];
  console.log('Found file links count:', matches.length);
  const ids = Array.from(new Set(matches.map(m => m[1])));
  console.log('Unique file IDs found:', ids);

  // Search for names or titles
  const titleMatch = text.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) {
    console.log('Folder title:', titleMatch[1]);
  }
}

run().catch(console.error);
