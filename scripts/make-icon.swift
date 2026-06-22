import AppKit

// Renders the IDEalize app icon as a 1024×1024 PNG.
// Usage: swift scripts/make-icon.swift <output.png>

let size: CGFloat = 1024
let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/idealize-icon.png"

func srgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: r/255, green: g/255, blue: b/255, alpha: a)
}

let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()

let rect = NSRect(x: 0, y: 0, width: size, height: size)
let radius = size * 0.2237 // macOS squircle-ish corner
let clip = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
clip.addClip()

// Background gradient (matches IDEalize Dark theme).
let grad = NSGradient(colors: [srgb(22, 27, 34), srgb(13, 17, 23)])!
grad.draw(in: rect, angle: -90)

// Traffic-light dots (reads as a terminal window).
func dot(_ cx: CGFloat, _ color: NSColor) {
    let r = size * 0.030
    let cy = size * 0.815
    color.setFill()
    NSBezierPath(ovalIn: NSRect(x: cx - r, y: cy - r, width: r*2, height: r*2)).fill()
}
dot(size*0.155, srgb(255, 95, 86))
dot(size*0.255, srgb(255, 189, 46))
dot(size*0.355, srgb(39, 201, 63))

// ">_" prompt drawn as vector shapes, grouped and centered.
let stroke = size * 0.075
let chevW = size * 0.16          // chevron horizontal reach
let chevH = size * 0.30          // chevron vertical span
let gap = size * 0.055
let curW = size * 0.22           // cursor underscore width
let curH = stroke

// Center the whole group horizontally.
let groupW = chevW + gap + curW + stroke
let leftX = (size - groupW)/2 + stroke/2
let midY = size * 0.45           // vertical center of the prompt
let topY = midY + chevH/2
let botY = midY - chevH/2
let tipX = leftX + chevW

// Chevron (blue).
let chev = NSBezierPath()
chev.move(to: NSPoint(x: leftX, y: topY))
chev.line(to: NSPoint(x: tipX, y: midY))
chev.line(to: NSPoint(x: leftX, y: botY))
chev.lineWidth = stroke
chev.lineCapStyle = .round
chev.lineJoinStyle = .round
srgb(88, 166, 255).setStroke()
chev.stroke()

// Cursor underscore (green), aligned to the chevron's lower point.
srgb(86, 211, 135).setFill()
let curX = tipX + gap
NSBezierPath(roundedRect: NSRect(x: curX, y: botY - curH/2, width: curW, height: curH),
             xRadius: curH/2, yRadius: curH/2).fill()

img.unlockFocus()

guard let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("failed to render icon\n".utf8)); exit(1)
}
try! png.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath)")
