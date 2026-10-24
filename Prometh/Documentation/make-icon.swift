import AppKit
import CoreText

let canvas: CGFloat = 1024
let margin: CGFloat = 196
let font = NSFont(name: "Futura-Bold", size: 1000)!
let ctFont = font as CTFont
var character = Array("P".utf16)[0]
var glyph = CGGlyph()
guard CTFontGetGlyphsForCharacters(ctFont, &character, &glyph, 1),
      let raw = CTFontCreatePathForGlyph(ctFont, glyph, nil) else {
    fputs("Could not load the Prometh monogram glyph\n", stderr)
    exit(1)
}
let box = raw.boundingBoxOfPath
let scale = min((canvas - margin * 2) / box.width, (canvas - margin * 2) / box.height)
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(canvas), pixelsHigh: Int(canvas), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
rep.size = NSSize(width: canvas, height: canvas)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
ctx.clear(CGRect(x: 0, y: 0, width: canvas, height: canvas))
NSColor(srgbRed: 0.955, green: 0.945, blue: 0.915, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 36, y: 36, width: 952, height: 952), xRadius: 220, yRadius: 220).fill()
ctx.setFillColor(NSColor(srgbRed: 0.145, green: 0.15, blue: 0.17, alpha: 1).cgColor)
ctx.translateBy(x: (canvas - box.width * scale) / 2 - box.minX * scale, y: (canvas - box.height * scale) / 2 - box.minY * scale)
ctx.scaleBy(x: scale, y: scale)
ctx.addPath(raw)
ctx.fillPath()
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
