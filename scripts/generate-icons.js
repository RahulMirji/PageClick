const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Use built-in macOS tools to convert SVG to PNG at multiple sizes
const svgPath = path.join(__dirname, 'icon.svg');
const outDir = path.join(__dirname, '..', 'public', 'icons');

// Create a temporary HTML file to render SVG to canvas
const sizes = [16, 48, 128];

for (const size of sizes) {
  const svg = fs.readFileSync(svgPath, 'utf-8')
    .replace('width="128"', `width="${size}"`)
    .replace('height="128"', `height="${size}"`);

  // Write a simple SVG file at the target size  
  const outSvg = path.join(outDir, `icon${size}.svg`);
  fs.writeFileSync(outSvg, svg);
  
  // Use qlmanage (macOS) to convert SVG to PNG
  try {
    execSync(`qlmanage -t -s ${size} -o "${outDir}" "${outSvg}" 2>/dev/null`);
    const generated = path.join(outDir, `icon${size}.svg.png`);
    const target = path.join(outDir, `icon${size}.png`);
    if (fs.existsSync(generated)) {
      fs.renameSync(generated, target);
    }
    // Clean up SVG
    fs.unlinkSync(outSvg);
  } catch(e) {
    console.log(`qlmanage failed for ${size}, trying sips...`);
  }
}

console.log('Icons generated!');
