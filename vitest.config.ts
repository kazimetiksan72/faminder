import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['packages/**/*.test.ts','apps/api/tests/**/*.test.ts','apps/tablet/src/**/*.test.ts'],testTimeout:20000,hookTimeout:120000,fileParallelism:false}});
