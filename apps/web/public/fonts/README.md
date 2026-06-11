# Hero headline fonts

Active font: **Epistolar** (`hero.ttf`)

## Your 3 DaFont trials

| Font | File | Switch to try |
|------|------|----------------|
| Epistolar | `epistolar.ttf` | `Copy-Item epistolar.ttf hero.ttf -Force` |
| Minecraft | `minecraft.ttf` | `Copy-Item minecraft.ttf hero.ttf -Force` |
| Sigokae | `sigokae.ttf` | `Copy-Item sigokae.ttf hero.ttf -Force` |

From `apps/web/public/fonts` in PowerShell, then hard refresh browser (`Ctrl+Shift+R`).

Also update `data-hero-font` on `<h1>` in `thread-hero.tsx` (`epistolar` | `minecraft` | `sigokae`) for CSS tweaks.
