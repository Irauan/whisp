// Draws resources/icon.png and resources/icon.ico from resources/icon.webp.
// Run it with: npm run icons
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const folder = join(__dirname, '../resources')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

// The smallest icons show only the face, because the full picture becomes noise.
const FULL = { x: 0, y: 0, side: 1254 }
const FACE = { x: 300, y: 330, side: 660 }
const LARGEST_FACE_SIZE = 24

async function render(window, source, size) {
  const crop = size <= LARGEST_FACE_SIZE ? FACE : FULL
  const url = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image()
    image.src = ${JSON.stringify(source)}
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ${size}
    const context = canvas.getContext('2d')
    context.imageSmoothingQuality = 'high'
    context.beginPath()
    context.roundRect(0, 0, ${size}, ${size}, ${size * 0.22})
    context.clip()
    context.drawImage(image, ${crop.x}, ${crop.y}, ${crop.side}, ${crop.side}, 0, 0, ${size}, ${size})
    return canvas.toDataURL('image/png')
  })()`)
  return Buffer.from(url.split(',')[1], 'base64')
}

/** An ICO file is a header, one 16-byte entry per image, and then the PNG data. */
function toIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size % 256, entry)
    header.writeUInt8(size % 256, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({ show: false })
    await window.loadURL('data:text/html,')
    const image = readFileSync(join(folder, 'icon.webp')).toString('base64')
    const source = `data:image/webp;base64,${image}`
    const images = []
    for (const size of ICO_SIZES) images.push({ size, png: await render(window, source, size) })
    writeFileSync(join(folder, 'icon.ico'), toIco(images))
    writeFileSync(join(folder, 'icon.png'), await render(window, source, 512))
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
