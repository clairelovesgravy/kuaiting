import AppKit
import Foundation

let output = CommandLine.arguments[1]
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill()
let tile = NSBezierPath(roundedRect: NSRect(x: 60, y: 60, width: 904, height: 904), xRadius: 205, yRadius: 205)
let gradient = NSGradient(starting: NSColor(srgbRed: 0.19, green: 0.66, blue: 0.49, alpha: 1),
    ending: NSColor(srgbRed: 0.06, green: 0.46, blue: 0.34, alpha: 1))!
gradient.draw(in: tile, angle: -55)
NSColor(srgbRed: 0.94, green: 1, blue: 0.96, alpha: 1).setFill()
for (index, height) in [180.0, 360.0, 270.0, 140.0].enumerated() {
    NSBezierPath(roundedRect: NSRect(x: 282 + Double(index) * 130, y: (1024-height)/2, width: 70, height: height), xRadius: 35, yRadius: 35).fill()
}
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
