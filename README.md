# openshane.github.io

Personal GitHub Pages site for presenting IndustrialSim, industrial hardware simulation, and web interaction experiments.

## Structure

- `index.html` — homepage
- `projects/industrialsim.html` — IndustrialSim detail page
- `assets/styles.css` — shared warm paper visual system
- `assets/receipt.js` — interactive Three.js receipt
- `assets/receipt-collisions.js` — swept surface contacts for folded receipt layers
- `assets/home-effects.js` — finite homepage effects
- `tests/site.test.js` — zero-dependency static contract tests
- `tests/receipt.test.js` — deterministic receipt layout, physics, and lifecycle regression tests
- `tests/receipt-collisions.test.js` — surface contact and fast-drag collision regressions

Receipt grabbing is adapted from [Holocloth](https://github.com/dmitrykurash/holocloth); its MIT notice is retained in `assets/licenses/holocloth.txt`.

## Local preview

```bash
python -m http.server 8000
```

Open `http://localhost:8000/`.

## Test

```bash
npm test
```

## Deployment

The repository is deployed directly by GitHub Pages; no build step is required.
