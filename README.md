# lilSVG

Free SVG viewer, editor, and converter. Paste SVG code to preview it live, recolor it (per color or all at once), set a transparent or solid background, and download it as SVG, PNG, JPG, or WebP. A free tool by [lilAgents](https://lilagents.com).

**Live version:** https://lilagents.com/tools/svg/

This is the standalone, open-source build, a self-contained Astro site. The canonical hosted version is folded natively into the lilAgents website.

## Features

- Live preview of pasted SVG over a transparent checkerboard
- Detects the colors an SVG actually uses and lets you remap each one, plus a recolor-everything option
- Transparent or solid background for both preview and raster export
- Export SVG, or rasterize to PNG / JPG / WebP at 1x, 2x, 4x, or a custom width
- Prettify or minify the markup, copy the SVG, a data URI, or a CSS `background-image`
- Sanitizes pasted markup (strips scripts, event handlers, and external references) before rendering

## Run locally

```
pnpm install
pnpm dev      # dev server
pnpm build    # production build -> dist/
```

## Tech

Astro + Tailwind CSS + vanilla JS. 100% client-side; no backend, no API keys.

## License

MIT. See [LICENSE](LICENSE). Made with love by lilAgents.
