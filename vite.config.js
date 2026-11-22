import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Rules tests share one emulator database, so run test files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
