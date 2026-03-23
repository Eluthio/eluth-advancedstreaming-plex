import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
    plugins: [vue()],
    build: {
        lib: {
            entry: 'src/index.js',
            name: 'EluthPlex',
            fileName: () => 'index.js',
            formats: ['iife'],
        },
        rollupOptions: {
            external: ['vue'],
            output: {
                globals: { vue: 'Vue' },
                inlineDynamicImports: true,
            },
        },
        outDir: 'dist',
        cssCodeSplit: false,
    },
})
