// Entry point. With ?scene=... this page is an OBS overlay; without it, it is
// the studio where streamers preview scenes and copy their links.

import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import { readOptions } from './logic/options.ts';

const options = readOptions(window.location.search);

if (options.scene) {
  const scene = options.scene;
  void import('./overlay.ts').then((m) => m.bootOverlay(options, scene));
} else {
  void import('./studio/studio.ts').then((m) => m.bootStudio(options));
}
