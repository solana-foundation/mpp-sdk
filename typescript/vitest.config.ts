import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['packages/*/src/__tests__/*.test.ts'],
        exclude: ['**/integration.test.ts'],
        testTimeout: 15_000,
        globals: true,
    },
});
