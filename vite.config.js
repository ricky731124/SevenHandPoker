var _a;
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// For GitHub Pages project sites the app is served from /<repo>/.
// Override at build time with:  VITE_BASE=/SevenHandPoker/ npm run build
var base = (_a = process.env.VITE_BASE) !== null && _a !== void 0 ? _a : '/';
export default defineConfig({
    base: base,
    plugins: [react()],
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
