#!/usr/bin/env node
const { execSync } = require('child_process');
const { rmSync, existsSync } = require('fs');
const { join } = require('path');

const isWatch = process.argv.includes('--watch');
const distDir = join(__dirname, 'dist');
const tscOutDir = join(distDir, 'tsc');

console.log('🧹 Cleaning dist directory...');
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

console.log('📦 Step 1: Compiling TypeScript with tsc...');
try {
  const tsconfigPath = join(__dirname, 'tsconfig.build.json');
  const tscCmd = isWatch 
    ? `bun run tsc -p ${tsconfigPath} --watch --preserveWatchOutput`
    : `bun run tsc -p ${tsconfigPath}`;
  
  if (isWatch) {
    // For watch mode, we need to run tsc in background and continue
    const { spawn } = require('child_process');
    const tscProcess = spawn('bun', ['run', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], {
      stdio: 'inherit',
      shell: true
    });
    
    // Give tsc time to do initial compilation
    console.log('⏳ Waiting for initial TypeScript compilation...');
    execSync('sleep 3');
  } else {
    execSync(tscCmd, { stdio: 'inherit', cwd: __dirname });
  }
} catch (error) {
  console.error('❌ TypeScript compilation failed:', error.message);
  process.exit(1);
}

console.log('📦 Step 2: Bundling with Bun...');
const bundleCmd = isWatch
  ? `bun build ${tscOutDir}/index.js --outfile=${distDir}/index.js --target=node --format=cjs --watch`
  : `bun build ${tscOutDir}/index.js --outfile=${distDir}/index.js --target=node --format=cjs`;

try {
  execSync(bundleCmd, { stdio: 'inherit', cwd: __dirname });
} catch (error) {
  console.error('❌ Bun bundling failed:', error.message);
  process.exit(1);
}

if (!isWatch) {
  console.log('✅ Build completed successfully!');
}