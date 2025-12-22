# Vitamin Browser v0.4.0

## New Features
- **VITA Neon Effect** - The "Vita" logo on the start page now glows like a neon sign when poisoning is active
- **"Proceed Anyway" for Blocked Sites** - When a site is blocked due to excessive trackers, you can now choose to proceed anyway
- **Click VITA to Visit Website** - Clicking "Vita" on the start page takes you to vitaminbrowser.com

## Bug Fixes
- **Fixed Theme Switching** - Themes now apply instantly on the start page without needing a refresh
- **Fixed Website Display Issues** - Sites like YouTube and Amazon now display correctly with ad blocking enabled

## Installation Notes

### macOS
This is an unsigned build. To install:
1. Right-click the app and select "Open" to bypass Gatekeeper
2. Or run in Terminal: `xattr -cr /Applications/Vitamin.app`

### Windows
Windows builds may have compatibility issues - we're investigating. Try at your own risk.

### Linux
Install the .deb file with: `sudo dpkg -i vitamin-browser_0.4.0_amd64.deb` (or arm64)
