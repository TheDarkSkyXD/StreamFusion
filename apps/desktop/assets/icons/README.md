# StreamFusion Application Icons

This directory contains the application icons for different platforms.

## Required Icon Files

| File | Platform | Size | Format |
|------|----------|------|--------|
| `icon.ico` | Windows | Multi-size | ICO (256x256, 128x128, 64x64, 48x48, 32x32, 16x16) |
| `icon.icns` | macOS | Multi-size | ICNS (1024x1024 down to 16x16) |
| `icon.png` | Linux | 512x512 | PNG |
| `icon.svg` | Source | Scalable | SVG (optional, master source) |

## Icon Design Guidelines

The StreamFusion icon should represent:
- ⚡ Lightning/storm theme
- 🌩️ Cloud with lightning bolt
- 🎮 Streaming/entertainment vibe

### Color Palette
- Primary: `#6366f1` (Indigo)
- Secondary: `#8b5cf6` (Purple)
- Accent: `#06b6d4` (Cyan)
- Background: Dark gradient

## Generating Icons

### From PNG source (1024x1024):

**Windows (.ico)**:
Use a tool like ImageMagick or an online converter.

**macOS (.icns)**:
```bash
mkdir icon.iconset
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
```

## Placeholder

Until the final icons are created, the app will run without icons.
To create a temporary icon, use any 512x512 PNG and convert it using online tools.
