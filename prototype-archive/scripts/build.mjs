import { mkdir, copyFile, rm } from 'node:fs/promises';

const files = ['index.html', 'styles.css', 'status.css', 'app.js', 'icon.svg', 'manifest.webmanifest'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await Promise.all(files.map((file) => copyFile(file, `dist/${file}`)));
console.log(`Prepared ${files.length} app files in dist/`);
