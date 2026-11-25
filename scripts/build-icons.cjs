// Draws resources/icon.png and resources/icon.ico from resources/icon.svg.
// Run it with: npm run icons
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const folder = join(__dirname, '../resources')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function render(window, svg, size) {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const url = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image(${size}, ${size})
    image.src = ${JSON.stringify(source)}
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ${size}
    canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size})
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
    const svg = readFileSync(join(folder, 'icon.svg'), 'utf8')
    const images = []
    for (const size of ICO_SIZES) images.push({ size, png: await render(window, svg, size) })
    writeFileSync(join(folder, 'icon.ico'), toIco(images))
    writeFileSync(join(folder, 'icon.png'), await render(window, svg, 512))
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
