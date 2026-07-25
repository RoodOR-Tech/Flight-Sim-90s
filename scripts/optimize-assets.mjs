#!/usr/bin/env node
/**
 * Optional GLB optimization pipeline.
 *
 * The shipped game contains no GLB assets — every model is procedural. This script exists so that
 * if you *do* add one under `public/assets/`, there is a documented, non-destructive way to
 * optimize it before committing.
 *
 * Source files are never modified: optimized output is written to `public/assets-optimized/`,
 * mirroring the input directory structure.
 *
 * Usage:
 *   npm run assets:optimize            # optimize everything under public/assets
 *   npm run assets:optimize -- --dry   # report what would happen, write nothing
 *
 * Requires the optional dev dependencies:
 *   npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
 */

import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'public', 'assets');
const OUT_DIR = join(ROOT, 'public', 'assets-optimized');
const DRY_RUN = process.argv.includes('--dry');

async function findGlbFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findGlbFiles(full)));
    } else if (['.glb', '.gltf'].includes(extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function loadToolkit() {
  try {
    const [core, functions, extensions] = await Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/functions'),
      import('@gltf-transform/extensions'),
    ]);
    return { core, functions, extensions };
  } catch {
    return null;
  }
}

async function main() {
  const files = await findGlbFiles(SRC_DIR);

  if (files.length === 0) {
    console.log('[optimize-assets] No .glb/.gltf files found under public/assets/.');
    console.log('[optimize-assets] Nothing to do — this project ships entirely procedural models.');
    return;
  }

  console.log(`[optimize-assets] Found ${files.length} model file(s):`);
  for (const f of files) {
    const info = await stat(f);
    console.log(`  ${relative(ROOT, f)}  (${formatBytes(info.size)})`);
  }

  const toolkit = await loadToolkit();
  if (!toolkit) {
    console.error('\n[optimize-assets] The glTF-Transform toolkit is not installed.');
    console.error('[optimize-assets] Install it with:');
    console.error('    npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions');
    process.exitCode = 1;
    return;
  }

  const { NodeIO } = toolkit.core;
  const { dedup, prune, weld, resample, textureCompress, simplify, quantize } = toolkit.functions;
  const { ALL_EXTENSIONS } = toolkit.extensions;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  for (const file of files) {
    const rel = relative(SRC_DIR, file);
    const outPath = join(OUT_DIR, rel);
    console.log(`\n[optimize-assets] Processing ${rel}`);

    if (DRY_RUN) {
      console.log(`  (dry run) would write ${relative(ROOT, outPath)}`);
      continue;
    }

    try {
      const document = await io.read(file);

      // Transform order matters: deduplicate and prune first so later, costlier passes operate on
      // less data; weld before simplify so the mesh is topologically connected.
      const transforms = [
        dedup(),
        prune({ keepAttributes: false }),
        weld(),
        resample(),
      ];

      // Texture compression is only attempted when an encoder is available; a missing encoder
      // must not fail the whole run.
      try {
        transforms.push(textureCompress({ targetFormat: 'webp', resize: [2048, 2048] }));
      } catch {
        console.warn('  Texture compression unavailable; leaving textures as-is.');
      }

      // Mesh simplification needs MeshoptSimplifier; skip cleanly if absent.
      try {
        const { MeshoptSimplifier } = await import('meshoptimizer');
        transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: 0.75, error: 0.001 }));
      } catch {
        console.log('  meshoptimizer not installed; skipping mesh simplification.');
      }

      // Quantization is a safe, large win and needs no extra decoder beyond core glTF support.
      transforms.push(quantize());

      await document.transform(...transforms);

      await mkdir(dirname(outPath), { recursive: true });
      await io.write(outPath, document);

      const before = (await stat(file)).size;
      const after = (await stat(outPath)).size;
      const saved = ((1 - after / before) * 100).toFixed(1);
      console.log(`  ${formatBytes(before)} -> ${formatBytes(after)} (${saved}% smaller)`);
      console.log(`  written to ${relative(ROOT, outPath)}`);
    } catch (err) {
      console.error(`  Failed to optimize ${rel}:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  }

  console.log('\n[optimize-assets] Done. Source files were not modified.');
  console.log('[optimize-assets] Review the output, then copy it over the originals if you are happy.');
}

main().catch((err) => {
  console.error('[optimize-assets] Unexpected failure:', err);
  process.exitCode = 1;
});
